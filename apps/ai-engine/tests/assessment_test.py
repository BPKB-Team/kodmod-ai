"""Real HTTP/database assessment regressions with an isolated SQLite database.

The graph is an external boundary here. Separate node/graph tests exercise its
managed transaction mode; PostgreSQL tests exercise concurrent row locking.
"""

import copy
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from api.dependencies import current_user
from api.routes import quiz
from database import models
from fastapi import FastAPI
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


class AssessmentGraph:
    """Deterministic quiz turns, including a checkpoint from a failed DB write."""

    def __init__(self):
        self.saved = {}
        self.calls = 0
        self.qids = [str(uuid.uuid4()) for _ in range(20)]

    async def ainvoke(self, state, config=None):
        self.calls += 1
        result = {**copy.deepcopy(self.saved), **copy.deepcopy(state)}
        if not result.get("student_answer"):
            result.update(
                quiz_session_id="generated-quiz",
                quiz_questions=[
                    {
                        "question_id": qid,
                        "text": "Pilih satu",
                        "type": "mcq",
                        "options": ["A. satu", "B. dua"],
                        "expected_answer": "A",
                        "rubric": {},
                        "concept_id": result.get("current_concept_id", ""),
                        "difficulty": "easy",
                    }
                    for qid in self.qids[: result.get("quiz_n_questions", 1)]
                ],
                quiz_attempts=[],
                current_question_index=0,
                current_question_attempts=0,
                mastery_applied_attempts=0,
            )
            result["quiz_question"] = result["quiz_questions"][0]
        else:
            questions = result.get("quiz_questions") or [{"question_id": self.qids[0]}]
            index = result.get("current_question_index", 0)
            question = questions[min(index, len(questions) - 1)]
            correct = result["student_answer"] == "A"
            attempts = [
                *result.get("quiz_attempts", []),
                {
                    "question_id": question["question_id"],
                    "student_answer": result["student_answer"],
                    "score": 1.0 if correct else 0.0,
                    "is_correct": correct,
                    "confidence": 0.9,
                    "feedback": "Benar" if correct else "Coba lagi",
                },
            ]
            tries = result.get("current_question_attempts", 0) + 1
            advance = correct or tries >= 3
            result.update(
                quiz_questions=questions,
                quiz_attempts=attempts,
                quiz_score=attempts[-1]["score"],
                cumulative_quiz_score=sum(a["score"] for a in attempts) / len(attempts),
                current_question_index=index + int(advance),
                current_question_attempts=0 if advance else tries,
                mastery_applied_attempts=len(attempts)
                if advance
                else result.get("mastery_applied_attempts", 0),
            )
            if index + int(advance) < len(questions):
                result["quiz_question"] = questions[index + int(advance)]
        result["accessible_response"] = "Hasil tersimpan"
        self.saved = copy.deepcopy(result)
        return result


@pytest.fixture
async def assessment_http(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    names = [
        "users",
        "classrooms",
        "enrollments",
        "class_materials",
        "material_imports",
        "background_jobs",
        "subjects",
        "concepts",
        "quiz_sessions",
        "quiz_questions",
        "quiz_attempts",
        "mastery_scores",
        "assessment_submissions",
        "quiz_question_outcomes",
        "quiz_action_receipts",
        "mastery_events",
    ]
    async with engine.begin() as connection:
        await connection.execute(text("PRAGMA foreign_keys=ON"))
        await connection.run_sync(
            lambda c: models.Base.metadata.create_all(
                c,
                tables=[
                    models.Base.metadata.tables[n]
                    for n in names
                    if n in models.Base.metadata.tables
                ],
            )
        )
    owner = models.User(
        id=uuid.uuid4(),
        username="quiz-owner",
        full_name="Quiz Owner",
        password_hash="fixture",
        role="student",
    )
    stranger = models.User(
        id=uuid.uuid4(),
        username="quiz-stranger",
        full_name="Quiz Stranger",
        password_hash="fixture",
        role="student",
    )
    subject = models.Subject(id=uuid.uuid4(), name="Matematika")
    concept = models.Concept(
        id=uuid.uuid4(),
        subject_id=subject.id,
        name="Pecahan",
        slug="assessment-pecahan",
    )
    async with factory() as session:
        session.add_all([owner, stranger, subject])
        await session.flush()
        session.add(concept)
        await session.flush()
        session.add(
            models.MasteryScore(
                student_id=owner.id,
                concept_id=concept.id,
                mastery=0.5,
                confidence=0.5,
                n_attempts=0,
            )
        )
        await session.commit()
    controls = {"fail_commit": False, "actor": owner}

    @asynccontextmanager
    async def transaction():
        async with factory() as session:
            try:
                yield session
                if controls["fail_commit"]:
                    raise RuntimeError("fixture database write failure")
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    async def user():
        return controls["actor"]

    async def mastery(_):
        return {str(concept.id): 0.5}, {str(concept.id): 0.5}

    monkeypatch.setattr(quiz, "async_session", transaction)
    # These pre-existing regression fixtures deliberately construct persisted v1
    # sessions. V2 tests opt in by replacing the stored policy after creation.
    real_start = quiz.start_assessment

    async def start_legacy(session, graph, student, body, **kwargs):
        result = await real_start(session, graph, student, body, **kwargs)
        row = await session.get(models.QuizSession, result.quiz_session_id)
        row.assessment_state = {**row.assessment_state, "quiz_policy_version": 1}
        return result.model_copy(update={"policy_version": 1, "available_actions": ["answer"]})

    monkeypatch.setattr(quiz, "start_assessment", start_legacy)

    monkeypatch.setattr(quiz, "_load_mastery", mastery)
    app = FastAPI()
    graph = AssessmentGraph()
    app.state.graph = graph
    app.dependency_overrides[current_user] = user
    app.include_router(quiz.router, prefix="/quiz")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://assessment.test",
    ) as client:
        yield client, factory, controls, graph, concept, stranger
    await engine.dispose()


async def start(client, concept, count=1):
    response = await client.post(
        "/quiz/start", json={"concept_id": str(concept.id), "n_questions": count}
    )
    assert response.status_code == 200, response.text
    return response.json()


def submission(started, answer="A"):
    return {
        "quiz_session_id": started["quiz_session_id"],
        "question_id": started["first_question"]["question_id"],
        "submission_id": str(uuid.uuid4()),
        "student_answer": answer,
        "response_latency_ms": 1200,
    }


async def attempt_count(factory):
    async with factory() as session:
        return await session.scalar(select(func.count()).select_from(models.QuizAttempt))


async def test_unknown_session_is_rejected_before_scoring(assessment_http):
    client, factory, _, graph, _, _ = assessment_http
    response = await client.post(
        "/quiz/submit",
        json={
            "quiz_session_id": str(uuid.uuid4()),
            "question_id": str(uuid.uuid4()),
            "submission_id": str(uuid.uuid4()),
            "student_answer": "A",
        },
    )
    assert response.status_code == 404
    assert await attempt_count(factory) == 0
    assert graph.calls == 0


async def test_foreign_session_cannot_be_scored(assessment_http):
    client, factory, controls, graph, concept, stranger = assessment_http
    started = await start(client, concept)
    controls["actor"] = stranger
    response = await client.post("/quiz/submit", json=submission(started))
    assert response.status_code == 404
    assert await attempt_count(factory) == 0
    assert graph.calls == 1


async def test_wrong_question_is_rejected(assessment_http):
    client, factory, _, graph, concept, _ = assessment_http
    body = submission(await start(client, concept))
    body["question_id"] = str(uuid.uuid4())
    response = await client.post("/quiz/submit", json=body)
    assert response.status_code in (404, 409)
    assert await attempt_count(factory) == 0
    assert graph.calls == 1


async def test_finished_session_rejects_a_new_submission(assessment_http):
    client, factory, _, _, concept, _ = assessment_http
    body = submission(await start(client, concept))
    assert (await client.post("/quiz/submit", json=body)).status_code == 200
    body["submission_id"] = str(uuid.uuid4())
    response = await client.post("/quiz/submit", json=body)
    assert response.status_code == 409
    assert await attempt_count(factory) == 1


async def test_duplicate_submission_returns_original_result_and_one_mastery_effect(
    assessment_http,
):
    client, factory, _, graph, concept, _ = assessment_http
    body = submission(await start(client, concept))
    first = await client.post("/quiz/submit", json=body)
    replay = await client.post("/quiz/submit", json=body)
    assert first.status_code == replay.status_code == 200
    assert replay.json() == first.json()
    assert await attempt_count(factory) == 1
    assert graph.calls == 2
    async with factory() as session:
        score = await session.scalar(select(models.MasteryScore))
        assert score.n_attempts == 1
        assert score.mastery == pytest.approx(0.6125)


async def test_reused_submission_id_rejects_changed_answer(assessment_http):
    client, factory, _, _, concept, _ = assessment_http
    body = submission(await start(client, concept, 2), "B")
    assert (await client.post("/quiz/submit", json=body)).status_code == 200
    body["student_answer"] = "A"
    response = await client.post("/quiz/submit", json=body)
    assert response.status_code == 409
    assert await attempt_count(factory) == 1


async def test_failed_commit_is_retryable_without_checkpoint_replay(assessment_http):
    client, factory, controls, _, concept, _ = assessment_http
    body = submission(await start(client, concept))
    controls["fail_commit"] = True
    failed = await client.post("/quiz/submit", json=body)
    assert failed.status_code == 503
    assert await attempt_count(factory) == 0
    controls["fail_commit"] = False
    retry = await client.post("/quiz/submit", json=body)
    assert retry.status_code == 200
    assert retry.json()["quiz_complete"] is True
    assert await attempt_count(factory) == 1


async def test_start_does_not_report_success_when_database_commit_fails(
    assessment_http,
):
    client, _, controls, _, concept, _ = assessment_http
    controls["fail_commit"] = True
    response = await client.post(
        "/quiz/start", json={"concept_id": str(concept.id), "n_questions": 1}
    )
    assert response.status_code == 503


async def test_intentional_remediation_keeps_original_answers(assessment_http):
    client, factory, _, _, concept, _ = assessment_http
    started = await start(client, concept, 2)
    wrong = submission(started, "B")
    first = await client.post("/quiz/submit", json=wrong)
    assert first.status_code == 200
    assert first.json()["next_question"]["order_index"] == 0
    correct = {**wrong, "student_answer": "A", "submission_id": str(uuid.uuid4())}
    second = await client.post("/quiz/submit", json=correct)
    assert second.status_code == 200
    assert second.json()["next_question"]["order_index"] == 1
    async with factory() as session:
        answers = (
            await session.scalars(
                select(models.QuizAttempt.student_answer).order_by(models.QuizAttempt.answered_at)
            )
        ).all()
    assert answers == ["B", "A"]


async def test_real_graph_remediation_and_completion_share_the_canonical_transaction(
    assessment_http, monkeypatch
):
    from unittest.mock import AsyncMock

    from analytics.student_model import StudentModel
    from graphs.main_graph import build_kodmod_graph
    from memory import short_term
    from tools.rag_tool import RAGTool

    client, factory, _, _, concept, _ = assessment_http
    monkeypatch.setattr(
        RAGTool,
        "retrieve",
        AsyncMock(
            return_value=[
                {"text": "Satu per dua ditambah satu per dua adalah satu. Dua per dua adalah satu."}
            ]
        ),
    )

    # The managed graph must never write evidence outside the REST transaction.
    def forbidden(*args, **kwargs):
        raise AssertionError("Managed assessment attempted an independent write")

    monkeypatch.setattr(StudentModel, "persist", forbidden)
    monkeypatch.setattr(short_term, "store_quiz_session", forbidden)
    monkeypatch.setattr(short_term, "clear_quiz_session", forbidden)
    client._transport.app.state.graph = await build_kodmod_graph()
    started = await start(client, concept, 2)
    body = submission(started, "B")
    wrong = await client.post("/quiz/submit", json=body)
    assert wrong.status_code == 200, wrong.text
    assert wrong.json()["next_question"]["order_index"] == 0
    correct = await client.post(
        "/quiz/submit",
        json={**body, "submission_id": str(uuid.uuid4()), "student_answer": "A"},
    )
    assert correct.status_code == 200, correct.text
    assert correct.json()["next_question"]["order_index"] == 1
    last = await client.post(
        "/quiz/submit",
        json={
            **body,
            "question_id": correct.json()["next_question"]["question_id"],
            "submission_id": str(uuid.uuid4()),
            "student_answer": "A",
        },
    )
    assert last.status_code == 200, last.text
    assert last.json()["quiz_complete"] is True
    assert await attempt_count(factory) == 3
    async with factory() as session:
        mastery = await session.scalar(select(models.MasteryScore))
        assert mastery.n_attempts == 3
        assert await session.scalar(select(func.count()).select_from(models.MasteryEvent)) == 3


async def test_previously_active_question_is_rejected_before_graph(assessment_http):
    client, factory, _, graph, concept, _ = assessment_http
    body = submission(await start(client, concept, 2))
    assert (await client.post("/quiz/submit", json=body)).status_code == 200
    stale = await client.post("/quiz/submit", json={**body, "submission_id": str(uuid.uuid4())})
    assert stale.status_code == 409
    assert graph.calls == 2
    assert await attempt_count(factory) == 1


async def test_legacy_session_requires_restart_without_invoking_graph(assessment_http):
    client, factory, controls, graph, _, _ = assessment_http
    sid = uuid.uuid4()
    async with factory() as session:
        session.add(
            models.QuizSession(id=sid, student_id=controls["actor"].id, status="in_progress")
        )
        await session.commit()
    response = await client.post(
        "/quiz/submit",
        json={
            "quiz_session_id": str(sid),
            "question_id": str(uuid.uuid4()),
            "submission_id": str(uuid.uuid4()),
            "student_answer": "A",
        },
    )
    assert response.status_code == 409
    assert graph.calls == 0
    assert await attempt_count(factory) == 0


async def test_unmapped_class_scope_never_persists_global_concept_evidence(
    assessment_http,
):
    client, factory, controls, _, concept, _ = assessment_http
    async with factory() as session:
        room = models.Classroom(
            id=uuid.uuid4(),
            teacher_id=controls["actor"].id,
            name="Test",
            subject="Matematika",
        )
        session.add(room)
        await session.flush()
        material = models.ClassMaterial(
            id=uuid.uuid4(),
            class_id=room.id,
            title="Pecahan",
            content="Pecahan senilai",
            published=True,
            rag_status="ready",
            content_version=1,
            indexed_version=1,
            n_chunks=1,
        )
        session.add_all(
            [
                material,
                models.Enrollment(class_id=room.id, student_id=controls["actor"].id),
            ]
        )
        await session.commit()
    opened = await client.post(
        "/quiz/start",
        json={
            "class_id": str(room.id),
            "material_id": str(material.id),
            "n_questions": 1,
        },
    )
    assert opened.status_code == 200, opened.text
    started = opened.json()
    response = await client.post("/quiz/submit", json=submission(started))
    assert response.status_code == 200, response.text
    async with factory() as session:
        mastery = await session.scalar(select(models.MasteryScore))
        assert mastery.mastery == 0.5
        assert mastery.n_attempts == 0
        assert await session.scalar(select(func.count()).select_from(models.MasteryEvent)) == 0


@pytest.mark.parametrize("language", ["id", "en"])
async def test_assessment_start_uses_graph_learning_profile_schema(assessment_http, language):
    from graphs.state import build_learning_profile

    client, factory, controls, graph, concept, _ = assessment_http
    async with factory() as session:
        owner = await session.get(models.User, controls["actor"].id)
        owner.preferred_language = "id"
        owner.accessibility_profile = "low_vision"
        await session.commit()
        controls["actor"] = owner
    response = await client.post(
        "/quiz/start",
        json={"concept_id": str(concept.id), "n_questions": 1, "language": language},
    )
    assert response.status_code == 200, response.text
    expected = {**build_learning_profile(owner), "language": language}
    assert graph.saved["learning_profile"] == expected
    assert graph.saved["detected_language"] == language
    async with factory() as session:
        quiz_session = await session.get(
            models.QuizSession, uuid.UUID(response.json()["quiz_session_id"])
        )
        assert quiz_session.assessment_state["learning_profile"] == expected


async def test_assessment_reads_decayed_mastery_and_updates_from_that_value(
    assessment_http,
):
    client, factory, _, graph, concept, _ = assessment_http
    async with factory() as session:
        mastery = await session.scalar(select(models.MasteryScore))
        mastery.mastery = 0.8
        mastery.n_attempts = 4
        mastery.last_seen = datetime.now(UTC) - timedelta(days=30)
        await session.commit()
    started = await start(client, concept)
    assert graph.saved["mastery_scores"][str(concept.id)] == pytest.approx(0.65)
    async with factory() as session:
        mastery = await session.scalar(select(models.MasteryScore))
        assert mastery.mastery == 0.8
        assert mastery.n_attempts == 4
        assert await session.scalar(select(func.count()).select_from(models.MasteryEvent)) == 0
    response = await client.post("/quiz/submit", json=submission(started))
    assert response.status_code == 200, response.text
    async with factory() as session:
        event = await session.scalar(select(models.MasteryEvent))
        mastery = await session.scalar(select(models.MasteryScore))
        assert event.mastery_before == pytest.approx(0.65)
        assert mastery.mastery == pytest.approx(0.72875)
        assert mastery.n_attempts == 5

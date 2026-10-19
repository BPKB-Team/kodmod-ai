"""One learner's reviewed assignment and adaptive practice share durable evidence."""

import uuid
from contextlib import asynccontextmanager

import pytest
from analytics import aggregator, student_model
from api.main import app
from api.routes import quiz
from database import models as db
from sqlalchemy import func, select

from tests import editorial_test
from tests.assessment_test import AssessmentGraph, start, submission
from tests.editorial_test import editorial_http as editorial_http

pytestmark = [pytest.mark.integration, pytest.mark.db, pytest.mark.asyncio(loop_scope="function")]


async def ensure_progress_tables(factory):
    names = {
        "mastery_scores",
        "quiz_question_outcomes",
        "quiz_action_receipts",
        "material_learning_progress",
        "material_concepts",
        "mastery_events",
        "assignment_mastery_events",
        "quiz_sessions",
        "quiz_questions",
        "quiz_attempts",
        "assessment_submissions",
        "learning_sessions",
        "interaction_logs",
        "misconceptions",
        "recommendations",
    }
    pending = list(names)
    while pending:
        for foreign_key in db.Base.metadata.tables[pending.pop()].foreign_keys:
            parent = foreign_key.column.table.name
            if parent not in names:
                names.add(parent)
                pending.append(parent)
    async with factory.kw["bind"].begin() as connection:
        await connection.run_sync(
            lambda c: db.Base.metadata.create_all(
                c, tables=[t for t in db.Base.metadata.sorted_tables if t.name in names]
            )
        )


@pytest.mark.parametrize(("formal_option", "practice_answer"), [("b", "A"), ("a", "B")])
async def test_reviewed_grade_and_adaptive_answers_share_one_student_model(
    editorial_http, monkeypatch, formal_option, practice_answer
):
    client, factory, actors, subject, _, headers = editorial_http
    # Create only this flow's tables and their FK dependencies in the fixture's
    # private PostgreSQL schema. Never touch the shared application schema.
    await ensure_progress_tables(factory)
    async with factory() as session:
        concept = db.Concept(subject_id=subject.id, name="Pecahan", slug="shared-evidence")
        session.add(concept)
        await session.commit()

    @asynccontextmanager
    async def transaction():
        async with factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    monkeypatch.setattr(quiz, "async_session", transaction)
    monkeypatch.setattr(student_model, "async_session", transaction)
    monkeypatch.setattr(aggregator, "async_session", transaction)
    monkeypatch.setattr(app.state, "graph", AssessmentGraph(), raising=False)

    questions = editorial_test.draft_body(subject)["questions"]
    questions[0]["concept_id"] = str(concept.id)
    _, assignment = await editorial_test.assigned(editorial_http, questions=questions)
    attempt = await editorial_test.answered(editorial_http, assignment, option=formal_option)
    path = f"/student/assignments/{assignment['id']}/submit"
    request_headers = headers("student") | {"Idempotency-Key": str(uuid.uuid4())}
    body = {"expected_revision": attempt["revision"]}
    first = await client.post(path, json=body, headers=request_headers)
    replay = await client.post(path, json=body, headers=request_headers)
    assert first.status_code == replay.status_code == 200, first.text
    assert first.json() == replay.json()
    formal_model = await student_model.StudentModel.load(str(actors["student"].id))
    baseline = formal_model._scores[str(concept.id)]
    assert formal_model._attempts[str(concept.id)] == 1
    assert (baseline > 0.5) == (formal_option == "a")

    # Generation/scoring is deterministic here; real graph nodes have their
    # own tests. HTTP authentication, grading, receipts and SQL are real.
    client.headers.update(headers("student"))
    started = await start(client, concept)
    count = 1
    for index in range(count):
        answer_body = submission(started, answer=practice_answer)
        accepted = await client.post("/quiz/submit", json=answer_body)
        duplicate = await client.post("/quiz/submit", json=answer_body)
        assert accepted.status_code == duplicate.status_code == 200, accepted.text
        assert accepted.json() == duplicate.json()
        assert accepted.json()["question_state"] == "review"
        completed = await client.post(
            f"/quiz/{started['quiz_session_id']}/actions",
            json={
                "action_id": str(uuid.uuid4()),
                "question_id": answer_body["question_id"],
                "action": "advance",
            },
        )
        assert completed.status_code == 200, completed.text
        assert completed.json()["question_state"] == "complete"
        if index < count - 1:
            pending_model = await student_model.StudentModel.load(str(actors["student"].id))
            assert pending_model._scores[str(concept.id)] == pytest.approx(baseline)
            assert pending_model._attempts[str(concept.id)] == 1

    final = await student_model.StudentModel.load(str(actors["student"].id))
    assert final._attempts[str(concept.id)] == 1 + count
    assert (final._scores[str(concept.id)] > baseline) == (practice_answer == "A")
    outsider = await student_model.StudentModel.load(str(actors["outsider"].id))
    assert await outsider.mastery_scores() == {}
    summary = await aggregator.StudentAggregator().summarise(
        student_id=actors["student"].id, window="all", include_recommendations=False
    )
    assert summary["overall_mastery"] == pytest.approx(round(final.overall_mastery(), 3))
    assert summary["n_assignment_submissions"] == 1
    assert summary["n_assignment_answers"] == 1
    assert summary["n_practice_answers"] == count
    assert summary["n_quiz_attempts"] == 1 + count
    async with factory() as session:
        assert await session.scalar(select(func.count()).select_from(db.MasteryScore)) == 1
        assert (
            await session.scalar(select(func.count()).select_from(db.AssignmentMasteryEvent)) == 1
        )
        assert await session.scalar(select(func.count()).select_from(db.MasteryEvent)) == count


async def test_unreleased_formal_evidence_cannot_change_public_insights(
    editorial_http, monkeypatch
):
    client, factory, actors, subject, _, headers = editorial_http
    await ensure_progress_tables(factory)
    async with factory() as dbsession:
        concept = db.Concept(subject_id=subject.id, name="Private concept", slug="private-concept")
        dbsession.add(concept)
        await dbsession.commit()
    questions = editorial_test.draft_body(subject)["questions"]
    questions[0]["concept_id"] = str(concept.id)
    _, assignment = await editorial_test.assigned(
        editorial_http, questions=questions, release_policy="after_due"
    )
    attempt = await editorial_test.answered(editorial_http, assignment, option="a")
    result = await client.post(
        f"/student/assignments/{assignment['id']}/submit",
        json={"expected_revision": attempt["revision"]},
        headers=headers("student") | {"Idempotency-Key": str(uuid.uuid4())},
    )
    assert result.status_code == 200, result.text
    assert not result.json()["feedback_released"]

    @asynccontextmanager
    async def transaction():
        async with factory() as session:
            yield session

    monkeypatch.setattr(aggregator, "async_session", transaction)
    first = await aggregator.StudentAggregator().summarise(
        student_id=actors["student"].id, window="all", include_recommendations=False
    )
    from analytics.progress_guidance import build_guidance_snapshot

    async with factory() as session:
        before_snapshot = await build_guidance_snapshot(
            session, student=actors["student"], timezone="UTC"
        )
    async with factory() as session:
        event = await session.scalar(select(db.AssignmentMasteryEvent))
        event.score = 0
        score = await session.scalar(select(db.MasteryScore))
        score.mastery = 0.1
        await session.commit()
    second = await aggregator.StudentAggregator().summarise(
        student_id=actors["student"].id, window="all", include_recommendations=False
    )
    async with factory() as session:
        after_snapshot = await build_guidance_snapshot(
            session, student=actors["student"], timezone="UTC"
        )
    assert before_snapshot.source_snapshot_hash == after_snapshot.source_snapshot_hash
    for key in [
        "visible_evidence_hash",
        "overall_mastery",
        "assessed_concepts",
        "strong_concepts",
        "weak_concepts",
        "concept_evidence",
    ]:
        assert first[key] == second[key]
    assert not first["mastery_available"]

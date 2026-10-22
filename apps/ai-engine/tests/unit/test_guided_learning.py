"""Real HTTP + SQL state, external generation isolated; no shared DB or UI clicks."""

import os
import uuid
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from api import learning_service
from api.dependencies import current_user, db_session
from api.routes import (
    admin_insights,
    admin_materials,
    classrooms,
    editorial_quizzes,
    learning,
    quiz,
)
from database import models
from tests.assessment_test import AssessmentGraph


@pytest.fixture
async def learning_http(monkeypatch):
    admin_engine, schema = None, None
    if os.getenv("KODMOD_GUIDED_POSTGRES") == "1":
        # Fixed dedicated testing database. Never derive this from settings/.env.
        url = "postgresql+asyncpg://kodmod:kodmod@127.0.0.1:5434/kodmod_test"
        schema = "guided_" + uuid.uuid4().hex
        admin_engine = create_async_engine(url, poolclass=NullPool)
        async with admin_engine.begin() as connection:
            if os.getenv("KODMOD_RETRIEVAL_POSTGRES") == "1":
                await connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        search_path = (
            f"{schema},public" if os.getenv("KODMOD_RETRIEVAL_POSTGRES") == "1" else schema
        )
        engine = create_async_engine(
            url,
            poolclass=NullPool,
            connect_args={"server_settings": {"search_path": search_path}},
            execution_options={"schema_translate_map": {None: schema}},
        )
    else:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    names = [
        "users",
        "classrooms",
        "enrollments",
        "class_materials",
        "material_imports",
        "material_assets",
        "material_revisions",
        "background_jobs",
        "class_activities",
        "audit_events",
        "provider_usage",
        "subjects",
        "concepts",
        "learning_sessions",
        "material_learning_progress",
        "material_progress",
        "learning_action_receipts",
        "interaction_logs",
        "learning_plans",
        "learning_plan_steps",
        "quiz_sessions",
        "quiz_questions",
        "quiz_attempts",
        "mastery_scores",
        "assessment_submissions",
        "quiz_question_outcomes",
        "quiz_action_receipts",
        "mastery_events",
    ]
    if os.getenv("KODMOD_RETRIEVAL_POSTGRES") == "1":
        names.extend(["documents", "curriculum_chunks", "material_concepts"])
    async with engine.begin() as conn:
        await conn.run_sync(
            lambda c: models.Base.metadata.create_all(
                c, tables=[models.Base.metadata.tables[n] for n in names]
            )
        )
    owner = models.User(
        id=uuid.uuid4(),
        username="owner",
        full_name="Owner",
        role="student",
        password_hash="fixture",
    )
    teacher = models.User(
        id=uuid.uuid4(),
        username="teacher",
        full_name="Teacher",
        role="teacher",
        password_hash="fixture",
    )
    outsider = models.User(
        id=uuid.uuid4(),
        username="outsider",
        full_name="Outsider",
        role="student",
        password_hash="fixture",
    )
    admin = models.User(
        id=uuid.uuid4(),
        username="admin",
        full_name="Admin",
        role="admin",
        password_hash="fixture",
    )
    room = models.Classroom(id=uuid.uuid4(), name="X", subject="Matematika", teacher_id=teacher.id)
    material = models.ClassMaterial(
        id=uuid.uuid4(),
        class_id=room.id,
        title="Pecahan",
        content=("Pecahan senilai mempunyai nilai yang sama. " * 140),
        published=True,
        rag_status="ready",
        n_chunks=3,
        content_version=1,
        indexed_version=1,
    )
    async with factory() as session:
        session.add_all([owner, teacher, outsider, admin])
        await session.flush()
        session.add(room)
        await session.flush()
        session.add_all([material, models.Enrollment(class_id=room.id, student_id=owner.id)])
        await session.commit()
    controls = {"actor": owner, "fail_commit": False}

    async def transaction():
        async with factory() as session:
            orig_commit = session.commit

            async def wrapped_commit():
                if controls["fail_commit"]:
                    raise RuntimeError("fixture failed write")
                return await orig_commit()

            session.commit = wrapped_commit
            try:
                yield session
                if controls["fail_commit"]:
                    raise RuntimeError("fixture failed write")
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    from contextlib import asynccontextmanager

    monkeypatch.setattr(quiz, "async_session", asynccontextmanager(transaction))

    async def user():
        return controls["actor"]

    app = FastAPI()
    app.state.graph = AssessmentGraph()
    app.dependency_overrides[current_user] = user
    app.dependency_overrides[db_session] = transaction
    app.include_router(learning.router, prefix="/learning")
    app.include_router(quiz.router, prefix="/quiz")
    app.include_router(admin_materials.router, prefix="/admin")
    app.include_router(admin_insights.router, prefix="/admin")
    app.include_router(classrooms.router, prefix="/classes")
    app.include_router(editorial_quizzes.router)
    # Use real LangGraph and accessibility, with only the LLM substituted.
    from graphs import guided_learning

    class Tutor:
        async def ainvoke(self, messages):
            language = "en" if "English" in messages[0]["content"] else "id"
            return SimpleNamespace(
                content="Equivalent fractions have the same value. What is one example?"
                if language == "en"
                else "Pecahan senilai memiliki nilai sama. Apa contohnya?"
            )

    monkeypatch.setattr(guided_learning, "get_tutor_llm", lambda: Tutor())

    async def index(*args):
        pass

    async def queued(session, material, **kwargs):
        return None

    monkeypatch.setattr(admin_materials, "enqueue_material", queued)

    async def unavailable_quota():
        return {"configured": True, "available": False}

    monkeypatch.setattr(admin_insights, "get_subscription_info", unavailable_quota)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(
            app=app, raise_app_exceptions=os.getenv("KODMOD_GUIDED_POSTGRES") == "1"
        ),
        base_url="http://learning.test",
    ) as client:
        yield client, factory, controls, material, outsider, admin
    await engine.dispose()
    if admin_engine:
        async with admin_engine.begin() as connection:
            await connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await admin_engine.dispose()


async def open_lesson(client, material, language="id"):
    response = await client.post(
        "/learning/start",
        json={
            "class_id": str(material.class_id),
            "material_id": str(material.id),
            "language": language,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def action_body(state, action, **extra):
    return {
        "request_id": str(uuid.uuid4()),
        "revision": state["revision"],
        "action": action,
        "language": state["language"],
        **extra,
    }


@pytest.mark.parametrize("phase", ["learning", "quiz"])
async def test_start_skips_legacy_partitions_without_deleting_the_old_session(learning_http, phase):
    client, factory, _, material, _, _ = learning_http
    original = await open_lesson(client, material)
    sid = uuid.UUID(original["session_id"])
    async with factory() as session:
        row = await session.get(models.LearningSession, sid)
        legacy = {
            **row.guided_state,
            "phase": phase,
            "units": [{"text": "Bagian lama sebelum pembagian blok kanonik.", "title": "Pecahan"}],
            "quiz_id": str(uuid.uuid4()) if phase == "quiz" else None,
        }
        row.guided_state = legacy
        await session.commit()
    assert (await client.get(f"/learning/sessions/{sid}")).status_code == 409
    fresh = await open_lesson(client, material)
    assert fresh["session_id"] != str(sid)
    assert fresh["phase"] == "learning" and fresh["text"]
    assert fresh["total_units"] == original["total_units"]
    assert {row["session_id"] for row in (await client.get("/learning/active")).json()} == {
        fresh["session_id"]
    }
    async with factory() as session:
        old = await session.get(models.LearningSession, sid)
        assert old.guided_state == legacy
        assert old.ended_at is None
        assert (
            await session.get(models.ClassMaterial, material.id)
        ).content_version == material.content_version


async def test_teach_question_continue_repeat_restore_and_retry(learning_http):
    client, factory, controls, material, outsider, _ = learning_http
    state = await open_lesson(client, material)
    assert state["text"].startswith("Pecahan")
    assert state["total_units"] >= 2 and state["unit_index"] == 0
    assert await open_lesson(client, material) == state
    path = f"/learning/sessions/{state['session_id']}"
    assert (await client.get(path)).json()["text"] == state["text"]
    body = action_body(state, "continue")
    advanced = await client.post(path + "/actions", json=body)
    assert advanced.status_code == 200, advanced.text
    state = advanced.json()
    assert state["unit_index"] == 1 and state["revision"] == 1
    assert (await client.post(path + "/actions", json=body)).json() == state
    assert (
        await client.post(path + "/actions", json={**body, "request_id": str(uuid.uuid4())})
    ).status_code == 409
    repeated = await client.post(
        path + "/actions", json=action_body(state, "repeat", language="en")
    )
    assert repeated.status_code == 200
    state = repeated.json()
    assert state["language"] == "en" and state["unit_index"] == 1
    question = await client.post(
        path + "/actions",
        json=action_body(state, "question", text="What is an example?"),
    )
    assert question.status_code == 200
    recovered = (await client.get(path)).json()
    assert recovered == question.json()
    async with factory() as session:
        assert (
            await session.scalar(select(func.count()).select_from(models.LearningActionReceipt))
            == 3
        )
        assert await session.scalar(select(func.count()).select_from(models.InteractionLog)) == 5
    controls["actor"] = outsider
    assert (await client.get(path)).status_code == 404
    assert (await client.get("/learning/active")).json() == []


async def test_short_intro_keeps_navigation_without_offering_an_unsupported_quiz(learning_http):
    client, factory, _, material, _, _ = learning_http
    async with factory() as session:
        stored = await session.get(models.ClassMaterial, material.id)
        stored.document = None
        stored.content = (
            "# Pengantar\n\nMengenal pecahan.\n\n"
            "# Pecahan senilai\n\nPecahan senilai mempunyai nilai yang sama meskipun "
            "pembilang dan penyebut berbeda. Satu per dua senilai dengan dua per empat."
        )
        await session.commit()
    state = await open_lesson(client, material)
    path = f"/learning/sessions/{state['session_id']}"
    assert "continue" in state["available_actions"]
    assert not {"check", "quiz"}.intersection(state["available_actions"])
    for action in ("check", "quiz"):
        response = await client.post(path + "/actions", json=action_body(state, action))
        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "insufficient_learning_content"
    recovered = (await client.get(path)).json()
    assert recovered["revision"] == state["revision"]
    async with factory() as session:
        assert await session.scalar(select(func.count()).select_from(models.QuizSession)) == 0
        assert (
            await session.scalar(select(func.count()).select_from(models.LearningActionReceipt))
            == 0
        )
    continued = await client.post(path + "/actions", json=action_body(state, "continue"))
    assert continued.status_code == 200
    state = continued.json()
    assert {"check", "quiz"}.issubset(state["available_actions"])
    started = await client.post(path + "/actions", json=action_body(state, "check"))
    assert started.status_code == 200
    assert started.json()["phase"] == "quiz"


@pytest.mark.parametrize("code", ["insufficient_learning_content", "source_quality_failed"])
async def test_quiz_quality_rejection_preserves_lesson_and_same_request_can_retry(
    learning_http, monkeypatch, code
):
    from agents.question_quality import QuestionQualityError

    client, factory, _, material, _, _ = learning_http
    state = await open_lesson(client, material)
    path = f"/learning/sessions/{state['session_id']}"
    body = action_body(state, "check")
    runtime = client._transport.app.state
    original = runtime.graph

    class RejectGraph:
        async def ainvoke(self, *args, **kwargs):
            raise QuestionQualityError(code, "The approved source could not support this batch.")

    monkeypatch.setattr(runtime, "graph", RejectGraph())
    response = await client.post(path + "/actions", json=body)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == code
    assert (await client.get(path)).json() == state
    async with factory() as session:
        assert await session.scalar(select(func.count()).select_from(models.QuizSession)) == 0
        assert (
            await session.get(models.LearningActionReceipt, uuid.UUID(body["request_id"])) is None
        )
    monkeypatch.setattr(runtime, "graph", original)
    retry = await client.post(path + "/actions", json=body)
    assert retry.status_code == 200
    assert retry.json()["phase"] == "quiz"
    assert retry.json()["revision"] == state["revision"] + 1


async def test_mini_quiz_holds_learning_and_survives_restart(learning_http):
    client, factory, _, material, _, _ = learning_http
    state = await open_lesson(client, material)
    path = f"/learning/sessions/{state['session_id']}"
    started = await client.post(path + "/actions", json=action_body(state, "check"))
    assert started.status_code == 200, started.text
    state = started.json()
    assert state["phase"] == "quiz" and state["available_actions"] == []
    assert state["quiz"]["kind"] == "tutor" and state["quiz"]["total_questions"] == 1
    assert (
        await client.post(path + "/actions", json=action_body(state, "continue"))
    ).status_code == 409
    assert (await client.get(path)).json()["quiz"]["quiz_session_id"] == state["quiz"][
        "quiz_session_id"
    ]
    assert (await client.get("/quiz/active")).json() == []
    response = await client.post(
        "/quiz/submit",
        json={
            "quiz_session_id": state["quiz"]["quiz_session_id"],
            "question_id": state["quiz"]["current_question"]["question_id"],
            "submission_id": str(uuid.uuid4()),
            "student_answer": "A",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["question_state"] == "review"
    assert not response.json()["quiz_complete"]
    advanced = await client.post(
        f"/quiz/{state['quiz']['quiz_session_id']}/actions",
        json={
            "action_id": str(uuid.uuid4()),
            "question_id": state["quiz"]["current_question"]["question_id"],
            "action": "advance",
        },
    )
    assert advanced.status_code == 200, advanced.text
    resumed = (await client.get(path)).json()
    assert resumed["phase"] == "learning" and "continue" in resumed["available_actions"]
    async with factory() as session:
        assert await session.scalar(select(func.count()).select_from(models.MasteryEvent)) == 0


async def test_three_question_mini_quiz_finishes_before_learning_resumes(learning_http):
    client, _, _, material, _, _ = learning_http
    state = await open_lesson(client, material)
    path = f"/learning/sessions/{state['session_id']}"
    started = await client.post(path + "/actions", json=action_body(state, "quiz"))
    assert started.status_code == 200, started.text
    state = started.json()
    assert state["quiz"]["total_questions"] == 3
    for index in range(3):
        restored = (await client.get(path)).json()
        assert restored["phase"] == "quiz" and restored["quiz"]["answered_questions"] == index
        question = restored["quiz"]["current_question"]
        response = await client.post(
            "/quiz/submit",
            json={
                "quiz_session_id": state["quiz"]["quiz_session_id"],
                "question_id": question["question_id"],
                "submission_id": str(uuid.uuid4()),
                "student_answer": "A",
            },
        )
        assert response.status_code == 200, response.text
        assert response.json()["question_state"] == "review"
        advanced = await client.post(
            f"/quiz/{state['quiz']['quiz_session_id']}/actions",
            json={
                "action_id": str(uuid.uuid4()),
                "question_id": question["question_id"],
                "action": "advance",
            },
        )
        assert advanced.status_code == 200, advanced.text
        assert (advanced.json()["question_state"] == "complete") == (index == 2)
    assert (await client.get(path)).json()["phase"] == "learning"


async def test_failed_commit_keeps_original_revision_and_retry_can_complete(
    learning_http,
):
    client, factory, controls, material, _, _ = learning_http
    state = await open_lesson(client, material)
    path = f"/learning/sessions/{state['session_id']}"
    body = action_body(state, "continue")
    controls["fail_commit"] = True
    assert (await client.post(path + "/actions", json=body)).status_code in (500, 503)
    async with factory() as session:
        row = await session.get(models.LearningSession, uuid.UUID(state["session_id"]))
        assert row.guided_state["revision"] == 0 and row.guided_state["unit_index"] == 0
        assert (
            await session.get(models.LearningActionReceipt, uuid.UUID(body["request_id"])) is None
        )
    controls["fail_commit"] = False
    retried = await client.post(path + "/actions", json=body)
    assert retried.status_code == 200 and retried.json()["unit_index"] == 1


async def test_initial_teaching_does_not_return_success_before_commit(learning_http):
    client, factory, controls, material, _, _ = learning_http
    controls["fail_commit"] = True
    response = await client.post(
        "/learning/start",
        json={
            "class_id": str(material.class_id),
            "material_id": str(material.id),
        },
    )
    assert response.status_code in (500, 503)
    async with factory() as session:
        assert await session.scalar(select(func.count()).select_from(models.LearningSession)) == 0
    controls["fail_commit"] = False
    assert (await open_lesson(client, material))["text"]


async def test_source_revision_and_revocation_stop_resume_without_deleting_state(
    learning_http,
):
    client, factory, _, material, _, _ = learning_http
    state = await open_lesson(client, material)
    async with factory() as session:
        row = await session.get(models.ClassMaterial, material.id)
        row.published = False
        await session.commit()
    path = f"/learning/sessions/{state['session_id']}"
    assert (await client.get(path)).status_code == 404
    assert (
        await client.post(path + "/actions", json=action_body(state, "repeat"))
    ).status_code == 404
    async with factory() as session:
        assert await session.get(models.LearningSession, uuid.UUID(state["session_id"])) is not None


async def test_admin_materials_catalog_moderates_and_invalidates_index(learning_http):
    client, factory, controls, material, _, admin = learning_http
    assert (await client.get("/admin/materials")).status_code == 403
    controls["actor"] = admin
    catalog = (await client.get("/admin/materials")).json()
    assert catalog["total"] == 1 and "content" not in catalog["items"][0]

    path = f"/admin/materials/{material.id}"
    assert (await client.get(path)).json()["content"] == material.content
    updated = await client.put(
        path,
        json={
            "title": "Pecahan baru",
            "content": "Satu per dua sama dengan dua per empat.",
            "published": True,
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["content_version"] == 2 and updated.json()["rag_status"] == "pending"
    async with factory() as session:
        event = await session.scalar(select(models.ClassActivity))
        assert event.actor_id == admin.id and event.action == "material.admin-updated"


async def test_admin_learning_trace_lookup_joins_usage_and_redacts_unexpected_details(
    learning_http,
):
    from decimal import Decimal

    client, factory, controls, _, _, admin = learning_http
    request_id, session_id = uuid.uuid4(), uuid.uuid4()
    async with factory() as session:
        session.add(
            models.AuditEvent(
                actor_id=controls["actor"].id,
                actor_role="student",
                category="learning",
                action="learning.verification",
                target_type="quiz_session",
                target_id=str(session_id),
                details={
                    "request_id": str(request_id),
                    "correlation_id": str(session_id),
                    "node": "problem_generator",
                    "prompt_version": "grounded-question-v1",
                    "source_ids": ["chunk-1"],
                    "quality_reasons": ["semantic_reject"],
                    "student_answer": "must never appear",
                    "prompt": "must never appear",
                },
            )
        )
        session.add(
            models.ProviderUsage(
                id=uuid.uuid4(),
                request_id=request_id,
                actor_id=controls["actor"].id,
                target_id=session_id,
                target_type="quiz_session",
                language="id",
                provider="openai",
                service="quiz",
                model="gpt-test",
                status="success",
                latency_ms=125,
                estimated_cost_usd=Decimal("0.00001234"),
            )
        )
        await session.commit()

    assert (
        await client.get(f"/admin/insights/learning-traces?request_id={request_id}")
    ).status_code == 403
    controls["actor"] = admin
    response = await client.get(
        f"/admin/insights/learning-traces?request_id={request_id}&page=1&limit=10"
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["total"] == 1 and payload["has_next"] is False
    trace = payload["items"][0]
    assert trace["request_id"] == str(request_id)
    assert trace["stage"] == "verification"
    assert trace["source_ids"] == ["chunk-1"]
    assert trace["provider_usage"]["calls"] == 1
    assert trace["provider_usage"]["estimated_cost_usd"] == pytest.approx(0.00001234)
    assert "must never appear" not in response.text


async def test_learning_trace_commits_with_independent_short_lived_session(
    learning_http, monkeypatch
):
    from contextlib import asynccontextmanager

    from tools import learning_trace, provider_usage

    _, factory, controls, _, _, _ = learning_http

    @asynccontextmanager
    async def independent_session():
        async with factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    monkeypatch.setattr(learning_trace, "async_session", independent_session)
    request_id = uuid.uuid4()
    with provider_usage.usage_context(request_id=request_id, actor_id=controls["actor"].id):
        recorded = await learning_trace.record_learning_trace(
            learning_trace.LearningTraceEvent(
                stage="session",
                node="quiz.start",
                student_id=controls["actor"].id,
                policy_version=2,
                source_ids=["chunk-1"],
            )
        )

    assert recorded is True
    async with factory() as session:
        trace = await session.scalar(
            select(models.AuditEvent).where(
                models.AuditEvent.category == "learning",
                models.AuditEvent.action == "learning.session",
            )
        )
        assert trace.details["request_id"] == str(request_id)
        assert trace.details["source_ids"] == ["chunk-1"]


def test_unit_partition_preserves_all_reviewed_source_text():
    content = "BAB 1\n\n" + "Pecahan senilai. " * 1300
    units = learning_service.learning_units(content)
    assert "".join(unit["text"] for unit in units) == content
    assert all(len(unit["text"]) <= 2400 for unit in units)


def test_short_reviewed_subchapters_are_separate_learning_units():
    content = (
        "# Pengertian Pecahan\nBagian dari keseluruhan.\n\n## Pecahan Senilai\nNilainya sama.\n"
    )
    units = learning_service.learning_units(content)
    assert len(units) == 2
    assert [unit["title"] for unit in units] == [
        "Pengertian Pecahan",
        "Pecahan Senilai",
    ]
    assert "".join(unit["text"] for unit in units) == content


def test_heading_partition_preserves_intro_long_sections_and_numbered_examples():
    content = "Pengantar\n\nBab II Pecahan\n" + "Contoh pecahan. " * 500
    content += "\n1. Contoh pertama\n2. Contoh kedua\n\nChapter 3 Fractions\nEquivalent fractions."
    units = learning_service.learning_units(content)
    assert "".join(unit["text"] for unit in units) == content
    assert all(len(unit["text"]) <= 2400 for unit in units)
    assert units[-1]["title"] == "Chapter 3 Fractions"
    assert not any(unit["title"] in {"1. Contoh pertama", "2. Contoh kedua"} for unit in units)


async def test_admin_usage_never_fabricates_tokens_or_request_latencies(learning_http):
    client, _, controls, _, _, admin = learning_http
    controls["actor"] = admin
    response = await client.get("/admin/insights/ai-usage")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["openai"]["total_tokens"] is None
    assert body["elevenlabs"]["character_limit"] is None
    assert body["recent_requests"] == []


async def test_teacher_proposal_uses_owned_material_and_remains_unpublished(
    learning_http, monkeypatch
):
    import json

    from agents import problem_generator

    client, factory, controls, material, _, _ = learning_http
    async with factory() as session:
        teacher = await session.scalar(select(models.User).where(models.User.role == "teacher"))
    payload = {
        "class_id": str(material.class_id),
        "material_id": str(material.id),
        "n_questions": 1,
    }
    assert (await client.post("/teacher/quizzes/propose", json=payload)).status_code == 403
    controls["actor"] = teacher
    assert len((await client.get("/classes/teacher/materials")).json()) == 1

    class Generator:
        async def ainvoke(self, messages):
            assert "Pecahan senilai mempunyai nilai yang sama" in messages[1]["content"]
            return SimpleNamespace(
                content=json.dumps(
                    {
                        "questions": [
                            {
                                "text": "Apa arti pecahan senilai?",
                                "type": "mcq",
                                "options": [
                                    "A. Nilai sama",
                                    "B. Penyebut sama",
                                    "C. Bilangan bulat",
                                    "D. Pembilang sama",
                                ],
                                "expected_answer": "A",
                                "source_indices": [1],
                                "explanation": "Pecahan senilai memiliki nilai sama.",
                            }
                        ]
                    }
                )
            )

    monkeypatch.setattr(problem_generator, "get_quiz_llm", lambda: Generator())
    proposed = await client.post("/teacher/quizzes/propose", json=payload)
    assert proposed.status_code == 200, proposed.text
    question = proposed.json()["questions"][0]
    assert question["correct_option_id"] == "a" and question["concept_id"] is None
    assert question["options"][0]["label"] == "Nilai sama"
    assert proposed.json()["review_required"] is True
    async with factory() as session:
        assert await session.scalar(select(func.count()).select_from(models.QuizSession)) == 0

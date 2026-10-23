import os
import uuid
from contextlib import asynccontextmanager

import pytest
from sqlalchemy import func, select

from database import models
from tests.unit.test_guided_learning import learning_http as learning_http
from tests.unit.test_progress_guidance import TEXT
from tests.unit.test_progress_rollup import prepare_rollup

pytestmark = [pytest.mark.integration, pytest.mark.db]


@pytest.fixture
async def plan_http(learning_http, monkeypatch):
    from api import durable_jobs, material_worker, progress_guidance_worker
    from api.routes import progress_guidance

    await prepare_rollup(learning_http, monkeypatch)
    client, factory, controls, material, *_ = learning_http
    names = {"learning_plans", "learning_plan_steps", "plan_action_receipts"}
    async with factory.kw["bind"].begin() as conn:
        await conn.run_sync(
            lambda c: models.Base.metadata.create_all(
                c, tables=[t for t in models.Base.metadata.sorted_tables if t.name in names]
            )
        )
    async with factory() as db:
        row = await db.get(models.ClassMaterial, material.id)
        row.content = TEXT
        await db.commit()

    @asynccontextmanager
    async def tx():
        async with factory() as db:
            try:
                yield db
                await db.commit()
            except Exception:
                await db.rollback()
                raise

    for module in [progress_guidance_worker, durable_jobs, material_worker]:
        monkeypatch.setattr(module, "async_session", tx)
    client._transport.app.include_router(progress_guidance.router, prefix="/analytics")
    return learning_http


def refresh_body(revision=0):
    return {"request_id": str(uuid.uuid4()), "expected_revision": revision, "timezone": "UTC"}


async def publish(plan_http):
    from api import durable_jobs, material_worker

    client, *_ = plan_http
    initial = await client.post("/analytics/me/guidance/refresh", json=refresh_body())
    assert initial.status_code == 202, initial.text
    job = await durable_jobs.claim(kinds=["progress_plan"])
    assert job is not None
    await material_worker.run_job(job)
    response = await client.get("/analytics/me/guidance?timezone=UTC")
    assert response.status_code == 200, response.text
    return response.json()


async def test_get_never_enqueues_and_duplicate_refresh_has_one_job(plan_http):
    client, factory, *_ = plan_http
    assert (await client.get("/analytics/me/guidance")).status_code == 200
    async with factory() as db:
        assert await db.scalar(select(func.count()).select_from(models.BackgroundJob)) == 0
    body = refresh_body()
    first = await client.post("/analytics/me/guidance/refresh", json=body)
    second = await client.post("/analytics/me/guidance/refresh", json=body)
    assert first.status_code == second.status_code == 202
    assert first.json() == second.json()
    another = await client.post("/analytics/me/guidance/refresh", json=refresh_body())
    assert another.json()["job_id"] == first.json()["job_id"]
    async with factory() as db:
        assert await db.scalar(select(func.count()).select_from(models.BackgroundJob)) == 1
        assert await db.scalar(select(func.count()).select_from(models.LearningPlan)) == 1


async def test_start_and_real_quiz_receipt_complete_only_the_linked_step(plan_http):
    client, factory, *_ = plan_http
    guidance = await publish(plan_http)
    plan = guidance["plan"]
    step = plan["steps"][0]
    assert step["status"] == "pending" and step["kind"] == "practice"
    body = {"request_id": str(uuid.uuid4()), "expected_revision": plan["revision"]}
    path = f"/analytics/me/plans/{plan['id']}/steps/{step['id']}/start"
    started = await client.post(path, json=body)
    assert started.status_code == 200, started.text
    assert (await client.post(path, json=body)).json() == started.json()
    assert started.json()["destination"].startswith("/student/practice?session_id=")
    sid = started.json()["session_id"]
    current = (await client.get(f"/quiz/sessions/{sid}")).json()
    answer = {
        "quiz_session_id": sid,
        "question_id": current["current_question"]["question_id"],
        "submission_id": str(uuid.uuid4()),
        "student_answer": "A",
    }
    assert (await client.post("/quiz/submit", json=answer)).status_code == 200
    before = (await client.get("/analytics/me/guidance")).json()
    assert before["plan"]["steps"][0]["status"] == "in_progress"
    action = {
        "action_id": str(uuid.uuid4()),
        "question_id": answer["question_id"],
        "action": "advance",
    }
    result = await client.post(f"/quiz/{sid}/actions", json=action)
    assert result.status_code == 200, result.text
    assert (await client.post(f"/quiz/{sid}/actions", json=action)).json() == result.json()
    after = (await client.get("/analytics/me/guidance")).json()
    assert after["plan"]["steps"][0]["status"] == "completed"
    assert all(s["status"] == "pending" for s in after["plan"]["steps"][1:])


async def test_changed_source_and_cross_student_cannot_start_a_plan_step(plan_http):
    client, factory, controls, material, outsider, _ = plan_http
    plan = (await publish(plan_http))["plan"]
    step = plan["steps"][0]
    path = f"/analytics/me/plans/{plan['id']}/steps/{step['id']}/start"
    body = {"request_id": str(uuid.uuid4()), "expected_revision": plan["revision"]}
    async with factory() as db:
        row = await db.get(models.ClassMaterial, material.id)
        row.mapping_version += 1
        await db.commit()
    assert (await client.post(path, json=body)).status_code == 409
    controls["actor"] = outsider
    assert (await client.post(path, json=body)).status_code == 404


async def test_unsupported_background_job_is_not_stolen(plan_http):
    from api import durable_jobs

    _, factory, *_ = plan_http
    async with factory() as db:
        db.add(
            models.BackgroundJob(
                kind="another_worker_kind", target_id=uuid.uuid4(), dedupe_key="unknown"
            )
        )
        await db.commit()
    assert await durable_jobs.claim() is None


async def start_step(client, plan, step):
    result = await client.post(
        f"/analytics/me/plans/{plan['id']}/steps/{step['id']}/start",
        json={"request_id": str(uuid.uuid4()), "expected_revision": plan["revision"]},
    )
    assert result.status_code == 200, result.text
    return result.json()


async def finish_quiz(client, sid):
    current = (await client.get(f"/quiz/sessions/{sid}")).json()
    qid = current["current_question"]["question_id"]
    submitted = await client.post(
        "/quiz/submit",
        json={
            "quiz_session_id": sid,
            "question_id": qid,
            "submission_id": str(uuid.uuid4()),
            "student_answer": "B",
        },
    )
    assert submitted.status_code == 200, submitted.text
    result = await client.post(
        f"/quiz/{sid}/actions",
        json={"action_id": str(uuid.uuid4()), "question_id": qid, "action": "advance"},
    )
    assert result.status_code == 200, result.text


async def test_review_subset_completes_step_without_completing_whole_material(plan_http):
    client, factory, *_ = plan_http
    plan = (await publish(plan_http))["plan"]
    started = await start_step(client, plan, plan["steps"][0])
    await finish_quiz(client, started["session_id"])
    plan = (await client.get("/analytics/me/guidance")).json()["plan"]
    review = next(s for s in plan["steps"] if s["status"] == "pending")
    started = await start_step(client, plan, review)
    lesson = (await client.get(f"/learning/sessions/{started['session_id']}")).json()
    assert lesson["scope"] == "planned_review"
    result = await client.post(
        f"/learning/sessions/{started['session_id']}/actions",
        json={"request_id": str(uuid.uuid4()), "revision": lesson["revision"], "action": "finish"},
    )
    assert result.status_code == 200, result.text
    assert result.json()["learning_progress"]["status"] != "completed"
    plan = (await client.get("/analytics/me/guidance")).json()["plan"]
    assert plan["status"] == "completed"
    assert all(s["status"] == "completed" for s in plan["steps"])
    async with factory() as db:
        assert await db.scalar(select(func.count()).select_from(models.LearningPlan)) == 1


async def test_unrelated_quiz_result_does_not_finish_linked_step(plan_http):
    client, _, _, material, *_ = plan_http
    plan = (await publish(plan_http))["plan"]
    started = await start_step(client, plan, plan["steps"][0])
    unrelated = await client.post(
        "/quiz/start",
        json={
            "class_id": str(material.class_id),
            "material_id": str(material.id),
            "n_questions": 1,
        },
    )
    assert unrelated.status_code == 200, unrelated.text
    assert unrelated.json()["quiz_session_id"] != started["session_id"]
    await finish_quiz(client, unrelated.json()["quiz_session_id"])
    after = (await client.get("/analytics/me/guidance")).json()["plan"]
    assert after["steps"][0]["status"] == "in_progress"


@pytest.mark.skipif(
    os.getenv("KODMOD_GUIDED_POSTGRES") != "1",
    reason="Concurrent refresh depends on PostgreSQL row-level locks.",
)
async def test_two_tabs_create_one_job_and_one_active_cycle(plan_http):
    import asyncio

    client, factory, *_ = plan_http
    results = await asyncio.gather(
        *[client.post("/analytics/me/guidance/refresh", json=refresh_body()) for _ in range(2)]
    )
    assert [r.status_code for r in results] == [202, 202], [r.text for r in results]
    assert results[0].json()["job_id"] == results[1].json()["job_id"]
    async with factory() as db:
        assert await db.scalar(select(func.count()).select_from(models.LearningPlan)) == 1


async def test_stale_worker_cannot_publish_or_hold_learner_lock_during_model(
    plan_http, monkeypatch
):
    import asyncio
    from types import SimpleNamespace

    from agents import planner_agent
    from api import durable_jobs, material_worker

    client, factory, controls, *_ = plan_http
    entered, release = asyncio.Event(), asyncio.Event()
    calls = []

    class Model:
        async def ainvoke(self, messages):
            calls.append(messages)
            entered.set()
            await release.wait()
            return SimpleNamespace(content="invalid")

    monkeypatch.setattr(planner_agent, "get_recommendation_llm", lambda: Model())
    await client.post("/analytics/me/guidance/refresh", json=refresh_body())
    job = await durable_jobs.claim(kinds=["progress_plan"])
    task = asyncio.create_task(material_worker.run_job(job))
    try:
        await asyncio.wait_for(entered.wait(), 3)
        async with factory() as db:
            assert await db.scalar(
                select(models.User.id)
                .where(models.User.id == controls["actor"].id)
                .with_for_update(nowait=True)
            )
            row = await db.get(models.BackgroundJob, job.id)
            row.lease_token = uuid.uuid4()
            await db.commit()
    finally:
        release.set()
        await asyncio.wait_for(task, 3)
    async with factory() as db:
        assert (await db.scalar(select(models.LearningPlan))).revision == 0
        assert await db.scalar(select(func.count()).select_from(models.LearningPlanStep)) == 0
    assert len(calls) == 1


async def test_regeneration_preserves_started_step_and_pending_identity(plan_http):
    from api import durable_jobs, material_worker

    client, _, _, material, *_ = plan_http
    plan = (await publish(plan_http))["plan"]
    await start_step(client, plan, plan["steps"][0])
    unrelated = await client.post(
        "/quiz/start",
        json={
            "class_id": str(material.class_id),
            "material_id": str(material.id),
            "n_questions": 1,
        },
    )
    await finish_quiz(client, unrelated.json()["quiz_session_id"])
    job = await durable_jobs.claim(kinds=["progress_plan"])
    assert job is not None
    await material_worker.run_job(job)
    after = (await client.get("/analytics/me/guidance")).json()["plan"]
    assert after["steps"][0]["id"] == plan["steps"][0]["id"]
    assert after["steps"][0]["status"] == "in_progress"
    assert after["steps"][1]["id"] == plan["steps"][1]["id"]
    assert len(after["steps"]) <= 3


async def test_teacher_edit_queues_source_refresh_and_old_step_cannot_start(plan_http):
    client, factory, controls, material, *_ = plan_http
    plan = (await publish(plan_http))["plan"]
    original_actor = controls["actor"]
    async with factory() as db:
        room = await db.get(models.Classroom, material.class_id)
        controls["actor"] = await db.get(models.User, room.teacher_id)
    changed = await client.put(
        f"/classes/{material.class_id}/materials/{material.id}",
        json={
            "title": material.title,
            "content": TEXT + " Tambahan contoh baru.",
            "published": True,
        },
    )
    assert changed.status_code == 200, changed.text
    controls["actor"] = original_actor
    async with factory() as db:
        assert (
            await db.scalar(
                select(func.count())
                .select_from(models.BackgroundJob)
                .where(
                    models.BackgroundJob.kind == "progress_plan",
                    models.BackgroundJob.state == "pending",
                )
            )
            == 1
        )
    response = await client.post(
        f"/analytics/me/plans/{plan['id']}/steps/{plan['steps'][0]['id']}/start",
        json={"request_id": str(uuid.uuid4()), "expected_revision": plan["revision"]},
    )
    assert response.status_code == 409


async def test_completed_cycle_waits_for_explicit_new_cycle_and_skip_has_no_mastery(plan_http):
    client, factory, *_ = plan_http
    plan = (await publish(plan_http))["plan"]
    for step in plan["steps"]:
        result = await client.post(
            f"/analytics/me/plans/{plan['id']}/steps/{step['id']}/skip",
            json={"request_id": str(uuid.uuid4()), "expected_revision": plan["revision"]},
        )
        assert result.status_code == 200, result.text
        plan = (await client.get("/analytics/me/guidance")).json()["plan"]
    assert plan["status"] == "completed"
    assert (await client.get("/analytics/me/guidance?window=week")).json()["plan"]["id"] == plan[
        "id"
    ]
    async with factory() as db:
        assert await db.scalar(select(func.count()).select_from(models.MasteryEvent)) == 0
        assert await db.scalar(select(func.count()).select_from(models.QuizAttempt)) == 0
        assert await db.scalar(select(func.count()).select_from(models.LearningPlan)) == 1
    next_cycle = await client.post(
        "/analytics/me/guidance/refresh", json=refresh_body(plan["revision"])
    )
    assert next_cycle.status_code == 202, next_cycle.text
    assert next_cycle.json()["plan_id"] != plan["id"]


@pytest.mark.parametrize("full_before_review", [False, True])
async def test_regular_tutor_start_never_resumes_a_planner_review(plan_http, full_before_review):
    client, _, _, material, *_ = plan_http

    async def start_full():
        response = await client.post(
            "/learning/start",
            json={"class_id": str(material.class_id), "material_id": str(material.id)},
        )
        assert response.status_code == 200, response.text
        return response.json()

    original = await start_full() if full_before_review else None
    plan = (await publish(plan_http))["plan"]
    review = next(step for step in plan["steps"] if step["kind"] == "review_unit")
    started = await start_step(client, plan, review)

    full = await start_full()
    assert full["scope"] == "full_material"
    assert full["session_id"] != started["session_id"]
    assert "quiz" in full["available_actions"]
    if original:
        assert full["session_id"] == original["session_id"]
    planned = (await client.get(f"/learning/sessions/{started['session_id']}")).json()
    assert planned["scope"] == "planned_review"
    assert planned["phase"] == "learning"

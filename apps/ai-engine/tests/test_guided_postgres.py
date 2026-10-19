"""Guided lesson row locks and migration proof in disposable test schemas."""

import asyncio
import os
import uuid
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from api import learning_service
from database.models import LearningActionReceipt, LearningSession, User
from sqlalchemy import create_engine, func, inspect, select, text

from tests.unit.test_guided_learning import action_body, open_lesson
from tests.unit.test_guided_learning import learning_http as learning_http

pytestmark = pytest.mark.skipif(
    os.getenv("KODMOD_GUIDED_POSTGRES") != "1", reason="Dedicated PostgreSQL test DB required"
)


async def test_admin_material_update_waits_for_class_before_locking_material(learning_http):
    from api.routes import admin_materials, classrooms
    from database.models import ClassMaterial, Classroom
    from fastapi import BackgroundTasks

    _, factory, _, material, _, admin = learning_http
    async with factory() as teacher_session, factory() as admin_session:
        teacher_pid = await teacher_session.scalar(text("SELECT pg_backend_pid()"))
        admin_pid = await admin_session.scalar(text("SELECT pg_backend_pid()"))
        await teacher_session.scalar(
            select(Classroom).where(Classroom.id == material.class_id).with_for_update()
        )
        task = asyncio.create_task(
            admin_materials.update_material(
                material.id,
                classrooms.MaterialWrite(
                    title=material.title, content=material.content, published=True
                ),
                BackgroundTasks(),
                actor=admin,
                session=admin_session,
            )
        )
        try:
            blocked = False
            for _ in range(100):
                async with factory() as monitor:
                    blockers = await monitor.scalar(
                        text("SELECT pg_blocking_pids(:pid)"), {"pid": admin_pid}
                    )
                if teacher_pid in blockers:
                    blocked = True
                    break
                await asyncio.sleep(0.02)
            assert blocked, "admin did not reach the controlled classroom lock"
            await asyncio.wait_for(
                teacher_session.scalar(
                    select(ClassMaterial).where(ClassMaterial.id == material.id).with_for_update()
                ),
                timeout=0.8,
            )
            await teacher_session.commit()
            await asyncio.wait_for(task, timeout=5)
        finally:
            if not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)


async def test_republish_before_finish_keeps_non_ready_index_retryable(learning_http, monkeypatch):
    from api import durable_jobs as jobs
    from database.models import ClassMaterial

    _, factory, _, material, _, _ = learning_http
    monkeypatch.setattr(jobs, "async_session", factory)
    async with factory() as session:
        row = await session.get(ClassMaterial, material.id)
        row.rag_status = "pending"
        await jobs.enqueue_material(session, row)
        await session.commit()
    claimed = await jobs.claim()
    with pytest.raises(ValueError, match="not ready"):
        await jobs.finish(claimed.id, claimed.lease_token, require_ready=True)
    assert await jobs.fail(claimed.id, claimed.lease_token)
    async with factory() as session:
        from database.models import BackgroundJob

        assert (await session.get(BackgroundJob, claimed.id)).state == "retry"


async def test_exhausted_worker_lease_marks_matching_material_failed(learning_http, monkeypatch):
    from datetime import UTC, datetime, timedelta

    from api import durable_jobs as jobs
    from database.models import BackgroundJob, ClassMaterial

    _, factory, _, material, _, _ = learning_http
    monkeypatch.setattr(jobs, "async_session", factory)
    async with factory() as session:
        row = await session.get(ClassMaterial, material.id)
        row.rag_status = "processing"
        job = await jobs.enqueue_material(session, row)
        job.state, job.attempts = "running", job.max_attempts
        job.lease_token = uuid.uuid4()
        job.lease_expires_at = datetime.now(UTC) - timedelta(seconds=1)
        job_id = job.id
        await session.commit()
    assert await jobs.claim() is None
    async with factory() as session:
        assert (await session.get(BackgroundJob, job_id)).state == "failed"
        row = await session.get(ClassMaterial, material.id)
        assert row.rag_status == "failed" and row.rag_error == jobs.ERROR


def test_guided_migration_upgrade_downgrade_preserves_existing_lessons():
    # A completely fresh database also tests first-install migrations. A schema
    # search_path including public can accidentally see its alembic_version.
    admin = create_engine(
        "postgresql+psycopg://kodmod:kodmod@127.0.0.1:5434/kodmod_test",
        isolation_level="AUTOCOMMIT",
    )
    name = "guided_migration_" + uuid.uuid4().hex
    engine = None
    try:
        with admin.connect() as connection:
            connection.execute(text(f'CREATE DATABASE "{name}"'))
        engine = create_engine(f"postgresql+psycopg://kodmod:kodmod@127.0.0.1:5434/{name}")
        with engine.begin() as connection:
            config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
            config.attributes["connection"] = connection
            schema = "public"
            command.upgrade(config, "0006_editorial_quizzes")
            assert "guided_state" not in {
                c["name"]
                for c in inspect(connection).get_columns("learning_sessions", schema=schema)
            }
            user_id, lesson_id = uuid.uuid4(), uuid.uuid4()
            connection.execute(
                User.__table__.insert().values(
                    id=user_id,
                    username="migration-learner",
                    full_name="Migration learner",
                    password_hash="test-only",
                    role="student",
                )
            )
            connection.execute(
                LearningSession.__table__.insert().values(
                    id=lesson_id,
                    student_id=user_id,
                    title="Existing lesson",
                    mode="tutoring",
                )
            )
            command.upgrade(config, "0007_guided_learning")
            assert "guided_state" in {
                c["name"]
                for c in inspect(connection).get_columns("learning_sessions", schema=schema)
            }
            assert "learning_action_receipts" in inspect(connection).get_table_names(schema=schema)
            command.downgrade(config, "0006_editorial_quizzes")
            assert "learning_action_receipts" not in inspect(connection).get_table_names(
                schema=schema
            )
            command.upgrade(config, "0007_guided_learning")
            assert (
                connection.scalar(text(f'SELECT version_num FROM "{schema}".alembic_version'))
                == "0007_guided_learning"
            )
            command.upgrade(config, "head")
            assert "audit_events" in inspect(connection).get_table_names(schema=schema)
            assert "quiz_question_outcomes" in inspect(connection).get_table_names(schema=schema)
            assert "material_learning_progress" in inspect(connection).get_table_names(
                schema=schema
            )
            command.downgrade(config, "0011_provider_usage")
            assert "quiz_question_outcomes" not in inspect(connection).get_table_names(
                schema=schema
            )
            command.upgrade(config, "head")
            assert (
                connection.scalar(text(f'SELECT version_num FROM "{schema}".alembic_version'))
                == ScriptDirectory.from_config(config).get_current_head()
            )
            assert (
                connection.scalar(
                    select(LearningSession.title).where(LearningSession.id == lesson_id)
                )
                == "Existing lesson"
            )
            assert (
                connection.scalar(
                    select(LearningSession.guided_state).where(LearningSession.id == lesson_id)
                )
                is None
            )
    finally:
        if engine is not None:
            engine.dispose()
        assert name.startswith("guided_migration_") and len(name) == 49
        with admin.connect() as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{name}"'))
        admin.dispose()


async def overlapping_teaching(monkeypatch, first, second):
    entered, release = asyncio.Event(), asyncio.Event()
    original, calls = learning_service.teach, 0

    async def held(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            entered.set()
            await asyncio.wait_for(release.wait(), 10)
        return await original(*args, **kwargs)

    monkeypatch.setattr(learning_service, "teach", held)
    one = asyncio.create_task(first())
    await asyncio.wait_for(entered.wait(), 10)
    two = asyncio.create_task(second())
    try:
        await asyncio.sleep(0.12)
        assert not two.done(), "Second operation must wait for the canonical PostgreSQL row"
    finally:
        release.set()
    return await asyncio.gather(one, two)


async def test_concurrent_start_teaches_once_and_returns_same_session(learning_http, monkeypatch):
    client, factory, _, material, _, _ = learning_http

    async def start():
        return await open_lesson(client, material)

    one, two = await overlapping_teaching(monkeypatch, start, start)
    assert one == two
    async with factory() as session:
        assert await session.scalar(select(func.count()).select_from(LearningSession)) == 1


@pytest.mark.parametrize("same_request", [True, False])
async def test_concurrent_continue_advances_one_unit(learning_http, monkeypatch, same_request):
    client, factory, _, material, _, _ = learning_http
    state = await open_lesson(client, material)
    path = f"/learning/sessions/{state['session_id']}/actions"
    body = action_body(state, "continue")

    async def first():
        return await client.post(path, json=body)

    async def second():
        payload = body if same_request else {**body, "request_id": str(uuid.uuid4())}
        return await client.post(path, json=payload)

    one, two = await overlapping_teaching(monkeypatch, first, second)
    assert one.status_code == 200 and two.status_code == (200 if same_request else 409)
    if same_request:
        assert one.json() == two.json()
    async with factory() as session:
        lesson = await session.get(LearningSession, uuid.UUID(state["session_id"]))
        assert lesson.guided_state["unit_index"] == lesson.guided_state["revision"] == 1
        assert await session.scalar(select(func.count()).select_from(LearningActionReceipt)) == 1

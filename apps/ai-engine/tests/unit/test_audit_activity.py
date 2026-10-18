"""Tests for AuditEvent recording, admin activity feed and category filtering."""

import uuid

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from api import audit_service
from api.dependencies import current_user, db_session, require_admin
from api.routes import admin, admin_insights, auth
from database import models

pytestmark = pytest.mark.unit


@pytest.fixture
async def audit_http():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    names = [
        "users",
        "invitation_codes",
        "classrooms",
        "enrollments",
        "class_materials",
        "material_imports",
        "background_jobs",
        "class_activities",
        "audit_events",
        "subjects",
        "concepts",
        "learning_sessions",
        "interaction_logs",
        "quiz_sessions",
        "mastery_scores",
    ]
    async with engine.begin() as conn:
        await conn.run_sync(
            lambda c: models.Base.metadata.create_all(
                c, tables=[models.Base.metadata.tables[n] for n in names]
            )
        )

    admin_user = models.User(
        id=uuid.uuid4(),
        username="admin_test",
        full_name="Administrator Test",
        role="admin",
        password_hash="fakehash",
        is_active=True,
    )
    student_user = models.User(
        id=uuid.uuid4(),
        username="student_test",
        full_name="Student Test",
        role="student",
        password_hash="fakehash",
        is_active=True,
    )

    async with factory() as session:
        session.add_all([admin_user, student_user])
        await session.commit()

    controls = {"actor": admin_user}

    async def get_test_session():
        async with factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    async def get_test_user():
        return controls["actor"]

    app = FastAPI()
    app.dependency_overrides[db_session] = get_test_session
    app.dependency_overrides[current_user] = get_test_user
    app.dependency_overrides[require_admin] = get_test_user

    app.include_router(auth.router, prefix="/auth")
    app.include_router(admin.router, prefix="/admin")
    app.include_router(admin_insights.router, prefix="/admin")

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        yield client, factory, controls, admin_user, student_user

    await engine.dispose()


async def test_record_audit_helper(audit_http):
    client, factory, controls, admin_user, student_user = audit_http
    async with factory() as session:
        event = audit_service.record_audit(
            session,
            action="custom.action",
            category="account",
            actor=admin_user,
            target_type="user",
            target_id=student_user.id,
            target_name=student_user.full_name,
            details={"notes": "test note"},
        )
        await session.commit()
        assert event.id is not None
        assert event.actor_name == "Administrator Test"
        assert event.actor_role == "admin"
        assert event.target_name == "Student Test"
        assert event.details == {"notes": "test note"}


async def test_admin_user_crud_records_audit_events(audit_http):
    client, factory, controls, admin_user, _ = audit_http

    # 1. Create User
    res = await client.post(
        "/admin/users",
        json={
            "username": "guru_baru",
            "password": "ValidPassword123!",
            "full_name": "Guru Baru",
            "role": "teacher",
        },
    )
    assert res.status_code == 201
    created_id = res.json()["id"]

    # 2. Update User (deactivate)
    res = await client.patch(
        f"/admin/users/{created_id}",
        json={"is_active": False},
    )
    assert res.status_code == 200

    # 3. Delete User
    res = await client.delete(f"/admin/users/{created_id}")
    assert res.status_code == 204

    # 4. Check audit events in DB
    async with factory() as session:
        events = (
            (
                await session.execute(
                    select(models.AuditEvent).order_by(models.AuditEvent.created_at.asc())
                )
            )
            .scalars()
            .all()
        )
        actions = [e.action for e in events]
        assert "user.created" in actions
        assert "user.deactivated" in actions
        assert "user.deleted" in actions

        # Verify target_name survived deletion
        deleted_event = next(e for e in events if e.action == "user.deleted")
        assert "Guru Baru" in deleted_event.target_name


async def test_admin_deletes_student_with_learning_history(audit_http):
    client, factory, _, admin_user, student = audit_http
    session_id = uuid.uuid4()
    interaction_id = uuid.uuid4()
    async with factory() as session:
        session.add(
            models.LearningSession(
                id=session_id,
                student_id=student.id,
                mode="guided_tutoring",
                guided_state={"phase": "learning"},
            )
        )
        session.add(
            models.InteractionLog(
                id=interaction_id,
                session_id=session_id,
                role="assistant",
                text="Test transcript",
            )
        )
        await session.commit()

    response = await client.delete(f"/admin/users/{student.id}")
    assert response.status_code == 204, response.text

    async with factory() as session:
        assert await session.get(models.User, student.id) is None
        assert await session.get(models.LearningSession, session_id) is None
        assert await session.get(models.InteractionLog, interaction_id) is None
        deleted_event = await session.scalar(
            select(models.AuditEvent).where(
                models.AuditEvent.action == "user.deleted",
                models.AuditEvent.target_id == str(student.id),
            )
        )
        assert deleted_event is not None
        assert deleted_event.actor_id == admin_user.id


async def test_password_reset_does_not_report_unchanged_role_as_a_change(audit_http):
    client, factory, _, _, student = audit_http
    response = await client.patch(
        f"/admin/users/{student.id}",
        json={
            "full_name": student.full_name,
            "role": student.role,
            "new_password": "replacement-test-123",
        },
    )
    assert response.status_code == 200
    async with factory() as session:
        event = await session.scalar(select(models.AuditEvent))
        assert event.action == "user.password_reset"
        assert event.details == {"password_reset": True}
        assert "replacement-test-123" not in str(event.details)


async def test_admin_invitation_crud_records_audit_events(audit_http):
    client, factory, controls, admin_user, _ = audit_http

    # 1. Create Invitation
    res = await client.post(
        "/admin/invitations",
        json={"label": "Kelas A", "max_uses": 5, "expires_in_days": 7},
    )
    assert res.status_code == 201
    invite_id = res.json()["id"]

    # 2. Delete Invitation
    res = await client.delete(f"/admin/invitations/{invite_id}")
    assert res.status_code == 204

    async with factory() as session:
        events = (
            (
                await session.execute(
                    select(models.AuditEvent).order_by(models.AuditEvent.created_at.asc())
                )
            )
            .scalars()
            .all()
        )
        actions = [e.action for e in events]
        assert "invitation.created" in actions
        assert "invitation.revoked" in actions


async def test_activity_endpoint_merges_and_filters_categories(audit_http):
    client, factory, controls, admin_user, student_user = audit_http

    # Seed audit event
    async with factory() as session:
        audit_service.record_audit(
            session,
            action="user.role_changed",
            category="account",
            actor=admin_user,
            target_type="user",
            target_id=student_user.id,
            target_name=student_user.full_name,
        )
        audit_service.record_audit(
            session,
            action="invitation.created",
            category="invitation",
            actor=admin_user,
            target_type="invitation",
            target_name="INV-1234",
        )
        await session.commit()

    # 1. Fetch all activity
    res = await client.get("/admin/activity?limit=30")
    assert res.status_code == 200
    body = res.json()
    items = body["items"]
    assert len(items) >= 2
    actions = [i["action"] for i in items]
    assert "user.role_changed" in actions
    assert "invitation.created" in actions

    # 2. Filter by category "invitation"
    res_inv = await client.get("/admin/activity?limit=30&category=invitation")
    assert res_inv.status_code == 200
    inv_items = res_inv.json()["items"]
    assert all(i.get("category") == "invitation" for i in inv_items)
    assert any(i["action"] == "invitation.created" for i in inv_items)
    assert not any(i["action"] == "user.role_changed" for i in inv_items)

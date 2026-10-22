"""Isolated editorial HTTP lifecycle with real authentication and SQL persistence."""

import os
import uuid
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from api.dependencies import db_session
from api.main import app
from api.security import create_access_token
from database import models as db

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def editorial_http(request):
    pg = request.node.get_closest_marker("db") is not None
    schema = "editorial_" + uuid.uuid4().hex
    if pg:
        if os.environ.get("KODMOD_EDITORIAL_POSTGRES") != "1":
            pytest.skip("Enable isolated PostgreSQL editorial tests explicitly.")
        url = "postgresql+asyncpg://kodmod:kodmod@127.0.0.1:5434/kodmod_test"
        control = create_async_engine(url)
        async with control.begin() as connection:
            await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        engine = create_async_engine(
            url, poolclass=NullPool, connect_args={"server_settings": {"search_path": schema}}
        )
    else:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    names = {
        "users",
        "subjects",
        "concepts",
        "classrooms",
        "enrollments",
        "quiz_drafts",
        "quiz_draft_versions",
        "quiz_draft_questions",
        "quiz_review_events",
        "quiz_assignments",
        "assignment_attempts",
        "assignment_answers",
        "audit_events",
        "learning_plans",
        "learning_plan_steps",
    }
    async with engine.begin() as connection:
        if not pg:
            await connection.execute(text("PRAGMA foreign_keys=ON"))
        await connection.run_sync(
            lambda c: db.Base.metadata.create_all(
                c, tables=[t for t in db.Base.metadata.sorted_tables if t.name in names]
            )
        )
    actors = {}
    async with factory() as session:
        for name, role in [
            ("owner", "teacher"),
            ("reviewer", "teacher"),
            ("other", "teacher"),
            ("admin", "admin"),
            ("student", "student"),
            ("outsider", "student"),
        ]:
            auth_session_id = uuid.uuid4()
            auth_session_expires_at = datetime.now(UTC) + timedelta(hours=1)
            actors[name] = db.User(
                id=uuid.uuid4(),
                username=name,
                full_name=name,
                password_hash="fixture",
                role=role,
                is_active=True,
                active_auth_session_id=auth_session_id,
                active_auth_session_expires_at=auth_session_expires_at,
            )
            session.add(actors[name])
        subject = db.Subject(id=uuid.uuid4(), name="Matematika")
        session.add(subject)
        await session.flush()
        classroom = db.Classroom(
            id=uuid.uuid4(), teacher_id=actors["owner"].id, name="Kelas 7", subject="Matematika"
        )
        session.add(classroom)
        await session.flush()
        session.add(db.Enrollment(class_id=classroom.id, student_id=actors["student"].id))
        await session.commit()

    async def transaction():
        async with factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    previous = app.dependency_overrides.copy()
    app.dependency_overrides[db_session] = transaction
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://editorial.test"
    ) as client:

        def headers(name):
            user = actors[name]
            return {
                "Authorization": "Bearer "
                + create_access_token(
                    subject=str(user.id),
                    role=user.role,
                    session_id=str(user.active_auth_session_id),
                    expires_at=user.active_auth_session_expires_at,
                )
            }

        yield client, factory, actors, subject, classroom, headers
    app.dependency_overrides.clear()
    app.dependency_overrides.update(previous)
    await engine.dispose()
    if pg:
        async with control.begin() as connection:
            await connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await control.dispose()


def draft_body(subject):
    return {
        "subject_id": str(subject.id),
        "title": "Latihan pecahan",
        "description": "Pahami pecahan.",
        "release_policy": "after_submission",
        "questions": [
            {
                "order_index": 1,
                "prompt": "Setengah ditambah setengah sama dengan?",
                "narration": "Setengah ditambah setengah sama dengan berapa?",
                "options": [{"id": "a", "label": "Satu"}, {"id": "b", "label": "Dua"}],
                "correct_option_id": "a",
                "explanation": "Dua setengah menjadi satu.",
                "difficulty": "easy",
            }
        ],
    }


async def test_teacher_can_create_owned_manual_draft(editorial_http):
    client, _, _, subject, _, headers = editorial_http
    response = await client.post(
        "/teacher/quizzes", json=draft_body(subject), headers=headers("owner")
    )
    assert response.status_code == 201, response.text
    saved = response.json()
    assert saved["current_version"] == 1
    assert saved["version"]["state"] == "draft"
    assert saved["version"]["questions"][0]["correct_option_id"] == "a"


def action(draft):
    return {
        "version_id": draft["version"]["id"],
        "expected_review_revision": draft["version"]["review_revision"],
    }


async def create(env, **changes):
    client, _, _, subject, _, headers = env
    response = await client.post(
        "/teacher/quizzes", json=draft_body(subject) | changes, headers=headers("owner")
    )
    assert response.status_code == 201, response.text
    return response.json()


async def transition(env, draft, name, actor="owner", **changes):
    client, _, _, _, _, headers = env
    response = await client.post(
        f"/teacher/quizzes/{draft['id']}/{name}",
        json=action(draft) | changes,
        headers=headers(actor),
    )
    assert response.status_code == 200, response.text
    return response.json()


async def assigned(env, **draft_changes):
    client, _, _, _, classroom, headers = env
    draft = await create(env, **draft_changes)
    draft = await transition(env, draft, "submit-review")
    draft = await transition(env, draft, "approve", "admin")
    draft = await transition(env, draft, "publish")
    body = {"version_id": draft["version"]["id"], "class_id": str(classroom.id)}
    if draft_changes.get("release_policy") == "after_due":
        body["due_at"] = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    response = await client.post(
        f"/teacher/quizzes/{draft['id']}/assignments", json=body, headers=headers("owner")
    )
    assert response.status_code == 201, response.text
    return draft, response.json()


async def answered(env, assignment, option="a"):
    client, _, _, _, _, headers = env
    base = f"/student/assignments/{assignment['id']}"
    start = await client.post(base + "/start", headers=headers("student"))
    assert start.status_code == 201, start.text
    attempt = start.json()
    response = await client.put(
        base + f"/answers/{attempt['questions'][0]['id']}",
        json={"expected_revision": attempt["revision"], "option_id": option},
        headers=headers("student"),
    )
    assert response.status_code == 200, response.text
    return response.json()


async def test_full_lifecycle_resumes_grades_and_scopes_results(editorial_http):
    env = editorial_http
    client, factory, actors, _, _, headers = env
    draft, assignment = await assigned(env)
    attempt = await answered(env, assignment)
    assert attempt["revision"] == 1
    resumed = await client.post(
        f"/student/assignments/{assignment['id']}/start", headers=headers("student")
    )
    assert resumed.status_code == 200
    assert resumed.json() == attempt
    key = str(uuid.uuid4())
    result = await client.post(
        f"/student/assignments/{assignment['id']}/submit",
        json={"expected_revision": 1},
        headers=headers("student") | {"Idempotency-Key": key},
    )
    assert result.status_code == 200, result.text
    assert result.json()["score"] == 100
    assert result.json()["review"][0]["explanation"] == "Dua setengah menjadi satu."
    teacher = await client.get(
        f"/teacher/assignments/{assignment['id']}/results", headers=headers("owner")
    )
    assert teacher.json()["submitted_count"] == 1
    assert teacher.json()["average_score"] == 100
    assert teacher.json()["results"][0]["student_id"] == str(actors["student"].id)
    for actor in ["other", "reviewer", "admin", "outsider"]:
        denied = await client.get(
            f"/teacher/assignments/{assignment['id']}/results", headers=headers(actor)
        )
        assert denied.status_code in {403, 404}
    async with factory() as session:
        assert len((await session.scalars(select(db.AssignmentAttempt))).all()) == 1
        assert len((await session.scalars(select(db.AssignmentAnswer))).all()) == 1
        assert len((await session.scalars(select(db.QuizReviewEvent))).all()) == 4


async def test_submission_receipt_replays_after_closure_and_conflicts_on_changed_payload(
    editorial_http,
):
    env = editorial_http
    client, _, _, _, _, headers = env
    _, assignment = await assigned(env)
    attempt = await answered(env, assignment, "b")
    url = f"/student/assignments/{assignment['id']}/submit"
    auth = headers("student") | {"Idempotency-Key": str(uuid.uuid4())}
    body = {"expected_revision": attempt["revision"]}
    first = await client.post(url, json=body, headers=auth)
    assert first.status_code == 200 and first.json()["score"] == 0
    await client.post(f"/teacher/assignments/{assignment['id']}/close", headers=headers("owner"))
    replay = await client.post(url, json=body, headers=auth)
    assert replay.status_code == 200 and replay.json() == first.json()
    assert (await client.post(url, json={"expected_revision": 99}, headers=auth)).status_code == 409
    assert (
        await client.post(
            url, json=body, headers=headers("student") | {"Idempotency-Key": str(uuid.uuid4())}
        )
    ).status_code == 409


async def test_published_assignment_survives_new_revision_and_stale_save_is_rejected(
    editorial_http,
):
    env = editorial_http
    client, factory, _, subject, _, headers = env
    old, assignment = await assigned(env)
    body = draft_body(subject) | {"expected_version": old["current_version"], "title": "Revisi dua"}
    body["questions"][0]["correct_option_id"] = "b"
    saved = await client.patch(f"/teacher/quizzes/{old['id']}", json=body, headers=headers("owner"))
    assert saved.status_code == 200, saved.text
    assert saved.json()["current_version"] == 2
    assert saved.json()["version"]["state"] == "draft"
    assert (
        await client.patch(f"/teacher/quizzes/{old['id']}", json=body, headers=headers("owner"))
    ).status_code == 409
    attempt = await answered(env, assignment)
    result = await client.post(
        f"/student/assignments/{assignment['id']}/submit",
        json={"expected_revision": attempt["revision"]},
        headers=headers("student") | {"Idempotency-Key": str(uuid.uuid4())},
    )
    assert result.json()["score"] == 100
    async with factory() as session:
        version = await session.get(db.QuizDraftVersion, uuid.UUID(old["version"]["id"]))
        assert version.state == "published"


async def test_review_capability_reassignment_and_exact_revision(editorial_http):
    env = editorial_http
    client, _, actors, _, _, headers = env
    draft = await create(env)
    bad = await client.post(
        f"/teacher/quizzes/{draft['id']}/reviewer",
        json=action(draft) | {"reviewer_id": str(actors["owner"].id)},
        headers=headers("owner"),
    )
    assert bad.status_code == 422
    draft = await transition(env, draft, "reviewer", reviewer_id=str(actors["reviewer"].id))
    draft = await transition(env, draft, "submit-review")
    assert (await client.get("/quiz-reviews", headers=headers("other"))).json() == []
    assert len((await client.get("/quiz-reviews", headers=headers("reviewer"))).json()) == 1
    self_review = await client.post(
        f"/teacher/quizzes/{draft['id']}/approve", json=action(draft), headers=headers("owner")
    )
    assert self_review.status_code == 403
    old_action = action(draft)
    draft = await transition(env, draft, "reviewer", "admin", reviewer_id=str(actors["other"].id))
    assert (
        await client.get(f"/teacher/quizzes/{draft['id']}", headers=headers("reviewer"))
    ).status_code == 404
    assert (
        await client.post(
            f"/teacher/quizzes/{draft['id']}/approve", json=old_action, headers=headers("other")
        )
    ).status_code == 409
    draft = await transition(env, draft, "approve", "other")
    assert draft["version"]["state"] == "approved"
    assert (
        await client.post(
            f"/teacher/quizzes/{draft['id']}/publish", json=old_action, headers=headers("owner")
        )
    ).status_code == 409


async def test_rejection_keeps_snapshot_and_requires_new_review(editorial_http):
    env = editorial_http
    client, factory, _, subject, _, headers = env
    draft = await transition(env, await create(env), "submit-review")
    draft = await transition(env, draft, "reject", "admin", note="Pembahasan perlu diperjelas.")
    assert draft["events"][-1]["note"] == "Pembahasan perlu diperjelas."
    assert (
        await client.post(
            f"/teacher/quizzes/{draft['id']}/publish", json=action(draft), headers=headers("owner")
        )
    ).status_code == 409
    saved = await client.patch(
        f"/teacher/quizzes/{draft['id']}",
        json=draft_body(subject) | {"expected_version": 1},
        headers=headers("owner"),
    )
    assert saved.status_code == 200 and saved.json()["version"]["state"] == "draft"
    async with factory() as session:
        old = await session.get(db.QuizDraftVersion, uuid.UUID(draft["version"]["id"]))
        assert old.state == "rejected"


async def test_inactive_reviewer_and_foreign_owner_are_denied(editorial_http):
    env = editorial_http
    client, factory, actors, subject, _, headers = env
    draft = await create(env)
    assert (
        await client.get(f"/teacher/quizzes/{draft['id']}", headers=headers("other"))
    ).status_code == 404
    assert (
        await client.patch(
            f"/teacher/quizzes/{draft['id']}",
            json=draft_body(subject) | {"expected_version": 1},
            headers=headers("other"),
        )
    ).status_code == 404
    draft = await transition(env, draft, "reviewer", reviewer_id=str(actors["reviewer"].id))
    async with factory() as session:
        actor = await session.get(db.User, actors["reviewer"].id)
        actor.is_active = False
        await session.commit()
    assert (
        await client.post(
            f"/teacher/quizzes/{draft['id']}/submit-review",
            json=action(draft),
            headers=headers("owner"),
        )
    ).status_code == 422
    assert (await client.get("/quiz-reviews", headers=headers("reviewer"))).status_code == 403


@pytest.mark.parametrize("decision", ["approve", "reject"])
@pytest.mark.parametrize("revocation", ["inactive", "demoted"])
@pytest.mark.parametrize("actor_name", ["reviewer", "admin"])
async def test_reviewer_revoked_after_auth_cannot_decide(
    editorial_http, monkeypatch, decision, revocation, actor_name
):
    from api import editorial_quiz_service as service

    env = editorial_http
    client, factory, actors, _, _, headers = env
    draft = await create(env)
    draft = await transition(env, draft, "reviewer", reviewer_id=str(actors["reviewer"].id))
    draft = await transition(env, draft, "submit-review")
    original = service.draft_for

    async def revoke_before_lock(session, draft_id, actor, **kwargs):
        # Authentication has already read this actor. Another committed admin
        # transaction revokes capability before the waiting decision gets its lock.
        assert actor.is_active and actor.role in {"teacher", "admin"}
        async with factory() as other:
            reviewer = await other.get(db.User, actors[actor_name].id)
            if revocation == "inactive":
                reviewer.is_active = False
            else:
                reviewer.role = "student"
            await other.commit()
        return await original(session, draft_id, actor, **kwargs)

    monkeypatch.setattr(service, "draft_for", revoke_before_lock)
    response = await client.post(
        f"/teacher/quizzes/{draft['id']}/{decision}",
        json=action(draft) | {"note": "Review setelah capability dicabut."},
        headers=headers(actor_name),
    )
    assert response.status_code == 403, response.text
    async with factory() as session:
        version = await session.get(db.QuizDraftVersion, uuid.UUID(draft["version"]["id"]))
        assert version.state == "in_review"
        kinds = list(await session.scalars(select(db.QuizReviewEvent.kind)))
        assert not {"approved", "rejected"}.intersection(kinds)


async def test_student_dto_does_not_expose_keys_and_release_policy_is_enforced(editorial_http):
    env = editorial_http
    client, factory, _, _, _, headers = env
    _, assignment = await assigned(env, release_policy="after_due")
    attempt = await answered(env, assignment)
    text_body = str(attempt)
    assert (
        "correct_option_id" not in text_body
        and "explanation" not in text_body
        and "feedback" not in text_body
    )
    key = str(uuid.uuid4())
    result = await client.post(
        f"/student/assignments/{assignment['id']}/submit",
        json={"expected_revision": 1},
        headers=headers("student") | {"Idempotency-Key": key},
    )
    assert result.status_code == 200
    assert result.json()["review"] == [] and not result.json()["feedback_released"]
    async with factory() as session:
        row = await session.get(db.QuizAssignment, uuid.UUID(assignment["id"]))
        row.due_at = datetime.now(UTC) - timedelta(minutes=1)
        await session.commit()
    released = await client.get(
        f"/student/assignments/{assignment['id']}/result", headers=headers("student")
    )
    assert released.json()["feedback_released"] and len(released.json()["review"]) == 1
    replay = await client.post(
        f"/student/assignments/{assignment['id']}/submit",
        json={"expected_revision": 1},
        headers=headers("student") | {"Idempotency-Key": key},
    )
    assert replay.json() == result.json()


@pytest.mark.parametrize(
    "barrier", ["future", "expired", "closed", "archived", "unenrolled", "foreign"]
)
async def test_assignment_access_and_schedule_barriers(editorial_http, barrier):
    env = editorial_http
    client, factory, actors, _, classroom, headers = env
    _, assignment = await assigned(env)
    async with factory() as session:
        row = await session.get(db.QuizAssignment, uuid.UUID(assignment["id"]))
        if barrier == "future":
            row.opens_at = datetime.now(UTC) + timedelta(days=1)
        if barrier == "expired":
            row.due_at = datetime.now(UTC) - timedelta(days=1)
        if barrier == "closed":
            row.is_closed = True
        if barrier == "archived":
            (await session.get(db.Classroom, classroom.id)).is_archived = True
        if barrier == "unenrolled":
            await session.delete(
                await session.get(db.Enrollment, (classroom.id, actors["student"].id))
            )
        await session.commit()
    actor = "outsider" if barrier == "foreign" else "student"
    response = await client.post(
        f"/student/assignments/{assignment['id']}/start", headers=headers(actor)
    )
    assert response.status_code == (
        404 if barrier in {"archived", "unenrolled", "foreign"} else 409
    )
    async with factory() as session:
        assert (await session.scalar(select(db.AssignmentAttempt))) is None


async def test_autosave_rejects_foreign_question_option_stale_revision_and_frozen_result(
    editorial_http,
):
    env = editorial_http
    client, _, _, _, _, headers = env
    _, assignment = await assigned(env)
    attempt = await answered(env, assignment)
    base = f"/student/assignments/{assignment['id']}"
    qid = attempt["questions"][0]["id"]
    for question_id, body, status in [
        (str(uuid.uuid4()), {"expected_revision": 1, "option_id": "a"}, 404),
        (qid, {"expected_revision": 1, "option_id": "nope"}, 422),
        (qid, {"expected_revision": 0, "option_id": "b"}, 409),
    ]:
        assert (
            await client.put(
                base + f"/answers/{question_id}", json=body, headers=headers("student")
            )
        ).status_code == status
    assert (
        await client.post(
            base + "/submit",
            json={"expected_revision": 0},
            headers=headers("student") | {"Idempotency-Key": str(uuid.uuid4())},
        )
    ).status_code == 409
    assert (
        await client.post(
            base + "/submit",
            json={"expected_revision": 1},
            headers=headers("student") | {"Idempotency-Key": str(uuid.uuid4())},
        )
    ).status_code == 200
    assert (
        await client.put(
            base + f"/answers/{qid}",
            json={"expected_revision": 2, "option_id": "b"},
            headers=headers("student"),
        )
    ).status_code == 409


async def test_commit_failure_rolls_back_grade_and_retry_can_succeed(editorial_http, monkeypatch):
    from sqlalchemy.exc import OperationalError

    from api import editorial_quiz_service as service

    env = editorial_http
    client, factory, _, _, _, headers = env
    _, assignment = await assigned(env)
    await answered(env, assignment)
    original = service.commit

    async def failing_commit(session):
        async def fail():
            raise OperationalError("fixture", {}, Exception("unavailable"))

        monkeypatch.setattr(session, "commit", fail)
        await original(session)

    monkeypatch.setattr(service, "commit", failing_commit)
    url = f"/student/assignments/{assignment['id']}/submit"
    auth = headers("student") | {"Idempotency-Key": str(uuid.uuid4())}
    response = await client.post(url, json={"expected_revision": 1}, headers=auth)
    assert response.status_code == 503
    async with factory() as session:
        row = await session.scalar(select(db.AssignmentAttempt))
        assert row.state == "in_progress" and row.score is None and row.receipt is None
    monkeypatch.setattr(service, "commit", original)
    assert (await client.post(url, json={"expected_revision": 1}, headers=auth)).status_code == 200


async def test_committed_result_denied_after_enrollment_revoked(editorial_http):
    env = editorial_http
    client, factory, actors, _, classroom, headers = env
    _, assignment = await assigned(env)
    await answered(env, assignment)
    url = f"/student/assignments/{assignment['id']}"
    auth = headers("student") | {"Idempotency-Key": str(uuid.uuid4())}
    assert (
        await client.post(url + "/submit", json={"expected_revision": 1}, headers=auth)
    ).status_code == 200
    async with factory() as session:
        await session.delete(await session.get(db.Enrollment, (classroom.id, actors["student"].id)))
        await session.commit()
    assert (
        await client.post(url + "/submit", json={"expected_revision": 1}, headers=auth)
    ).status_code == 404
    assert (await client.get(url + "/result", headers=headers("student"))).status_code == 404


async def test_foreign_class_unpublished_assignment_and_incomplete_submission_are_denied(
    editorial_http,
):
    env = editorial_http
    client, _, _, _, classroom, headers = env
    draft = await create(env)
    url = f"/teacher/quizzes/{draft['id']}/assignments"
    assert (
        await client.post(
            url,
            json={"version_id": draft["version"]["id"], "class_id": str(classroom.id)},
            headers=headers("owner"),
        )
    ).status_code == 409
    published, assignment = await assigned(env)
    assert (
        await client.post(
            f"/teacher/quizzes/{published['id']}/assignments",
            json={"version_id": published["version"]["id"], "class_id": str(uuid.uuid4())},
            headers=headers("owner"),
        )
    ).status_code == 404
    base = f"/student/assignments/{assignment['id']}"
    await client.post(base + "/start", headers=headers("student"))
    assert (
        await client.post(
            base + "/submit",
            json={"expected_revision": 0},
            headers=headers("student") | {"Idempotency-Key": str(uuid.uuid4())},
        )
    ).status_code == 422

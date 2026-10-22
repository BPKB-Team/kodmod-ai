"""Stage 3 - Integration: open registration and login.

Real Postgres, real bcrypt, no HTTP. These exercise the rules that decide who
gets an account, so they are written as the attacks they are meant to stop.
"""

from __future__ import annotations

import asyncio
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from api.routes.auth import login, register
from api.security import hash_password, verify_password
from database.models import User
from models.user import LoginRequest, RegisterRequest
from tests.conftest import TEST_PASSWORD

pytestmark = [pytest.mark.integration, pytest.mark.db, pytest.mark.asyncio(loop_scope="session")]


def _register_body(**overrides) -> RegisterRequest:
    payload = {
        "username": overrides.pop("username", f"user{uuid.uuid4().hex[:8]}"),
        "password": TEST_PASSWORD,
        "full_name": "Pengguna Uji",
        "role": overrides.pop("role", "student"),
    }
    payload.update(overrides)
    return RegisterRequest(**payload)


# --------------------------------------------------------------------------- #
# Password hashing
# --------------------------------------------------------------------------- #
async def test_password_hash_is_salted_and_verifiable() -> None:
    a, b = hash_password(TEST_PASSWORD), hash_password(TEST_PASSWORD)
    assert a != b, "identical passwords must not produce identical hashes"
    assert verify_password(TEST_PASSWORD, a)
    assert not verify_password("wrong-password", a)


async def test_password_verify_survives_a_garbage_hash() -> None:
    """A corrupt row must fail the login, not crash the endpoint."""
    assert verify_password(TEST_PASSWORD, "not-a-bcrypt-hash") is False


@pytest.mark.parametrize("bad", ["short", "x" * 73])
async def test_password_length_bounds_rejected(bad: str) -> None:
    with pytest.raises(ValueError):
        hash_password(bad)


# --------------------------------------------------------------------------- #
# Registration
# --------------------------------------------------------------------------- #
async def test_register_creates_account_without_code(db_session) -> None:
    body = _register_body(username="budi")

    result = await register(body, session=db_session)

    assert result.user.username == "budi"
    assert result.user.role == "student"
    assert result.access_token

    row = (await db_session.execute(select(User).where(User.username == "budi"))).scalar_one()
    assert row.password_hash != TEST_PASSWORD
    assert verify_password(TEST_PASSWORD, row.password_hash)


async def test_register_rejects_duplicate_username(db_session) -> None:
    await register(_register_body(username="kembar"), session=db_session)

    with pytest.raises(HTTPException) as exc:
        await register(_register_body(username="kembar"), session=db_session)
    assert exc.value.status_code == 409


async def test_student_gets_the_accessibility_default(db_session) -> None:
    result = await register(_register_body(role="student"), session=db_session)
    assert result.user.accessibility_profile == "blind"


async def test_teacher_does_not_get_the_blind_default(db_session) -> None:
    result = await register(_register_body(role="teacher"), session=db_session)
    assert result.user.accessibility_profile == "standard"


# --------------------------------------------------------------------------- #
# Login
# --------------------------------------------------------------------------- #
async def test_login_succeeds_and_stamps_last_login(db_session, user_factory) -> None:
    user, _ = await user_factory("student", username="masuk")
    user.active_auth_session_id = None
    user.active_auth_session_expires_at = None
    assert user.last_login_at is None

    result = await login(LoginRequest(username="masuk", password=TEST_PASSWORD), session=db_session)
    assert result.user.id == user.id
    assert result.token_type == "bearer"
    assert user.last_login_at is not None
    assert user.active_auth_session_id is not None
    assert user.active_auth_session_expires_at is not None


async def test_second_login_requires_confirmation_and_preserves_existing_session(
    db_session, user_factory
) -> None:
    from datetime import UTC, datetime, timedelta

    user, _ = await user_factory("student", username="satu-perangkat")
    original_session_id = user.active_auth_session_id
    original_expiry = user.active_auth_session_expires_at

    with pytest.raises(HTTPException) as challenge:
        await login(
            LoginRequest(username="satu-perangkat", password=TEST_PASSWORD),
            session=db_session,
        )

    assert challenge.value.status_code == 409
    assert challenge.value.detail == {
        "code": "active_session",
        "session_id": str(original_session_id),
    }
    assert user.active_auth_session_id == original_session_id
    assert user.active_auth_session_expires_at == original_expiry

    accepted = await login(
        LoginRequest(
            username="satu-perangkat",
            password=TEST_PASSWORD,
            replace_session_id=original_session_id,
        ),
        session=db_session,
    )
    assert accepted.access_token
    assert user.active_auth_session_id != original_session_id
    assert user.active_auth_session_expires_at > datetime.now(UTC) + timedelta(minutes=1)


async def test_stale_replacement_confirmation_cannot_replace_newer_session(
    db_session, user_factory
) -> None:
    user, _ = await user_factory("student", username="sesi-berubah")
    old_session_id = user.active_auth_session_id
    user.active_auth_session_id = uuid.uuid4()
    current_session_id = user.active_auth_session_id
    await db_session.flush()

    with pytest.raises(HTTPException) as challenge:
        await login(
            LoginRequest(
                username="sesi-berubah",
                password=TEST_PASSWORD,
                replace_session_id=old_session_id,
            ),
            session=db_session,
        )

    assert challenge.value.status_code == 409
    assert challenge.value.detail == {
        "code": "active_session_changed",
        "session_id": str(current_session_id),
    }
    assert user.active_auth_session_id == current_session_id


async def test_wrong_password_does_not_reveal_active_session(db_session, user_factory) -> None:
    user, _ = await user_factory("student", username="parol-salah")
    with pytest.raises(HTTPException) as exc:
        await login(
            LoginRequest(username="parol-salah", password="not-the-password"),
            session=db_session,
        )
    assert exc.value.status_code == 401
    assert exc.value.detail == "Username or password is incorrect."
    assert user.active_auth_session_id is not None


async def test_parallel_first_logins_issue_only_one_valid_session(db_engine) -> None:
    """The user-row lock must serialize competing logins across DB sessions."""
    from sqlalchemy.ext.asyncio import async_sessionmaker

    from database.models import User

    factory = async_sessionmaker(db_engine, expire_on_commit=False)
    username = f"race-{uuid.uuid4().hex[:12]}"
    user_id = uuid.uuid4()
    async with factory() as session:
        session.add(
            User(
                id=user_id,
                username=username,
                password_hash=hash_password(TEST_PASSWORD),
                role="student",
                full_name="Login Race",
                active_auth_session_id=None,
                active_auth_session_expires_at=None,
            )
        )
        await session.commit()

    async def attempt_login():
        async with factory() as session:
            try:
                result = await login(
                    LoginRequest(username=username, password=TEST_PASSWORD), session=session
                )
                await session.commit()
                return result
            except HTTPException as exc:
                await session.rollback()
                return exc

    try:
        outcomes = await asyncio.gather(attempt_login(), attempt_login())
        successes = [item for item in outcomes if not isinstance(item, HTTPException)]
        challenges = [item for item in outcomes if isinstance(item, HTTPException)]
        assert len(successes) == 1
        assert len(challenges) == 1
        assert challenges[0].status_code == 409
        assert challenges[0].detail["code"] == "active_session"
        async with factory() as session:
            row = await session.get(User, user_id)
            assert row is not None
            assert str(row.active_auth_session_id) == challenges[0].detail["session_id"]
    finally:
        async with factory() as session:
            row = await session.get(User, user_id)
            if row is not None:
                await session.delete(row)
                await session.commit()


async def test_password_change_revokes_the_current_token(db_session, user_factory) -> None:
    from api.dependencies import _load_user
    from api.routes.auth import change_password
    from models.user import ChangePasswordRequest

    user, old_token = await user_factory("student", username="ganti-sandi")
    await change_password(
        ChangePasswordRequest(
            current_password=TEST_PASSWORD,
            new_password="password-baru-123",
        ),
        user=user,
        session=db_session,
    )
    with pytest.raises(HTTPException) as revoked:
        await _load_user(db_session, old_token)
    assert revoked.value.status_code == 401


async def test_login_rejects_wrong_password(db_session, user_factory) -> None:
    await user_factory("student", username="salah")
    with pytest.raises(HTTPException) as exc:
        await login(LoginRequest(username="salah", password="not-the-password"), session=db_session)
    assert exc.value.status_code == 401


async def test_login_does_not_reveal_whether_a_username_exists(db_session, user_factory) -> None:
    """Both failures must be indistinguishable, or this becomes a user enumerator."""
    await user_factory("student", username="ada")

    with pytest.raises(HTTPException) as wrong_password:
        await login(LoginRequest(username="ada", password="salah-sekali"), session=db_session)
    with pytest.raises(HTTPException) as no_such_user:
        await login(LoginRequest(username="tidakada", password="salah-sekali"), session=db_session)

    assert wrong_password.value.status_code == no_such_user.value.status_code == 401
    assert wrong_password.value.detail == no_such_user.value.detail


async def test_disabled_account_cannot_log_in(db_session, user_factory) -> None:
    await user_factory("student", username="nonaktif", is_active=False)
    with pytest.raises(HTTPException) as exc:
        await login(LoginRequest(username="nonaktif", password=TEST_PASSWORD), session=db_session)
    assert exc.value.status_code == 403

"""
KODMOD AI - Authentication Routes
=================================

Register, log in, inspect and edit your own account.

Students and teachers can create their own accounts. Admin accounts are
created only by an existing administrator or the provisioning script.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api.audit_service import record_audit
from api.dependencies import current_user, db_session
from api.security import create_access_token, hash_password, verify_password
from config.settings import settings
from database.models import User
from models.user import (
    ChangePasswordRequest,
    LoginRequest,
    RegisterRequest,
    TokenResponse,
    UpdateProfileRequest,
    Username,
    UserOut,
)

log = logging.getLogger(__name__)
router = APIRouter(tags=["auth"])

# One message for "no such user" and for "wrong password", so the endpoint
# cannot be used to discover which usernames exist.
_BAD_CREDENTIALS = "Username or password is incorrect."


def _token_response(user: User) -> TokenResponse:
    if user.active_auth_session_id is None or user.active_auth_session_expires_at is None:
        raise RuntimeError("Cannot issue a token without an active authentication session")
    return TokenResponse(
        access_token=create_access_token(
            subject=str(user.id),
            role=user.role,
            session_id=str(user.active_auth_session_id),
            expires_at=user.active_auth_session_expires_at,
        ),
        expires_in=settings.JWT_EXPIRE_MIN * 60,
        user=UserOut.model_validate(user),
    )


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(
    body: RegisterRequest,
    session: AsyncSession = Depends(db_session),
) -> TokenResponse:
    """Create a student or teacher account and return its authenticated session."""
    try:
        password_hash = hash_password(body.password)
    except ValueError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e

    user = User(
        username=body.username,
        password_hash=password_hash,
        role=body.role,
        full_name=body.full_name,
        grade_level=body.grade_level,
        preferred_language=body.preferred_language,
        accessibility_profile=settings.ACCESSIBILITY_DEFAULT_PROFILE
        if body.role == "student"
        else "standard",
    )
    session.add(user)

    try:
        await session.flush()
    except IntegrityError as e:
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "That username is already taken.") from e

    await session.refresh(user)
    now = datetime.now(UTC)
    user.active_auth_session_id = uuid.uuid4()
    user.active_auth_session_expires_at = now + timedelta(minutes=settings.JWT_EXPIRE_MIN)
    log.info("Registered %s as %s", user.username, user.role)
    record_audit(
        session,
        action="auth.registered",
        category="auth",
        actor=user,
        target_type="user",
        target_id=user.id,
        target_name=f"{user.full_name} (@{user.username})",
        details={"role": user.role},
    )
    await session.flush()
    return _token_response(user)


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    session: AsyncSession = Depends(db_session),
) -> TokenResponse:
    """Exchange a username and password for an access token."""
    user = (
        await session.execute(select(User).where(User.username == body.username))
    ).scalar_one_or_none()

    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, _BAD_CREDENTIALS)
    if not user.is_active:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "This account is disabled. Contact your administrator.",
        )

    # Serialize every valid login for this account. populate_existing refreshes
    # a row loaded before another login acquired the lock and replaced its SID.
    user = (
        await session.execute(
            select(User)
            .where(User.id == user.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, _BAD_CREDENTIALS)
    if not user.is_active:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "This account is disabled. Contact your administrator.",
        )

    now = datetime.now(UTC)
    active_expiry = user.active_auth_session_expires_at
    if active_expiry is not None and active_expiry.tzinfo is None:
        active_expiry = active_expiry.replace(tzinfo=UTC)
    has_active_session = (
        user.active_auth_session_id is not None
        and active_expiry is not None
        and active_expiry > now
    )
    if has_active_session and body.replace_session_id is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {
                "code": "active_session",
                "session_id": str(user.active_auth_session_id),
            },
        )
    if (
        has_active_session
        and body.replace_session_id is not None
        and body.replace_session_id != user.active_auth_session_id
    ):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {
                "code": "active_session_changed",
                "session_id": str(user.active_auth_session_id),
            },
        )

    # Apply an explicit browser choice only after authentication and any
    # active-session confirmation succeed, in the same transaction as login.
    if body.preferred_language is not None:
        user.preferred_language = body.preferred_language
    user.active_auth_session_id = uuid.uuid4()
    user.active_auth_session_expires_at = now + timedelta(minutes=settings.JWT_EXPIRE_MIN)
    user.last_login_at = datetime.now(UTC)
    record_audit(
        session,
        action="auth.login",
        category="auth",
        actor=user,
        target_type="session",
        target_name=f"Sesi @{user.username}",
        details={"replaced_active_session": has_active_session},
    )
    await session.flush()
    return _token_response(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(db_session),
) -> None:
    """Revoke the current browser/API session on the server."""
    result = await session.execute(
        update(User)
        .where(
            User.id == user.id,
            User.active_auth_session_id == user.active_auth_session_id,
        )
        .values(active_auth_session_id=None, active_auth_session_expires_at=None)
        .execution_options(synchronize_session="fetch")
    )
    record_audit(
        session,
        action="auth.logout",
        category="auth",
        actor=user,
        target_type="session",
        target_name=f"Sesi @{user.username}",
        details={"revoked": result.rowcount == 1},
    )
    await session.flush()


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(current_user)) -> User:
    """The signed-in account."""
    return user


@router.patch("/me", response_model=UserOut)
async def update_me(
    body: UpdateProfileRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(db_session),
) -> User:
    """Update your own name, language, or accessibility preference."""
    for field, value in body.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(user, field, value)
    session.add(user)
    record_audit(
        session,
        action="auth.profile_updated",
        category="auth",
        actor=user,
        target_type="user",
        target_id=user.id,
        target_name=f"{user.full_name} (@{user.username})",
    )
    await session.flush()
    return user


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    body: ChangePasswordRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(db_session),
) -> None:
    """Change your own password. Requires the current one."""
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect.")
    try:
        user.password_hash = hash_password(body.new_password)
    except ValueError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e
    user.active_auth_session_id = None
    user.active_auth_session_expires_at = None
    session.add(user)
    record_audit(
        session,
        action="auth.password_changed",
        category="auth",
        actor=user,
        target_type="user",
        target_id=user.id,
        target_name=f"{user.full_name} (@{user.username})",
    )
    await session.flush()


@router.get("/username-available")
async def username_available(
    username: Username,
    session: AsyncSession = Depends(db_session),
) -> dict:
    """Lets the registration form tell someone a name is taken before they submit."""
    taken = (
        await session.execute(
            select(func.count()).select_from(User).where(User.username == username.lower())
        )
    ).scalar_one()
    return {"username": username.lower(), "available": taken == 0}

"""
KODMOD AI - Admin Routes
========================

Account and invitation-code management. Every endpoint here requires the admin
role; the gate is `require_admin`, applied once to the whole router.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api.audit_service import record_audit
from api.dependencies import db_session, require_admin
from api.security import generate_invitation_code, hash_password
from database.models import InvitationCode, User
from models.user import (
    AdminCreateUserRequest,
    AdminUpdateUserRequest,
    InvitationCodeCreate,
    InvitationCodeOut,
    UserOut,
)

log = logging.getLogger(__name__)
router = APIRouter(tags=["admin"], dependencies=[Depends(require_admin)])


# ----------------------------------------------------------------- users --
@router.get("/users", response_model=list[UserOut])
async def list_users(
    role: str | None = Query(default=None, pattern="^(student|teacher|admin)$"),
    q: str | None = Query(default=None, max_length=100),
    session: AsyncSession = Depends(db_session),
) -> list[User]:
    """All accounts, newest first. Filter by role or search name and username."""
    stmt = select(User).order_by(User.created_at.desc())
    if role:
        stmt = stmt.where(User.role == role)
    if q:
        needle = f"%{q.lower()}%"
        stmt = stmt.where(
            func.lower(User.username).like(needle) | func.lower(User.full_name).like(needle)
        )
    return list((await session.execute(stmt)).scalars().all())


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user(
    body: AdminCreateUserRequest,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(db_session),
) -> User:
    """Create any account, including another admin. No invitation code needed."""
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
    )
    session.add(user)
    try:
        await session.flush()
    except IntegrityError as e:
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "That username is already taken.") from e
    await session.refresh(user)
    record_audit(
        session,
        action="user.created",
        category="account",
        actor=admin,
        target_type="user",
        target_id=user.id,
        target_name=f"{user.full_name} (@{user.username})",
        details={"role": user.role},
    )
    await session.flush()
    return user


@router.patch("/users/{user_id}", response_model=UserOut)
async def update_user(
    user_id: uuid.UUID,
    body: AdminUpdateUserRequest,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(db_session),
) -> User:
    """Rename, change role, enable or disable, or reset the password."""
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such account.")

    changes = {
        field: value
        for field, value in body.model_dump(exclude_unset=True).items()
        if value is not None and (field == "new_password" or value != getattr(user, field))
    }

    # An admin locking or demoting themselves would lock everyone out if they
    # were the last one, so block self-demotion outright.
    if user.id == admin.id and (
        changes.get("is_active") is False or (changes.get("role") or user.role) != "admin"
    ):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "You cannot disable or demote your own admin account.",
        )

    action = "user.updated"
    if "is_active" in changes:
        action = "user.activated" if changes["is_active"] else "user.deactivated"
    elif "role" in changes:
        action = "user.role_changed"
    elif "new_password" in changes:
        action = "user.password_reset"

    if (new_password := changes.pop("new_password", None)) is not None:
        try:
            user.password_hash = hash_password(new_password)
        except ValueError as e:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e

    # Credentials and authorization changes revoke every token issued before
    # this update, including a session that would otherwise remain in a browser.
    if new_password is not None or "role" in changes or changes.get("is_active") is False:
        user.active_auth_session_id = None
        user.active_auth_session_expires_at = None

    for field, value in changes.items():
        if value is not None:
            setattr(user, field, value)

    session.add(user)
    await session.flush()
    await session.refresh(user)

    audit_details = dict(changes)
    if new_password is not None:
        audit_details["password_reset"] = True

    record_audit(
        session,
        action=action,
        category="account",
        actor=admin,
        target_type="user",
        target_id=user.id,
        target_name=f"{user.full_name} (@{user.username})",
        details=audit_details or None,
    )
    await session.flush()
    return user


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: uuid.UUID,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(db_session),
) -> None:
    """Permanently remove an account and everything it owns."""
    if user_id == admin.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot delete your own account.")
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such account.")
    target_name = f"{user.full_name} (@{user.username})"
    role = user.role
    record_audit(
        session,
        action="user.deleted",
        category="account",
        actor=admin,
        target_type="user",
        target_id=user_id,
        target_name=target_name,
        details={"role": role},
    )
    await session.delete(user)
    await session.flush()
    log.info("Admin %s deleted account %s", admin.username, user.username)


# ----------------------------------------------------------- invitations --
@router.get("/invitations", response_model=list[InvitationCodeOut])
async def list_invitations(session: AsyncSession = Depends(db_session)) -> list[InvitationCode]:
    """Every invitation code and how many of its uses are left."""
    stmt = select(InvitationCode).order_by(InvitationCode.created_at.desc())
    return list((await session.execute(stmt)).scalars().all())


@router.post("/invitations", response_model=InvitationCodeOut, status_code=status.HTTP_201_CREATED)
async def create_invitation(
    body: InvitationCodeCreate,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(db_session),
) -> InvitationCode:
    """Mint a code someone can register with."""
    expires_at = (
        datetime.now(UTC) + timedelta(days=body.expires_in_days) if body.expires_in_days else None
    )
    # Codes are random and short, so a collision is possible; retry rather than
    # handing the admin a 500.
    for _ in range(5):
        invite = InvitationCode(
            code=generate_invitation_code(),
            label=body.label,
            max_uses=body.max_uses,
            expires_at=expires_at,
            created_by=admin.id,
        )
        session.add(invite)
        try:
            await session.flush()
        except IntegrityError:
            await session.rollback()
            continue
        await session.refresh(invite)
        record_audit(
            session,
            action="invitation.created",
            category="invitation",
            actor=admin,
            target_type="invitation",
            target_id=invite.id,
            target_name=invite.code,
            details={"label": invite.label, "max_uses": invite.max_uses},
        )
        await session.flush()
        return invite
    raise HTTPException(
        status.HTTP_503_SERVICE_UNAVAILABLE, "Could not generate a unique code. Try again."
    )


@router.delete("/invitations/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_invitation(
    invitation_id: uuid.UUID,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(db_session),
) -> None:
    """Revoke a code. Accounts already created with it are unaffected."""
    invite = await session.get(InvitationCode, invitation_id)
    if invite is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such invitation code.")
    target_name = invite.code
    label = invite.label
    record_audit(
        session,
        action="invitation.revoked",
        category="invitation",
        actor=admin,
        target_type="invitation",
        target_id=invite.id,
        target_name=target_name,
        details={"label": label} if label else None,
    )
    await session.delete(invite)
    await session.flush()

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
from api.cascade_delete import cascade_delete_classroom, cascade_delete_subject
from api.dependencies import db_session, require_admin
from api.security import generate_invitation_code, hash_password
from database.models import (
    ClassMaterial,
    Classroom,
    Concept,
    Document,
    Enrollment,
    InvitationCode,
    QuizAssignment,
    QuizDraft,
    Subject,
    User,
)
from models.admin_academic import (
    AdminClassOut,
    AdminCreateClassRequest,
    AdminCreateSubjectRequest,
    AdminSubjectOut,
    AdminUpdateClassRequest,
    AdminUpdateSubjectRequest,
)
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


# ------------------------------------------------------------- classrooms --
@router.get("/classes", response_model=list[AdminClassOut])
async def list_admin_classes(
    q: str | None = Query(default=None, max_length=120),
    subject_id: uuid.UUID | None = None,
    is_archived: bool | None = None,
    session: AsyncSession = Depends(db_session),
) -> list[dict]:
    """List all classrooms with teacher details and statistics for administrators."""
    stmt = (
        select(Classroom, User)
        .join(User, Classroom.teacher_id == User.id)
        .order_by(Classroom.created_at.desc())
    )
    if is_archived is not None:
        stmt = stmt.where(Classroom.is_archived == is_archived)
    if subject_id is not None:
        stmt = stmt.where(Classroom.subject_id == subject_id)
    if q:
        needle = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            func.lower(Classroom.name).like(needle)
            | func.lower(Classroom.subject).like(needle)
            | func.lower(User.full_name).like(needle)
        )
    rows = (await session.execute(stmt)).all()
    if not rows:
        return []

    class_ids = [c.id for c, _ in rows]

    member_counts = dict(
        (
            await session.execute(
                select(Enrollment.class_id, func.count(Enrollment.student_id))
                .where(Enrollment.class_id.in_(class_ids))
                .group_by(Enrollment.class_id)
            )
        ).all()
    )
    material_counts = dict(
        (
            await session.execute(
                select(ClassMaterial.class_id, func.count(ClassMaterial.id))
                .where(ClassMaterial.class_id.in_(class_ids))
                .group_by(ClassMaterial.class_id)
            )
        ).all()
    )
    assignment_counts = dict(
        (
            await session.execute(
                select(QuizAssignment.class_id, func.count(QuizAssignment.id))
                .where(QuizAssignment.class_id.in_(class_ids))
                .group_by(QuizAssignment.class_id)
            )
        ).all()
    )

    results = []
    for c, teacher in rows:
        results.append(
            {
                "id": c.id,
                "name": c.name,
                "subject": c.subject,
                "subject_id": c.subject_id,
                "description": c.description or "",
                "is_archived": c.is_archived,
                "teacher_id": teacher.id,
                "teacher_name": teacher.full_name,
                "teacher_username": teacher.username,
                "member_count": member_counts.get(c.id, 0),
                "material_count": material_counts.get(c.id, 0),
                "assignment_count": assignment_counts.get(c.id, 0),
                "created_at": c.created_at,
            }
        )
    return results


@router.post("/classes", response_model=AdminClassOut, status_code=status.HTTP_201_CREATED)
async def create_admin_class(
    body: AdminCreateClassRequest,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(db_session),
) -> dict:
    """Create a new classroom assigning teacher and subject."""
    teacher = await session.get(User, body.teacher_id)
    if teacher is None or teacher.role != "teacher":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Guru tidak ditemukan.")

    subject_row = None
    if body.subject_id:
        subject_row = await session.get(Subject, body.subject_id)
        if subject_row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Mata pelajaran tidak ditemukan.")
    elif body.subject:
        subject_row = await session.scalar(
            select(Subject).where(func.lower(Subject.name) == body.subject.lower())
        )
        if subject_row is None:
            subject_row = Subject(name=body.subject, created_by=admin.id)
            session.add(subject_row)
            await session.flush()
    if subject_row is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Pilih mata pelajaran untuk kelas."
        )

    classroom = Classroom(
        name=body.name,
        subject=subject_row.name,
        subject_id=subject_row.id,
        teacher_id=teacher.id,
        description=body.description,
        is_archived=body.is_archived,
    )
    session.add(classroom)
    await session.flush()
    await session.refresh(classroom)

    record_audit(
        session,
        action="class.created",
        category="academic",
        actor=admin,
        target_type="classroom",
        target_id=classroom.id,
        target_name=classroom.name,
        details={"subject": classroom.subject, "teacher": teacher.full_name},
    )
    await session.commit()

    return {
        "id": classroom.id,
        "name": classroom.name,
        "subject": classroom.subject,
        "subject_id": classroom.subject_id,
        "description": classroom.description or "",
        "is_archived": classroom.is_archived,
        "teacher_id": teacher.id,
        "teacher_name": teacher.full_name,
        "teacher_username": teacher.username,
        "member_count": 0,
        "material_count": 0,
        "assignment_count": 0,
        "created_at": classroom.created_at,
    }


@router.patch("/classes/{class_id}", response_model=AdminClassOut)
async def update_admin_class(
    class_id: uuid.UUID,
    body: AdminUpdateClassRequest,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(db_session),
) -> dict:
    """Modify classroom name, subject, assigned teacher, description, or archive status."""
    classroom = await session.get(Classroom, class_id)
    if classroom is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kelas tidak ditemukan.")

    changes = body.model_dump(exclude_unset=True)
    if "teacher_id" in changes and changes["teacher_id"] is not None:
        teacher = await session.get(User, changes["teacher_id"])
        if teacher is None or teacher.role != "teacher":
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Guru tidak ditemukan.")
        classroom.teacher_id = teacher.id

    if "subject_id" in changes and changes["subject_id"] is not None:
        subj = await session.get(Subject, changes["subject_id"])
        if subj is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Mata pelajaran tidak ditemukan.")
        classroom.subject_id = subj.id
        classroom.subject = subj.name
    elif "subject" in changes and changes["subject"] is not None:
        classroom.subject = changes["subject"]

    if "name" in changes and changes["name"] is not None:
        classroom.name = changes["name"]
    if "description" in changes and changes["description"] is not None:
        classroom.description = changes["description"]
    if "is_archived" in changes and changes["is_archived"] is not None:
        classroom.is_archived = changes["is_archived"]

    session.add(classroom)
    await session.flush()
    await session.refresh(classroom)

    teacher = await session.get(User, classroom.teacher_id)
    teacher_name = teacher.full_name if teacher else "Guru"
    teacher_username = teacher.username if teacher else ""

    record_audit(
        session,
        action="class.updated",
        category="academic",
        actor=admin,
        target_type="classroom",
        target_id=classroom.id,
        target_name=classroom.name,
        details={k: str(v) for k, v in changes.items()},
    )
    await session.commit()

    member_count = await session.scalar(
        select(func.count()).select_from(Enrollment).where(Enrollment.class_id == classroom.id)
    )
    material_count = await session.scalar(
        select(func.count()).select_from(ClassMaterial).where(ClassMaterial.class_id == classroom.id)
    )
    assignment_count = await session.scalar(
        select(func.count()).select_from(QuizAssignment).where(QuizAssignment.class_id == classroom.id)
    )

    return {
        "id": classroom.id,
        "name": classroom.name,
        "subject": classroom.subject,
        "subject_id": classroom.subject_id,
        "description": classroom.description or "",
        "is_archived": classroom.is_archived,
        "teacher_id": classroom.teacher_id,
        "teacher_name": teacher_name,
        "teacher_username": teacher_username,
        "member_count": member_count or 0,
        "material_count": material_count or 0,
        "assignment_count": assignment_count or 0,
        "created_at": classroom.created_at,
    }


@router.delete("/classes/{class_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_admin_class(
    class_id: uuid.UUID,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(db_session),
) -> None:
    """Permanently delete a classroom and all related materials, assignments,
    student enrollments, and activity history (complete cascade).
    """
    classroom = await session.get(Classroom, class_id)
    if classroom is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kelas tidak ditemukan.")

    target_name = classroom.name
    subject_name = classroom.subject

    res = await cascade_delete_classroom(session, classroom)

    record_audit(
        session,
        action="class.deleted",
        category="academic",
        actor=admin,
        target_type="classroom",
        target_id=class_id,
        target_name=target_name,
        details={"subject": subject_name, **res},
    )
    await session.commit()
    log.info("Admin %s deleted class '%s' with full cascade", admin.username, target_name)


# --------------------------------------------------------------- subjects --
@router.get("/subjects", response_model=list[AdminSubjectOut])
async def list_admin_subjects(
    q: str | None = Query(default=None, max_length=120),
    session: AsyncSession = Depends(db_session),
) -> list[dict]:
    """List all subjects with usage counts and metadata for administrators."""
    stmt = (
        select(Subject, User.full_name)
        .outerjoin(User, Subject.created_by == User.id)
        .order_by(Subject.name.asc())
    )
    if q:
        needle = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            func.lower(Subject.name).like(needle) | func.lower(Subject.description).like(needle)
        )
    rows = (await session.execute(stmt)).all()
    if not rows:
        return []

    subject_ids = [s.id for s, _ in rows]

    class_counts = dict(
        (
            await session.execute(
                select(Classroom.subject_id, func.count(Classroom.id))
                .where(Classroom.subject_id.in_(subject_ids))
                .group_by(Classroom.subject_id)
            )
        ).all()
    )
    concept_counts = dict(
        (
            await session.execute(
                select(Concept.subject_id, func.count(Concept.id))
                .where(Concept.subject_id.in_(subject_ids))
                .group_by(Concept.subject_id)
            )
        ).all()
    )
    doc_counts = dict(
        (
            await session.execute(
                select(Document.subject_id, func.count(Document.id))
                .where(Document.subject_id.in_(subject_ids))
                .group_by(Document.subject_id)
            )
        ).all()
    )
    quiz_counts = dict(
        (
            await session.execute(
                select(QuizDraft.subject_id, func.count(QuizDraft.id))
                .where(QuizDraft.subject_id.in_(subject_ids))
                .group_by(QuizDraft.subject_id)
            )
        ).all()
    )

    results = []
    for s, creator_name in rows:
        results.append(
            {
                "id": s.id,
                "name": s.name,
                "description": s.description or "",
                "created_by": s.created_by,
                "creator_name": creator_name or "Sistem",
                "class_count": class_counts.get(s.id, 0),
                "concept_count": concept_counts.get(s.id, 0),
                "document_count": doc_counts.get(s.id, 0),
                "quiz_count": quiz_counts.get(s.id, 0),
                "created_at": s.created_at,
            }
        )
    return results


@router.post("/subjects", response_model=AdminSubjectOut, status_code=status.HTTP_201_CREATED)
async def create_admin_subject(
    body: AdminCreateSubjectRequest,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(db_session),
) -> dict:
    """Create a new subject."""
    subject = Subject(name=body.name, description=body.description, created_by=admin.id)
    session.add(subject)
    try:
        await session.flush()
    except IntegrityError as e:
        await session.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Mata pelajaran dengan nama tersebut sudah ada."
        ) from e
    await session.refresh(subject)

    record_audit(
        session,
        action="subject.created",
        category="academic",
        actor=admin,
        target_type="subject",
        target_id=subject.id,
        target_name=subject.name,
        details={"description": subject.description},
    )
    await session.commit()

    return {
        "id": subject.id,
        "name": subject.name,
        "description": subject.description or "",
        "created_by": admin.id,
        "creator_name": admin.full_name,
        "class_count": 0,
        "concept_count": 0,
        "document_count": 0,
        "quiz_count": 0,
        "created_at": subject.created_at,
    }


@router.patch("/subjects/{subject_id}", response_model=AdminSubjectOut)
async def update_admin_subject(
    subject_id: uuid.UUID,
    body: AdminUpdateSubjectRequest,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(db_session),
) -> dict:
    """Update subject name or description and propagate name changes."""
    subject = await session.get(Subject, subject_id)
    if subject is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mata pelajaran tidak ditemukan.")

    old_name = subject.name
    changes = body.model_dump(exclude_unset=True)
    if "name" in changes and changes["name"] is not None:
        subject.name = changes["name"]
        from sqlalchemy import update as sa_update

        await session.execute(
            sa_update(Classroom)
            .where(Classroom.subject_id == subject.id)
            .values(subject=subject.name)
        )
    if "description" in changes and changes["description"] is not None:
        subject.description = changes["description"]

    session.add(subject)
    try:
        await session.flush()
    except IntegrityError as e:
        await session.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Mata pelajaran dengan nama tersebut sudah ada."
        ) from e
    await session.refresh(subject)

    creator = await session.get(User, subject.created_by) if subject.created_by else None

    record_audit(
        session,
        action="subject.updated",
        category="academic",
        actor=admin,
        target_type="subject",
        target_id=subject.id,
        target_name=subject.name,
        details={"old_name": old_name, **{k: str(v) for k, v in changes.items()}},
    )
    await session.commit()

    class_count = await session.scalar(
        select(func.count()).select_from(Classroom).where(Classroom.subject_id == subject.id)
    )
    concept_count = await session.scalar(
        select(func.count()).select_from(Concept).where(Concept.subject_id == subject.id)
    )
    doc_count = await session.scalar(
        select(func.count()).select_from(Document).where(Document.subject_id == subject.id)
    )
    quiz_count = await session.scalar(
        select(func.count()).select_from(QuizDraft).where(QuizDraft.subject_id == subject.id)
    )

    return {
        "id": subject.id,
        "name": subject.name,
        "description": subject.description or "",
        "created_by": subject.created_by,
        "creator_name": creator.full_name if creator else "Sistem",
        "class_count": class_count or 0,
        "concept_count": concept_count or 0,
        "document_count": doc_count or 0,
        "quiz_count": quiz_count or 0,
        "created_at": subject.created_at,
    }


@router.delete("/subjects/{subject_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_admin_subject(
    subject_id: uuid.UUID,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(db_session),
) -> None:
    """Permanently delete a subject and all related classrooms, concepts,
    curriculum documents, materials, and quizzes (complete cascade).
    """
    subject = await session.get(Subject, subject_id)
    if subject is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mata pelajaran tidak ditemukan.")

    target_name = subject.name
    res = await cascade_delete_subject(session, subject)

    record_audit(
        session,
        action="subject.deleted",
        category="academic",
        actor=admin,
        target_type="subject",
        target_id=subject_id,
        target_name=target_name,
        details=res,
    )
    await session.commit()
    log.info("Admin %s deleted subject '%s' with full cascade: %s", admin.username, target_name, res)

"""Teacher-owned classes with private, accessible materials and scoped RAG.

Every nested resource repeats the class membership check on the server.
"""

import uuid
from datetime import UTC, datetime

from database.models import (
    BackgroundJob,
    ClassActivity,
    ClassMaterial,
    Classroom,
    Enrollment,
    MaterialImport,
    MaterialProgress,
    Subject,
    User,
)
from fastapi import APIRouter, BackgroundTasks, Depends, Form, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import current_user, db_session, require_student, require_teacher
from api.durable_jobs import enqueue_material
from api.material_artifacts import create_import, import_out, original_path, source_for
from api.material_concepts import (
    MappingApproval,
    approve_mapping,
    change_subject,
    mapping_out,
    select_subject,
)
from api.material_imports import safe_filename

router = APIRouter(tags=["classes"])


class ClassWrite(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    name: str = Field(min_length=1, max_length=120)
    subject: str = Field(default="", max_length=120)
    subject_id: uuid.UUID | None = None
    description: str = Field(default="", max_length=2000)


class ClassUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    is_archived: bool | None = None
    subject_id: uuid.UUID | None = None


class MemberWrite(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    username: str = Field(min_length=3, max_length=64)


class MemberBatchWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    student_ids: list[uuid.UUID] = Field(min_length=1, max_length=50)


class MaterialWrite(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=100000)
    published: bool = False
    source_filename: str | None = Field(default=None, max_length=300)
    source_import_id: uuid.UUID | None = None

    @field_validator("source_filename")
    @classmethod
    def normalize_filename(cls, value):
        return safe_filename(value) if value else None


async def accessible(session: AsyncSession, class_id: uuid.UUID, user: User, *, write=False):
    row = (
        await session.scalar(
            select(Classroom)
            .where(Classroom.id == class_id)
            .execution_options(populate_existing=True)
            .with_for_update()
        )
        if write
        else await session.get(Classroom, class_id)
    )
    owner = row is not None and user.role == "teacher" and row.teacher_id == user.id
    member = (
        row is not None
        and user.role == "student"
        and not row.is_archived
        and await session.get(Enrollment, (class_id, user.id)) is not None
    )
    if row is None or not (owner or (member and not write)):
        raise HTTPException(404, "Kelas tidak ditemukan.")
    if write and row.is_archived:
        raise HTTPException(409, "Buka arsip kelas sebelum mengubah isinya.")
    return row


def record(session, row, user, action, target=None):
    session.add(
        ClassActivity(
            class_id=row.id,
            actor_id=user.id,
            action=action,
            target_id=str(target) if target else None,
        )
    )


async def summary(session, row, user):
    member_count = await session.scalar(
        select(func.count()).select_from(Enrollment).where(Enrollment.class_id == row.id)
    )
    material_query = (
        select(func.count()).select_from(ClassMaterial).where(ClassMaterial.class_id == row.id)
    )
    if user.role == "student":
        material_query = material_query.where(ClassMaterial.published.is_(True))
    teacher = await session.get(User, row.teacher_id)
    return {
        "id": str(row.id),
        "name": row.name,
        "subject": row.subject,
        "subject_id": str(row.subject_id) if row.subject_id else None,
        "description": row.description,
        "is_archived": row.is_archived,
        "teacher_name": teacher.full_name if teacher else "Guru",
        "member_count": member_count,
        "material_count": await session.scalar(material_query),
        "created_at": row.created_at.isoformat(),
    }


def material_info(row):
    return {
        "id": str(row.id),
        "title": row.title,
        "published": row.published,
        "source_filename": row.source_filename,
        "source_import_id": str(row.source_import_id) if row.source_import_id else None,
        "rag_status": row.rag_status,
        "rag_error": row.rag_error,
        "n_chunks": row.n_chunks,
        "content_version": row.content_version,
        "indexed_version": row.indexed_version,
        "mapping_version": row.mapping_version,
        "indexed_mapping_version": row.indexed_mapping_version,
        "created_at": row.created_at.isoformat(),
    }


@router.get("")
async def list_classes(
    user: User = Depends(current_user), session: AsyncSession = Depends(db_session)
):
    """List only the teacher's classes or the student's active enrolled classes."""
    stmt = select(Classroom).order_by(Classroom.created_at.desc())
    if user.role == "teacher":
        stmt = stmt.where(Classroom.teacher_id == user.id)
    elif user.role == "student":
        stmt = stmt.join(Enrollment).where(
            Enrollment.student_id == user.id, Classroom.is_archived.is_(False)
        )
    else:
        raise HTTPException(403, "Gunakan ruang guru atau siswa.")
    rows = (await session.execute(stmt)).scalars().all()
    return [await summary(session, row, user) for row in rows]


@router.post("", status_code=201)
async def create_class(
    body: ClassWrite,
    user: User = Depends(require_teacher),
    session: AsyncSession = Depends(db_session),
):
    """Create a teacher-owned classroom linked to a catalog subject."""
    subject = await select_subject(session, body.subject_id)
    if subject is None and body.subject:
        subject = await session.scalar(
            select(Subject).where(func.lower(Subject.name) == body.subject.lower())
        )
        if subject is None:
            subject = Subject(name=body.subject, created_by=user.id)
            session.add(subject)
            await session.flush()
    if subject is None:
        raise HTTPException(422, "Pilih mata pelajaran kelas.")
    values = body.model_dump()
    values["subject"], values["subject_id"] = subject.name, subject.id
    row = Classroom(teacher_id=user.id, **values)
    session.add(row)
    await session.flush()
    record(session, row, user, "class.created")
    return await summary(session, row, user)


def progress_info(row):
    return {
        "completed": bool(row and row.completed),
        "bookmarked": bool(row and row.bookmarked),
        "completed_at": row.completed_at.isoformat() if row and row.completed_at else None,
    }


@router.get("/student/materials")
async def student_materials(
    user: User = Depends(require_student), session: AsyncSession = Depends(db_session)
):
    """List published materials from the student's active classes and private progress."""
    rows = (
        await session.execute(
            select(ClassMaterial, Classroom, MaterialProgress)
            .join(Classroom, ClassMaterial.class_id == Classroom.id)
            .join(
                Enrollment,
                (Enrollment.class_id == Classroom.id) & (Enrollment.student_id == user.id),
            )
            .outerjoin(
                MaterialProgress,
                (MaterialProgress.material_id == ClassMaterial.id)
                & (MaterialProgress.student_id == user.id),
            )
            .where(Classroom.is_archived.is_(False), ClassMaterial.published.is_(True))
            .order_by(ClassMaterial.created_at.desc(), ClassMaterial.id)
        )
    ).all()
    from api.learning_progress import active_learning_progress

    return [
        {
            **material_info(material),
            "class_id": str(room.id),
            "class_name": room.name,
            "subject": room.subject,
            "progress": progress_info(progress),
            "learning_progress": await active_learning_progress(session, user.id, material),
        }
        for material, room, progress in rows
    ]


@router.get("/teacher/materials")
async def teacher_materials(
    user: User = Depends(require_teacher), session: AsyncSession = Depends(db_session)
):
    """List materials in classrooms owned by the authenticated teacher."""
    rows = (
        await session.execute(
            select(ClassMaterial, Classroom)
            .join(Classroom, ClassMaterial.class_id == Classroom.id)
            .where(Classroom.teacher_id == user.id)
            .order_by(ClassMaterial.created_at.desc())
            .limit(200)
        )
    ).all()
    return [
        {
            **material_info(material),
            "class_id": str(room.id),
            "class_name": room.name,
            "subject": room.subject,
            "is_archived": room.is_archived,
        }
        for material, room in rows
    ]


@router.get("/{class_id}")
async def detail(
    class_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(db_session),
):
    """Read an accessible classroom, its visible materials, and teacher-only roster."""
    row = await accessible(session, class_id, user)
    result = await summary(session, row, user)
    query = (
        select(ClassMaterial)
        .where(ClassMaterial.class_id == row.id)
        .order_by(ClassMaterial.created_at.desc())
    )
    if user.role == "student":
        query = query.where(ClassMaterial.published.is_(True))
    result["materials"] = [material_info(m) for m in (await session.execute(query)).scalars()]
    result["members"] = []
    if user.role == "teacher":
        members = (
            await session.execute(
                select(User)
                .join(Enrollment, Enrollment.student_id == User.id)
                .where(Enrollment.class_id == row.id)
                .order_by(User.full_name)
            )
        ).scalars()
        result["members"] = [
            {
                "id": str(m.id),
                "full_name": m.full_name,
                "username": m.username,
                "is_active": m.is_active,
            }
            for m in members
        ]
    return result


@router.patch("/{class_id}")
async def update_class(
    class_id: uuid.UUID,
    body: ClassUpdate,
    background: BackgroundTasks,
    user: User = Depends(require_teacher),
    session: AsyncSession = Depends(db_session),
):
    """Update or archive the teacher's own classroom."""
    row = await accessible(session, class_id, user)
    row = await session.scalar(
        select(Classroom)
        .where(Classroom.id == row.id)
        .execution_options(populate_existing=True)
        .with_for_update()
    )
    if row is None:
        raise HTTPException(404, "Kelas tidak ditemukan.")
    changed_materials = (
        await change_subject(session, row, body.subject_id)
        if "subject_id" in body.model_fields_set
        else []
    )
    for key, value in body.model_dump(
        exclude_unset=True, exclude_none=True, exclude={"subject_id"}
    ).items():
        setattr(row, key, value)
    record(session, row, user, "class.updated")
    await session.flush()
    result = await summary(session, row, user)
    for material in changed_materials:
        if material.published and not row.is_archived:
            await enqueue_material(session, material)
    await session.commit()
    return result


@router.get("/{class_id}/materials/{material_id}/concepts")
async def read_mapping(
    class_id: uuid.UUID,
    material_id: uuid.UUID,
    user: User = Depends(require_teacher),
    session: AsyncSession = Depends(db_session),
):
    """Read reviewed material concepts and the canonical subject catalog."""
    classroom = await accessible(session, class_id, user)
    material = await session.get(ClassMaterial, material_id)
    if material is None or material.class_id != class_id:
        raise HTTPException(404, "Materi tidak ditemukan.")
    return await mapping_out(session, material, classroom)


@router.put("/{class_id}/materials/{material_id}/concepts")
async def review_mapping(
    class_id: uuid.UUID,
    material_id: uuid.UUID,
    body: MappingApproval,
    background: BackgroundTasks,
    user: User = Depends(require_teacher),
    session: AsyncSession = Depends(db_session),
):
    """Approve concept mapping with content and mapping revision checks."""
    classroom = await accessible(session, class_id, user, write=True)
    material = await session.scalar(
        select(ClassMaterial)
        .where(ClassMaterial.id == material_id, ClassMaterial.class_id == class_id)
        .with_for_update()
    )
    if material is None:
        raise HTTPException(404, "Materi tidak ditemukan.")
    await approve_mapping(session, material, classroom, body, user)
    record(session, classroom, user, "material.concepts_reviewed", material.id)
    result = await mapping_out(session, material, classroom)
    if material.published:
        await enqueue_material(session, material)
    await session.commit()
    return result


@router.get("/{class_id}/member-candidates")
async def member_candidates(
    class_id: uuid.UUID,
    q: str = "",
    user: User = Depends(require_teacher),
    session: AsyncSession = Depends(db_session),
):
    """Search active students who are not yet enrolled in the teacher's classroom."""
    await accessible(session, class_id, user)
    term = q.strip()[:64].replace("%", "").replace("_", "").strip()
    if len(term) < 2:
        return []
    pattern = f"%{term}%"
    enrolled = select(Enrollment.student_id).where(Enrollment.class_id == class_id)
    rows = (
        await session.scalars(
            select(User)
            .where(
                User.role == "student",
                User.is_active.is_(True),
                User.id.not_in(enrolled),
                User.full_name.ilike(pattern) | User.username.ilike(pattern),
            )
            .order_by(User.full_name)
            .limit(20)
        )
    ).all()
    return [{"id": str(m.id), "full_name": m.full_name, "username": m.username} for m in rows]


@router.post("/{class_id}/members/batch", status_code=201)
async def add_members(
    class_id: uuid.UUID,
    body: MemberBatchWrite,
    user: User = Depends(require_teacher),
    session: AsyncSession = Depends(db_session),
):
    """Enroll several active students chosen from the candidate search."""
    row = await accessible(session, class_id, user, write=True)
    ids = list(dict.fromkeys(body.student_ids))
    students = (
        await session.scalars(
            select(User).where(User.id.in_(ids), User.role == "student", User.is_active.is_(True))
        )
    ).all()
    enrolled = set(
        (
            await session.scalars(
                select(Enrollment.student_id).where(
                    Enrollment.class_id == class_id, Enrollment.student_id.in_(ids)
                )
            )
        ).all()
    )
    added = [student for student in students if student.id not in enrolled]
    if not added:
        raise HTTPException(409, "Siswa yang dipilih sudah menjadi anggota kelas.")
    for student in added:
        session.add(Enrollment(class_id=class_id, student_id=student.id))
    try:
        await session.flush()
    except IntegrityError as error:
        await session.rollback()
        raise HTTPException(409, "Keanggotaan sudah berubah. Muat ulang kelas.") from error
    for student in added:
        record(session, row, user, "member.added", student.id)
    return {"added": len(added)}


@router.post("/{class_id}/members", status_code=201)
async def add_member(
    class_id: uuid.UUID,
    body: MemberWrite,
    user: User = Depends(require_teacher),
    session: AsyncSession = Depends(db_session),
):
    """Enroll an active student in the teacher's own classroom."""
    row = await accessible(session, class_id, user, write=True)
    student = await session.scalar(
        select(User).where(
            User.username == body.username.lower(), User.role == "student", User.is_active.is_(True)
        )
    )
    if student is None:
        raise HTTPException(404, "Siswa aktif dengan username tersebut tidak ditemukan.")
    if await session.get(Enrollment, (class_id, student.id)):
        raise HTTPException(409, "Siswa sudah menjadi anggota kelas.")
    session.add(Enrollment(class_id=class_id, student_id=student.id))
    try:
        await session.flush()
    except IntegrityError as error:
        await session.rollback()
        raise HTTPException(409, "Keanggotaan sudah berubah. Muat ulang kelas.") from error
    record(session, row, user, "member.added", student.id)
    return {"id": str(student.id)}


@router.delete("/{class_id}/members/{student_id}", status_code=204)
async def remove_member(
    class_id: uuid.UUID,
    student_id: uuid.UUID,
    user: User = Depends(require_teacher),
    session: AsyncSession = Depends(db_session),
):
    """Remove an enrollment from the teacher's own classroom."""
    row = await accessible(session, class_id, user, write=True)
    member = await session.get(Enrollment, (class_id, student_id))
    if member is None:
        raise HTTPException(404, "Anggota tidak ditemukan.")
    await session.delete(member)
    record(session, row, user, "member.removed", student_id)


@router.post("/{class_id}/materials", status_code=201)
async def create_material(
    class_id: uuid.UUID,
    body: MaterialWrite,
    background: BackgroundTasks,
    user: User = Depends(require_teacher),
    session: AsyncSession = Depends(db_session),
):
    """Save reviewed text and queue an AI index when the material is published."""
    row = await accessible(session, class_id, user, write=True)
    await source_for(session, class_id, body.source_import_id)
    material = ClassMaterial(class_id=class_id, **body.model_dump())
    session.add(material)
    await session.flush()
    record(session, row, user, "material.created", material.id)
    if material.published:
        await enqueue_material(session, material)
    await session.commit()
    return material_info(material)


@router.post("/{class_id}/materials/import", status_code=202)
async def preview_material_import(
    class_id: uuid.UUID,
    file: UploadFile,
    first_page: int | None = Form(None, ge=1, le=500),
    last_page: int | None = Form(None, ge=1, le=500),
    user: User = Depends(require_teacher),
    session: AsyncSession = Depends(db_session),
):
    """Extract a document for review; importing does not save or publish it."""
    classroom = await accessible(session, class_id, user, write=True)
    return await create_import(session, classroom, user, file, first_page, last_page)


@router.get("/{class_id}/imports")
async def list_imports(
    class_id: uuid.UUID, user=Depends(require_teacher), session=Depends(db_session)
):
    """List durable import receipts for an owned classroom."""
    await accessible(session, class_id, user)
    rows = list(
        await session.scalars(
            select(MaterialImport)
            .where(MaterialImport.class_id == class_id)
            .order_by(MaterialImport.created_at.desc())
            .limit(20)
        )
    )
    return [await import_out(session, row, include_preview=False) for row in rows]


async def owned_import(session, class_id, import_id, user):
    await accessible(session, class_id, user)
    artifact = await session.get(MaterialImport, import_id)
    if artifact is None or artifact.class_id != class_id:
        raise HTTPException(404, "Dokumen tidak ditemukan.")
    return artifact


@router.get("/{class_id}/imports/{import_id}")
async def read_import(
    class_id: uuid.UUID,
    import_id: uuid.UUID,
    user=Depends(require_teacher),
    session=Depends(db_session),
):
    """Read a saved import preview and processing state."""
    return await import_out(session, await owned_import(session, class_id, import_id, user))


@router.get("/{class_id}/imports/{import_id}/original")
async def download_original(
    class_id: uuid.UUID,
    import_id: uuid.UUID,
    user=Depends(require_teacher),
    session=Depends(db_session),
):
    """Download the private original source of an owned import."""
    from fastapi.responses import FileResponse

    artifact = await owned_import(session, class_id, import_id, user)
    return FileResponse(
        original_path(artifact),
        filename=artifact.filename,
        media_type="application/octet-stream",
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )


@router.post("/{class_id}/imports/{import_id}/retry", status_code=202)
async def retry_import(
    class_id: uuid.UUID,
    import_id: uuid.UUID,
    user=Depends(require_teacher),
    session=Depends(db_session),
):
    """Retry a failed durable import without uploading its source again."""
    await accessible(session, class_id, user, write=True)
    artifact = await owned_import(session, class_id, import_id, user)
    job = await session.scalar(
        select(BackgroundJob).where(BackgroundJob.id == artifact.job_id).with_for_update()
    )
    if job.state == "failed":
        from api.durable_jobs import enqueue

        await enqueue(session, job.kind, job.target_id, job.payload, job.dedupe_key, retry=True)
        await session.commit()
    return await import_out(session, artifact)


class ImportPageRange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    first_page: int = Field(ge=1, le=500)
    last_page: int = Field(ge=1, le=500)


@router.post("/{class_id}/imports/{import_id}/pages", status_code=202)
async def import_pages(
    class_id: uuid.UUID,
    import_id: uuid.UUID,
    body: ImportPageRange,
    user=Depends(require_teacher),
    session=Depends(db_session),
):
    """Create a chapter preview from selected pages of a saved PDF."""
    await accessible(session, class_id, user, write=True)
    artifact = await owned_import(session, class_id, import_id, user)
    if (
        not artifact.filename.lower().endswith(".pdf")
        or body.last_page < body.first_page
        or body.last_page - body.first_page + 1 > 150
    ):
        raise HTTPException(422, "Pilih rentang halaman PDF yang valid, maksimal 150 halaman.")
    from api.durable_jobs import enqueue

    new = MaterialImport(
        id=uuid.uuid4(),
        class_id=class_id,
        uploaded_by=user.id,
        filename=artifact.filename,
        stored_path=str(original_path(artifact)),
        sha256=artifact.sha256,
        size_bytes=artifact.size_bytes,
        job_id=uuid.uuid4(),
    )
    job = await enqueue(session, "material_import", new.id, body.model_dump(), f"import:{new.id}")
    new.job_id = job.id
    session.add(new)
    await session.commit()
    return await import_out(session, new)


@router.get("/{class_id}/materials/{material_id}")
async def read_material(
    class_id: uuid.UUID,
    material_id: uuid.UUID,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(db_session),
):
    """Read material after verifying class access, publication, and private progress."""
    await accessible(session, class_id, user)
    row = await session.get(ClassMaterial, material_id)
    if row is None or row.class_id != class_id or (user.role == "student" and not row.published):
        raise HTTPException(404, "Materi tidak ditemukan.")
    progress = (
        await session.get(MaterialProgress, (material_id, user.id))
        if user.role == "student"
        else None
    )
    from api.learning_progress import active_learning_progress

    return {
        **material_info(row),
        "content": row.content,
        "progress": progress_info(progress),
        "learning_progress": await active_learning_progress(session, user.id, row)
        if user.role == "student"
        else None,
    }


class ProgressWrite(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    completed: bool | None = None
    bookmarked: bool | None = None


@router.patch("/{class_id}/materials/{material_id}/progress")
async def update_progress(
    class_id: uuid.UUID,
    material_id: uuid.UUID,
    body: ProgressWrite,
    user: User = Depends(require_student),
    session: AsyncSession = Depends(db_session),
):
    """Update only the signed-in student's bookmark or reading completion."""
    await accessible(session, class_id, user)
    # Serialize first-time progress creation and publication changes in PostgreSQL.
    material = await session.scalar(
        select(ClassMaterial)
        .where(
            ClassMaterial.id == material_id,
            ClassMaterial.class_id == class_id,
            ClassMaterial.published.is_(True),
        )
        .with_for_update()
    )
    if material is None:
        raise HTTPException(404, "Materi tidak ditemukan.")
    row = await session.get(MaterialProgress, (material_id, user.id))
    if row is None:
        row = MaterialProgress(material_id=material_id, student_id=user.id)
        session.add(row)
    if body.completed is not None:
        if body.completed and not row.completed:
            row.completed_at = datetime.now(UTC)
        elif not body.completed:
            row.completed_at = None
        row.completed = body.completed
    if body.bookmarked is not None:
        row.bookmarked = body.bookmarked
    await session.flush()
    return progress_info(row)


@router.put("/{class_id}/materials/{material_id}")
async def edit_material(
    class_id: uuid.UUID,
    material_id: uuid.UUID,
    body: MaterialWrite,
    background: BackgroundTasks,
    user: User = Depends(require_teacher),
    session: AsyncSession = Depends(db_session),
):
    """Save a new reviewed revision and rebuild its AI index if published."""
    classroom = await accessible(session, class_id, user, write=True)
    await source_for(session, class_id, body.source_import_id)
    row = await session.scalar(
        select(ClassMaterial).where(ClassMaterial.id == material_id).with_for_update()
    )
    if row is None or row.class_id != class_id:
        raise HTTPException(404, "Materi tidak ditemukan.")
    changed = (
        row.content != body.content
        or row.source_filename != body.source_filename
        or row.source_import_id != body.source_import_id
    )
    if changed:
        row.content_version += 1
        row.n_chunks = 0
        row.rag_status = "pending"
        row.rag_error = None
    for key, value in body.model_dump().items():
        setattr(row, key, value)
    if not row.published:
        row.rag_status = "pending"
    elif (
        row.indexed_version == row.content_version
        and row.indexed_mapping_version == row.mapping_version
        and row.n_chunks > 0
    ):
        row.rag_status = "ready"
    record(session, classroom, user, "material.updated", row.id)
    await session.flush()
    if row.published and row.rag_status != "ready":
        await enqueue_material(session, row)
    await session.commit()
    return material_info(row)


@router.post("/{class_id}/materials/{material_id}/index", status_code=202)
async def retry_material_index(
    class_id: uuid.UUID,
    material_id: uuid.UUID,
    background: BackgroundTasks,
    user: User = Depends(require_teacher),
    session: AsyncSession = Depends(db_session),
):
    """Retry indexing a published material owned by this teacher."""
    classroom = await accessible(session, class_id, user, write=True)
    row = await session.scalar(
        select(ClassMaterial).where(ClassMaterial.id == material_id).with_for_update()
    )
    if row is None or row.class_id != class_id:
        raise HTTPException(404, "Materi tidak ditemukan.")
    if not row.published:
        raise HTTPException(
            409, "Terbitkan materi terlebih dahulu agar dapat diproses untuk Tutor AI."
        )
    if (
        row.rag_status == "ready"
        and row.indexed_version == row.content_version
        and row.indexed_mapping_version == row.mapping_version
        and row.n_chunks > 0
    ):
        return material_info(row)
    row.rag_status = "pending"
    row.rag_error = None
    record(session, classroom, user, "material.index-requested", row.id)
    await enqueue_material(session, row, retry=True)
    await session.commit()
    return material_info(row)

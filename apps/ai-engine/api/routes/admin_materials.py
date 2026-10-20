"""Admin catalog and moderation of reviewed classroom materials."""

import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import func, select

from api.dependencies import db_session, require_admin
from api.durable_jobs import enqueue_material
from api.material_artifacts import import_out, original_path, source_for
from api.material_document import material_document, material_values, project_material
from api.routes.classrooms import MaterialWrite, material_info, record
from database.models import ClassMaterial, Classroom, MaterialImport, User

router = APIRouter(tags=["admin-materials"])


def catalog_query():
    return (
        select(ClassMaterial, Classroom, User)
        .join(Classroom, ClassMaterial.class_id == Classroom.id)
        .join(User, Classroom.teacher_id == User.id)
    )


def catalog_item(material, classroom, teacher, *, content=False):
    result = {
        **material_info(material),
        "class_id": str(classroom.id),
        "class_name": classroom.name,
        "subject": classroom.subject,
        "is_archived": classroom.is_archived,
        "teacher_id": str(teacher.id),
        "teacher_name": teacher.full_name,
    }
    if content:
        result["content"] = material.content
        result["document"] = material_document(material).model_dump(mode="json")
        result["speech_text"] = project_material(material_document(material)).speech_text
    return result


@router.get("/materials")
async def list_materials(
    search: str = Query("", max_length=120),
    published: bool | None = None,
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
    actor=Depends(require_admin),
    session=Depends(db_session),
):
    """List classroom materials and processing state for administrators."""
    query = catalog_query()
    if search.strip():
        # User text remains a literal substring, not a wildcard expression.
        value = search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        query = query.where(ClassMaterial.title.ilike(f"%{value}%", escape="\\"))
    if published is not None:
        query = query.where(ClassMaterial.published.is_(published))
    total = await session.scalar(select(func.count()).select_from(query.subquery()))
    rows = (
        await session.execute(
            query.order_by(ClassMaterial.created_at.desc(), ClassMaterial.id)
            .offset(offset)
            .limit(limit)
        )
    ).all()
    return {
        "items": [catalog_item(*row) for row in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


async def material_for(session, material_id, *, lock=False):
    query = catalog_query().where(ClassMaterial.id == material_id)
    if lock:
        class_id = await session.scalar(
            select(ClassMaterial.class_id).where(ClassMaterial.id == material_id)
        )
        classroom_id = (
            await session.scalar(
                select(Classroom.id).where(Classroom.id == class_id).with_for_update()
            )
            if class_id
            else None
        )
        if classroom_id is None:
            raise HTTPException(404, "Materi tidak ditemukan.")
        # Teacher changes also lock classroom -> material. ClassActivity's FK
        # must not make an admin holding the material wait for its classroom.
        query = query.with_for_update(of=ClassMaterial).execution_options(populate_existing=True)
    row = (await session.execute(query)).one_or_none()
    if row is None:
        raise HTTPException(404, "Materi tidak ditemukan.")
    return row


@router.get("/materials/{material_id}")
async def read_material(
    material_id: uuid.UUID, actor=Depends(require_admin), session=Depends(db_session)
):
    """Inspect reviewed material content and provenance."""
    return catalog_item(*await material_for(session, material_id), content=True)


@router.put("/materials/{material_id}")
async def update_material(
    material_id: uuid.UUID,
    body: MaterialWrite,
    background: BackgroundTasks,
    actor=Depends(require_admin),
    session=Depends(db_session),
):
    """Revise or archive reviewed material with a content version check."""
    material, classroom, teacher = await material_for(session, material_id, lock=True)
    await source_for(session, classroom.id, body.source_import_id)
    if classroom.is_archived:
        raise HTTPException(409, "Buka arsip kelas sebelum mengubah materi.")
    for key, value in (await material_values(session, classroom.id, body, material)).items():
        setattr(material, key, value)
    if not material.published:
        material.rag_status = "pending"
    elif (
        material.indexed_version == material.content_version
        and material.indexed_mapping_version == material.mapping_version
        and material.n_chunks > 0
    ):
        material.rag_status = "ready"
    record(session, classroom, actor, "material.admin-updated", material.id)
    await session.flush()
    if material.published and material.rag_status != "ready":
        await enqueue_material(session, material)
    from api.progress_guidance_service import queue_affected_plans

    await queue_affected_plans(session, classroom.id)
    await session.commit()
    return catalog_item(material, classroom, teacher, content=True)


@router.post("/materials/{material_id}/index", status_code=202)
async def reindex_material(
    material_id: uuid.UUID,
    background: BackgroundTasks,
    actor=Depends(require_admin),
    session=Depends(db_session),
):
    """Queue durable indexing for the current material version."""
    material, classroom, teacher = await material_for(session, material_id, lock=True)
    if classroom.is_archived or not material.published:
        raise HTTPException(409, "Materi harus terbit di kelas aktif sebelum diproses.")
    if (
        material.rag_status != "ready"
        or material.indexed_version != material.content_version
        or material.indexed_mapping_version != material.mapping_version
        or material.n_chunks <= 0
    ):
        material.rag_status, material.rag_error = "pending", None
        record(session, classroom, actor, "material.admin-index-requested", material.id)
        await enqueue_material(session, material, retry=True)
        await session.commit()
    return catalog_item(material, classroom, teacher, content=True)


@router.get("/materials/{material_id}/source")
async def inspect_source(
    material_id: uuid.UUID, actor=Depends(require_admin), session=Depends(db_session)
):
    """Inspect private source metadata and page extraction provenance."""
    material, _, _ = await material_for(session, material_id)
    artifact = (
        await session.get(MaterialImport, material.source_import_id)
        if material.source_import_id
        else None
    )
    if artifact is None:
        raise HTTPException(404, "Materi ini belum memiliki berkas sumber.")
    return await import_out(session, artifact)


@router.get("/materials/{material_id}/original")
async def download_source(
    material_id: uuid.UUID,
    preview: bool = False,
    actor=Depends(require_admin),
    session=Depends(db_session),
):
    """Download an original source through administrator authorization."""
    from fastapi.responses import FileResponse

    material, _, _ = await material_for(session, material_id)
    artifact = (
        await session.get(MaterialImport, material.source_import_id)
        if material.source_import_id
        else None
    )
    if artifact is None:
        raise HTTPException(404, "Materi ini belum memiliki berkas sumber.")
    is_pdf_preview = preview and artifact.filename.casefold().endswith(".pdf")
    return FileResponse(
        original_path(artifact),
        filename=artifact.filename,
        media_type="application/pdf" if is_pdf_preview else "application/octet-stream",
        content_disposition_type="inline" if is_pdf_preview else "attachment",
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )

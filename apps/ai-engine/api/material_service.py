"""Versioned indexing and authorization for classroom-grounded tutoring."""

import logging
import uuid

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.material_concepts import current_concepts
from config.settings import settings
from database.models import ClassMaterial, Classroom, Enrollment, User
from database.session import async_session
from rag.ingestion import build_material_records
from rag.stores.pgvector_store import replace_material_chunks

log = logging.getLogger(__name__)


async def resolve_tutoring_context(
    session: AsyncSession,
    class_id: uuid.UUID | None,
    material_id: uuid.UUID | None,
    user: User,
    *,
    require_ready: bool = True,
) -> dict | None:
    """Recheck access and current indexing before every student Tutor turn."""
    if class_id is None:
        if material_id is not None:
            raise HTTPException(422, "Pilih kelas untuk materi ini.")
        return None
    if user.role != "student":
        raise HTTPException(403, "Tutor kelas hanya tersedia untuk siswa.")
    classroom = await session.get(Classroom, class_id)
    if (
        classroom is None
        or classroom.is_archived
        or await session.get(Enrollment, (class_id, user.id)) is None
    ):
        raise HTTPException(404, "Kelas atau materi tidak ditemukan.")
    material = None
    if material_id is not None:
        material = await session.get(ClassMaterial, material_id)
        if material is None or material.class_id != class_id or not material.published:
            raise HTTPException(404, "Kelas atau materi tidak ditemukan.")
        ready = (
            material.rag_status == "ready"
            and material.indexed_version == material.content_version
            and material.indexed_mapping_version == material.mapping_version
            and material.n_chunks > 0
        )
    else:
        ready = await session.scalar(
            select(func.count())
            .select_from(ClassMaterial)
            .where(
                ClassMaterial.class_id == class_id,
                ClassMaterial.published.is_(True),
                ClassMaterial.rag_status == "ready",
                ClassMaterial.indexed_version == ClassMaterial.content_version,
                ClassMaterial.indexed_mapping_version == ClassMaterial.mapping_version,
                ClassMaterial.n_chunks > 0,
            )
        )
    if require_ready and material is not None:
        from api.learning_content import material_learning_units

        material_learning_units(material, require_content=True)
    if require_ready and not ready:
        raise HTTPException(
            409,
            "Materi belum siap untuk Tutor AI. Tunggu indeks selesai atau minta guru memproses ulang.",
        )
    return {
        "class_id": str(classroom.id),
        "material_id": str(material.id) if material else None,
        "subject_name": classroom.subject,
        "material_title": material.title if material else None,
        "subject_id": str(classroom.subject_id) if classroom.subject_id else None,
        "mapping_version": material.mapping_version if material else None,
        "approved_material_concepts": await current_concepts(session, material, classroom)
        if material
        else [],
    }


async def index_class_material(
    material_id: uuid.UUID, version: int, *, expected_mapping=None, lease=None
) -> None:
    """Publish an index atomically; outdated jobs never replace newer content."""
    mapping_version = None
    old_qdrant_ids: list[str] = []
    qdrant_points: list[dict] = []
    try:
        async with async_session() as session:
            row = await session.scalar(
                select(ClassMaterial).where(ClassMaterial.id == material_id).with_for_update()
            )
            if row is None or row.content_version != version or not row.published:
                return
            if expected_mapping is not None and row.mapping_version != expected_mapping:
                return
            if lease:
                from api.durable_jobs import assert_lease

                await assert_lease(session, *lease)
            classroom = await session.get(Classroom, row.class_id)
            if classroom is None or classroom.is_archived:
                return
            if (
                row.rag_status == "ready"
                and row.indexed_version == version
                and row.indexed_mapping_version == row.mapping_version
                and row.n_chunks > 0
            ):
                return
            row.rag_status = "processing"
            row.rag_error = None
            content, source = row.content, row.source_filename or row.title
            from api.material_document import material_document

            document = material_document(row)
            provenance = {}
            if row.source_import_id:
                from database.models import BackgroundJob, MaterialImport

                artifact = await session.get(MaterialImport, row.source_import_id)
                imported = await session.get(BackgroundJob, artifact.job_id) if artifact else None
                if artifact and imported and imported.result:
                    provenance = {
                        "source_import_id": str(artifact.id),
                        "source_sha256": artifact.sha256,
                        "page_range": imported.result.get("page_range"),
                        "extraction_methods": sorted(
                            {p["method"] for p in imported.result.get("pages", [])}
                        ),
                        "teacher_reviewed": True,
                    }
            mapping_version = row.mapping_version
            concepts = await current_concepts(session, row, classroom)
            await session.commit()

        records = await build_material_records(
            content,
            source=source,
            document=document,
            content_version=version,
            mapping_version=mapping_version,
        )
        if not records:
            raise ValueError("No material chunks")
        for record in records:
            record["material_mapping_version"] = mapping_version
            record["accessibility_metadata"] = {
                **record.get("accessibility_metadata", {}),
                "approved_concept_ids": [concept["id"] for concept in concepts],
                "original_provenance": provenance,
            }

        async with async_session() as session:
            row = await session.scalar(
                select(ClassMaterial).where(ClassMaterial.id == material_id).with_for_update()
            )
            if (
                row is None
                or row.content_version != version
                or row.mapping_version != mapping_version
                or not row.published
            ):
                return
            classroom = await session.get(Classroom, row.class_id)
            if classroom is None or classroom.is_archived:
                return
            if lease:
                await assert_lease(session, *lease)
            if (
                row.rag_status == "ready"
                and row.indexed_version == version
                and row.indexed_mapping_version == mapping_version
                and row.n_chunks > 0
            ):
                return
            old_qdrant_ids, qdrant_points = await replace_material_chunks(
                session,
                material_id,
                version,
                records,
                class_id=row.class_id,
                mapping_version=mapping_version,
            )
            row.indexed_version = version
            row.indexed_mapping_version = mapping_version
            row.n_chunks = len(records)
            row.rag_status = "ready"
            row.rag_error = None
            from api.progress_guidance_service import queue_affected_plans

            await session.flush()
            await queue_affected_plans(session, row.class_id)
            await session.commit()
        if settings.VECTOR_BACKEND == "qdrant":
            from rag.stores.qdrant_store import sync_material_replacement

            await sync_material_replacement(old_qdrant_ids, qdrant_points)
    except Exception:
        if lease:
            # Queue owns retry status; obsolete lease holders cannot mutate it.
            raise
        log.exception("Classroom material indexing failed for %s", material_id)
        try:
            async with async_session() as session:
                row = await session.scalar(
                    select(ClassMaterial).where(ClassMaterial.id == material_id).with_for_update()
                )
                if (
                    row is not None
                    and row.content_version == version
                    and (mapping_version is None or row.mapping_version == mapping_version)
                    and row.rag_status != "ready"
                ):
                    row.rag_status = "failed" if row.published else "pending"
                    row.rag_error = "Indeks AI belum berhasil dibuat. Periksa koneksi lalu gunakan Proses ulang."
                    await session.commit()
        except Exception:
            log.exception("Could not record material indexing failure for %s", material_id)

"""Separate restartable SQL worker: python -m api.material_worker."""

import asyncio
import hashlib
import logging
import tempfile
from contextlib import suppress
from pathlib import Path

from sqlalchemy import delete, select
from starlette.concurrency import run_in_threadpool

from api import durable_jobs as jobs
from api.material_artifacts import original_path
from api.material_imports import extract_document
from config.logging import configure_logging
from config.settings import settings
from database.models import ClassMaterial, Classroom, CurriculumChunk, Document, MaterialImport
from database.session import async_session, close_db, init_db
from tools.provider_usage import usage_context

log = logging.getLogger(__name__)
HEARTBEAT_PATH = Path(tempfile.gettempdir()) / "kodmod-worker-heartbeat"


async def keep_lease(job):
    while True:
        HEARTBEAT_PATH.touch()
        await asyncio.sleep(settings.JOB_LEASE_SECONDS / 3)
        if not await jobs.heartbeat(job.id, job.lease_token):
            return


async def process(job):
    if job.kind == "progress_plan":
        from api.progress_guidance_worker import process_progress_plan

        return await process_progress_plan(job)
    if job.kind == "material_import":
        async with async_session() as session:
            artifact = await session.get(MaterialImport, job.target_id)
            classroom = await session.get(Classroom, artifact.class_id) if artifact else None
            if artifact is None or classroom is None or classroom.is_archived:
                return {"cancelled": True}
            path, filename, digest = original_path(artifact), artifact.filename, artifact.sha256
        data = await run_in_threadpool(path.read_bytes)
        if hashlib.sha256(data).hexdigest() != digest:
            raise ValueError("Source integrity changed")
        return await run_in_threadpool(
            extract_document,
            data,
            filename,
            first_page=job.payload.get("first_page"),
            last_page=job.payload.get("last_page"),
            allow_ocr=True,
        )
    if job.kind == "material_index":
        from api.material_service import index_class_material

        await index_class_material(
            job.target_id,
            job.payload["version"],
            expected_mapping=job.payload["mapping"],
            lease=(job.id, job.lease_token),
        )
        async with async_session() as session:
            row = await session.get(ClassMaterial, job.target_id)
            if (
                row
                and row.published
                and row.content_version == job.payload["version"]
                and row.mapping_version == job.payload["mapping"]
            ):
                if row.rag_status != "ready":
                    raise ValueError("Index not ready")
        return {"processed": True}
    if job.kind == "document_index":
        from rag.ingestion import build_material_records

        async with async_session() as session:
            document = await session.scalar(
                select(Document).where(Document.id == job.target_id).with_for_update()
            )
            if document is None or (document.status == "ready" and document.n_chunks > 0):
                return {"processed": True}
            await jobs.assert_lease(session, job.id, job.lease_token)
            path, subject_id, filename = (
                original_path(document),
                document.subject_id,
                document.filename,
            )
            document.status = "processing"
            await session.commit()
        preview = await run_in_threadpool(
            extract_document, path.read_bytes(), filename, allow_ocr=True
        )
        if not preview.get("content"):
            raise ValueError("Select chapter through reviewed classroom import")
        records = await build_material_records(preview["content"], source=filename)
        if not records:
            raise ValueError("No document chunks")
        async with async_session() as session:
            document = await session.scalar(
                select(Document).where(Document.id == job.target_id).with_for_update()
            )
            if document is None:
                return {"cancelled": True}
            await jobs.assert_lease(session, job.id, job.lease_token)
            await session.execute(
                delete(CurriculumChunk).where(CurriculumChunk.document_id == document.id)
            )
            session.add_all(
                [
                    CurriculumChunk(
                        document_id=document.id,
                        subject_id=subject_id,
                        content=record["text"],
                        embedding=record["embedding"],
                        source=filename,
                        language=record.get("language", "id"),
                        chunk_index=record["chunk_index"],
                        section_title=record.get("section_title"),
                        accessibility_metadata=record.get("accessibility_metadata", {}),
                    )
                    for record in records
                ]
            )
            document.status, document.n_chunks, document.error_message = "ready", len(records), None
            from datetime import UTC, datetime

            document.ingested_at = datetime.now(UTC)
            await session.commit()
        return {"processed": True}
    raise ValueError("Unknown job kind")


async def _run_job(job):
    heartbeat = asyncio.create_task(keep_lease(job))
    try:
        result = await process(job)
        await jobs.finish(
            job.id, job.lease_token, result=result, require_ready=job.kind == "material_index"
        )
    except jobs.LeaseLostError:
        log.info("Worker lease expired for job %s", job.id)
    except Exception:
        log.warning("Background job %s failed", job.id)
        await jobs.fail(job.id, job.lease_token)
    finally:
        heartbeat.cancel()
        with suppress(asyncio.CancelledError):
            await heartbeat


async def run_job(job):
    actor_id = None
    async with async_session() as session:
        if job.kind == "material_import":
            artifact = await session.get(MaterialImport, job.target_id)
            actor_id = artifact.uploaded_by if artifact else None
        elif job.kind == "material_index":
            row = await session.get(ClassMaterial, job.target_id)
            classroom = await session.get(Classroom, row.class_id) if row else None
            actor_id = classroom.teacher_id if classroom else None
        elif job.kind == "progress_plan":
            import uuid

            actor_id = uuid.UUID(job.payload["student_id"])
    with usage_context(
        request_id=job.id, actor_id=actor_id, target_id=job.target_id, target_type=job.kind
    ):
        await _run_job(job)


async def main():
    configure_logging()
    await init_db()
    try:
        while True:
            HEARTBEAT_PATH.touch()
            from api.progress_guidance_worker import reconcile_due_plans

            await reconcile_due_plans()
            job = await jobs.claim()
            if job:
                await run_job(job)
            else:
                await asyncio.sleep(2)
    finally:
        await close_db()


if __name__ == "__main__":
    asyncio.run(main())

"""Separate restartable SQL worker: python -m api.material_worker."""

import asyncio
import hashlib
import logging
import tempfile
import time
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
        preview = await run_in_threadpool(
            extract_document,
            data,
            filename,
            first_page=job.payload.get("first_page"),
            last_page=job.payload.get("last_page"),
            allow_ocr=True,
        )
        if preview.get("document"):
            await enrich_import_preview(preview, data, artifact, job)
        return preview
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
                return {"processed": True, "n_chunks": row.n_chunks}
        return {"processed": True}
    if job.kind == "document_index":
        from models.material_document import MaterialDocument
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
        records = await build_material_records(
            preview["content"],
            source=filename,
            document=MaterialDocument.model_validate(preview["document"]),
        )
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
        return {"processed": True, "n_chunks": len(records)}
    raise ValueError("Unknown job kind")


async def _run_job(job):
    heartbeat = asyncio.create_task(keep_lease(job))
    started = time.perf_counter()
    try:
        result = await process(job)
        finished = await jobs.finish(
            job.id, job.lease_token, result=result, require_ready=job.kind == "material_index"
        )
        if finished and job.kind in {"material_import", "material_index", "document_index"}:
            from tools.learning_trace import LearningTraceEvent, record_learning_trace

            document = result.get("document") if isinstance(result, dict) else None
            blocks = document.get("blocks", []) if isinstance(document, dict) else []
            accepted = sum(
                1
                for block in blocks
                if isinstance(block, dict) and block.get("review_state") == "accepted"
            )
            indexed_count = result.get("n_chunks") if isinstance(result, dict) else None
            await record_learning_trace(
                LearningTraceEvent(
                    request_id=job.id,
                    correlation_id=job.id,
                    stage="import" if job.kind == "material_import" else "unit",
                    node=f"material_worker.{job.kind}",
                    actor_role="admin" if job.kind == "document_index" else "teacher",
                    source_ids=[str(job.target_id)],
                    extractor_version=(
                        str(document.get("extractor_version"))[:80]
                        if isinstance(document, dict) and document.get("extractor_version")
                        else None
                    ),
                    candidate_count=len(blocks) if blocks else None,
                    accepted_count=accepted if blocks else indexed_count,
                    latency_ms=min(180_000, round((time.perf_counter() - started) * 1000)),
                )
            )
    except jobs.LeaseLostError:
        log.info("Worker lease expired for job %s", job.id)
    except Exception:
        log.warning("Background job %s failed", job.id)
        if job.kind in {"material_import", "material_index", "document_index"}:
            from tools.learning_trace import LearningTraceEvent, record_learning_trace

            await record_learning_trace(
                LearningTraceEvent(
                    request_id=job.id,
                    correlation_id=job.id,
                    stage="import" if job.kind == "material_import" else "unit",
                    node=f"material_worker.{job.kind}",
                    actor_role="admin" if job.kind == "document_index" else "teacher",
                    source_ids=[str(job.target_id)],
                    fallback_reason="worker_error",
                    latency_ms=min(180_000, round((time.perf_counter() - started) * 1000)),
                )
            )
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


async def enrich_import_preview(preview, data, artifact, job):
    import uuid

    from api.material_assets import asset_root, normalize_asset
    from api.material_document import block_text
    from api.pdf_regions import region_cache_key, render_region
    from database.models import MaterialAsset
    from models.material_document import MaterialBlock, MaterialDocument
    from tools.material_vision_tool import VisionBudget, analyze_material_region

    document = MaterialDocument.model_validate(preview["document"])
    budget = VisionBudget()
    additions = []
    for block in document.blocks:
        block.provenance.import_id = artifact.id
        if block.type != "image" or block.provenance.page is None or block.provenance.bbox is None:
            continue
        image = await run_in_threadpool(
            render_region, data, page_index=block.provenance.page - 1, bbox=block.provenance.bbox
        )
        encoded, mime, width, height = await run_in_threadpool(normalize_asset, image)
        ident = uuid.uuid5(artifact.id, block.id)
        block.asset_id = ident
        key = f"{ident}.png"
        async with async_session() as session:
            await jobs.assert_lease(session, job.id, job.lease_token)
            if await session.get(MaterialAsset, ident) is None:
                path = asset_root() / key
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(encoded)
                session.add(
                    MaterialAsset(
                        id=ident,
                        class_id=artifact.class_id,
                        owner_id=artifact.uploaded_by,
                        mime_type=mime,
                        sha256=hashlib.sha256(encoded).hexdigest(),
                        size_bytes=len(encoded),
                        width=width,
                        height=height,
                        storage_key=key,
                    )
                )
                await session.commit()
        # Vision is explicitly server-configured, never a fallback fact generator.
        if settings.MATERIAL_VISION_ENABLED and not any(
            b.provenance.bbox == block.provenance.bbox
            and b.provenance.method == "ocr"
            and block_text(b).strip()
            for b in document.blocks
        ):
            result = await analyze_material_region(
                image,
                source_key=region_cache_key(data, block.provenance.page - 1, block.provenance.bbox),
                budget=budget,
            )
            block.warnings.extend(result.warnings)
            if result.text:
                provenance = block.provenance.model_copy(update={"method": "vision"})
                additions.append(
                    MaterialBlock(
                        id=block.id + "-vision",
                        type="paragraph",
                        inlines=[{"text": result.text}],
                        review_state="needs_review",
                        review_origin="extracted",
                        provenance=provenance,
                        warnings=result.warnings,
                    )
                )
    document.blocks.extend(additions)
    document = MaterialDocument.model_validate(document.model_dump(mode="json"))
    preview["document"] = document.model_dump(mode="json")
    preview["content"] = "\n\n".join(block_text(b) for b in document.blocks)


if __name__ == "__main__":
    asyncio.run(main())

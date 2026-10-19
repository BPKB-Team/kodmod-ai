"""SQL-owned queue: transactionally enqueue and fence every worker by its lease."""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, or_, select, update
from sqlalchemy.exc import IntegrityError

from config.settings import settings
from database.models import BackgroundJob
from database.session import async_session

ERROR = "Pemrosesan belum berhasil. Coba proses ulang atau pilih bagian dokumen yang lebih kecil."
CLAIMABLE_KINDS = ("material_import", "material_index", "document_index", "progress_plan")


async def enqueue(
    session,
    kind,
    target_id,
    payload,
    dedupe_key,
    *,
    retry=False,
    requeue_completed=False,
    max_attempts=3,
):
    row = await session.scalar(
        select(BackgroundJob).where(BackgroundJob.dedupe_key == dedupe_key).with_for_update()
    )
    if row is None:
        try:
            async with session.begin_nested():
                row = BackgroundJob(
                    kind=kind,
                    target_id=target_id,
                    payload=payload,
                    dedupe_key=dedupe_key,
                    max_attempts=max_attempts,
                )
                session.add(row)
                await session.flush()
        except IntegrityError:
            row = await session.scalar(
                select(BackgroundJob)
                .where(BackgroundJob.dedupe_key == dedupe_key)
                .with_for_update()
            )
    if (retry and row.state == "failed") or (requeue_completed and row.state == "complete"):
        row.state, row.attempts, row.error_message = "pending", 0, None
        row.result, row.lease_token, row.lease_expires_at = None, None, None
        row.available_at = datetime.now(UTC)
    return row


async def enqueue_material(session, material, *, retry=False):
    return await enqueue(
        session,
        "material_index",
        material.id,
        {"version": material.content_version, "mapping": material.mapping_version},
        f"material:{material.id}:{material.content_version}:{material.mapping_version}",
        retry=retry,
        requeue_completed=material.published and material.rag_status != "ready",
    )


async def claim(*, kinds=None):
    now = datetime.now(UTC)
    async with async_session() as session:
        await expire_exhausted(session, now, kinds=kinds)
        row = await session.scalar(
            select(BackgroundJob)
            .where(
                BackgroundJob.kind.in_(kinds if kinds is not None else CLAIMABLE_KINDS),
                BackgroundJob.attempts < BackgroundJob.max_attempts,
                or_(
                    and_(
                        BackgroundJob.state.in_(["pending", "retry"]),
                        BackgroundJob.available_at <= now,
                    ),
                    and_(BackgroundJob.state == "running", BackgroundJob.lease_expires_at <= now),
                ),
            )
            .order_by(BackgroundJob.available_at, BackgroundJob.created_at)
            .limit(1)
            .with_for_update(skip_locked=True)
        )
        if row is None:
            await session.commit()
            return None
        row.state, row.lease_token = "running", uuid.uuid4()
        row.lease_expires_at = now + timedelta(seconds=settings.JOB_LEASE_SECONDS)
        row.attempts += 1
        row.updated_at = now
        await session.commit()
        return row


def mark_target_error(target, row, status):
    if target is None:
        return
    if row.kind == "material_index":
        if (
            target.content_version == row.payload["version"]
            and target.mapping_version == row.payload["mapping"]
            and target.rag_status != "ready"
        ):
            target.rag_status, target.rag_error = status, ERROR
    elif row.kind == "document_index" and target.status != "ready":
        target.status, target.error_message = status, ERROR


async def expire_exhausted(session, now, *, kinds=None):
    """Update the visible target and receipt with the publisher's lock order."""
    exhausted = and_(
        BackgroundJob.state == "running",
        BackgroundJob.lease_expires_at <= now,
        BackgroundJob.attempts >= BackgroundJob.max_attempts,
    )
    candidates = (
        await session.scalars(
            select(BackgroundJob)
            .where(
                exhausted, BackgroundJob.kind.in_(kinds if kinds is not None else CLAIMABLE_KINDS)
            )
            .limit(50)
        )
    ).all()
    for candidate in candidates:
        target = None
        if candidate.kind in {"material_index", "document_index"}:
            from database.models import ClassMaterial, Document

            model = ClassMaterial if candidate.kind == "material_index" else Document
            if await session.get(model, candidate.target_id) is not None:
                target = await session.scalar(
                    select(model)
                    .where(model.id == candidate.target_id)
                    .with_for_update(skip_locked=True)
                    .execution_options(populate_existing=True)
                )
                if target is None:
                    continue
        row = await session.scalar(
            select(BackgroundJob)
            .where(BackgroundJob.id == candidate.id, exhausted)
            .with_for_update(skip_locked=True)
            .execution_options(populate_existing=True)
        )
        if row is None:
            continue
        mark_target_error(target, row, "failed")
        row.state, row.error_message = "failed", ERROR
        row.lease_token, row.lease_expires_at = None, None


def owned(job_id, token):
    return and_(
        BackgroundJob.id == job_id,
        BackgroundJob.state == "running",
        BackgroundJob.lease_token == token,
        BackgroundJob.lease_expires_at > datetime.now(UTC),
    )


async def assert_lease(session, job_id, token):
    if not await session.scalar(
        select(BackgroundJob.id).where(owned(job_id, token)).with_for_update()
    ):
        raise LeaseLostError()


class LeaseLostError(Exception):
    pass


async def heartbeat(job_id, token):
    async with async_session() as session:
        result = await session.execute(
            update(BackgroundJob)
            .where(owned(job_id, token))
            .values(
                lease_expires_at=datetime.now(UTC) + timedelta(seconds=settings.JOB_LEASE_SECONDS)
            )
        )
        await session.commit()
        return result.rowcount == 1


async def finish(job_id, token, *, result=None, require_ready=False):
    async with async_session() as session:
        if require_ready:
            from database.models import ClassMaterial

            candidate = await session.get(BackgroundJob, job_id)
            if candidate is None or candidate.kind != "material_index":
                return False
            # Match publication's target -> job lock order. A republish cannot
            # slip between a readiness check and receipt completion.
            target = await session.scalar(
                select(ClassMaterial)
                .where(ClassMaterial.id == candidate.target_id)
                .with_for_update()
            )
            if (
                target
                and target.published
                and (
                    target.content_version == candidate.payload["version"]
                    and target.mapping_version == candidate.payload["mapping"]
                )
                and target.rag_status != "ready"
            ):
                raise ValueError("Published material index is not ready")
        changed = await session.execute(
            update(BackgroundJob)
            .where(owned(job_id, token))
            .values(
                state="complete",
                result=result,
                error_message=None,
                lease_token=None,
                lease_expires_at=None,
            )
        )
        await session.commit()
        return changed.rowcount == 1


async def fail(job_id, token):
    async with async_session() as session:
        candidate = await session.get(BackgroundJob, job_id)
        target = None
        # Match the publisher's target -> job lock order.
        if candidate and candidate.kind in {"material_index", "document_index"}:
            from database.models import ClassMaterial, Document

            model = ClassMaterial if candidate.kind == "material_index" else Document
            target = await session.scalar(
                select(model).where(model.id == candidate.target_id).with_for_update()
            )
        row = await session.scalar(
            select(BackgroundJob).where(owned(job_id, token)).with_for_update()
        )
        if row is None:
            return False
        row.state = "failed" if row.attempts >= row.max_attempts else "retry"
        mark_target_error(target, row, "failed" if row.state == "failed" else "pending")
        row.available_at = datetime.now(UTC) + timedelta(seconds=min(300, 5 * 2**row.attempts))
        row.lease_token, row.lease_expires_at, row.error_message = None, None, ERROR
        await session.commit()
        return True

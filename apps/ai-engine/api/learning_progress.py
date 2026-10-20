"""Versioned coverage of the complete canonical material, never inferred mastery."""

import hashlib
import json
from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import select

from database.models import MaterialLearningProgress, User
from models.learning import LearningUnitManifest, UnitIdentity

PARTITIONER_VERSION = "blocks-v1"


def build_unit_manifest(
    material, units, *, partitioner_version=PARTITIONER_VERSION
) -> LearningUnitManifest:
    identities = [
        {
            "base_id": str(u.get("base_id") or index),
            "content_hash": hashlib.sha256(u["text"].encode()).hexdigest(),
        }
        for index, u in enumerate(units)
    ]
    digest = hashlib.sha256(
        json.dumps(
            {
                "content_version": material.content_version,
                "partitioner_version": partitioner_version,
                "units": identities,
            },
            sort_keys=True,
        ).encode()
    ).hexdigest()
    return LearningUnitManifest(
        content_version=material.content_version,
        partitioner_version=partitioner_version,
        unit_manifest_hash=digest,
        units=[UnitIdentity(**u, unit_id=f"{digest}:{u['base_id']}") for u in identities],
    )


def canonical_manifest(material):
    from api.learning_content import material_learning_units

    return build_unit_manifest(material, material_learning_units(material))


def learning_progress_out(
    row, *, content_version: int, unit_manifest_hash: str, total_units=0
) -> dict:
    current = (
        row is not None
        and row.content_version == content_version
        and row.unit_manifest_hash == unit_manifest_hash
    )
    return {
        "content_version": content_version,
        "unit_manifest_hash": unit_manifest_hash,
        "completed_units": len(row.completed_unit_ids) if current else 0,
        "total_units": row.total_units if current else total_units,
        "status": row.status if current else "not_started",
        "completed_at": row.completed_at.isoformat() if current and row.completed_at else None,
        "last_activity_at": row.last_activity_at.isoformat()
        if current and row.last_activity_at
        else None,
    }


async def active_learning_progress(session, student_id, material):
    if not material.content.strip():
        return learning_progress_out(
            None, content_version=material.content_version, unit_manifest_hash="", total_units=0
        )
    manifest = canonical_manifest(material)
    row = await session.scalar(
        select(MaterialLearningProgress).where(
            MaterialLearningProgress.student_id == student_id,
            MaterialLearningProgress.material_id == material.id,
            MaterialLearningProgress.content_version == material.content_version,
            MaterialLearningProgress.unit_manifest_hash == manifest.unit_manifest_hash,
        )
    )
    return learning_progress_out(
        row,
        content_version=material.content_version,
        unit_manifest_hash=manifest.unit_manifest_hash,
        total_units=len(manifest.units),
    )


async def record_learning_unit(
    session,
    *,
    student_id,
    material,
    manifest: LearningUnitManifest,
    completed_unit_id: str | None,
    finish: bool,
):
    expected = canonical_manifest(material)
    if manifest != expected or (
        completed_unit_id is not None
        and completed_unit_id not in {u.unit_id for u in expected.units}
    ):
        raise HTTPException(409, "Bagian materi berubah. Mulai sesi dari versi terbaru.")
    await session.scalar(select(User.id).where(User.id == student_id).with_for_update())
    row = await session.scalar(
        select(MaterialLearningProgress)
        .where(
            MaterialLearningProgress.student_id == student_id,
            MaterialLearningProgress.material_id == material.id,
            MaterialLearningProgress.content_version == material.content_version,
            MaterialLearningProgress.unit_manifest_hash == manifest.unit_manifest_hash,
        )
        .with_for_update()
    )
    completed = set(row.completed_unit_ids if row else []) | (
        {completed_unit_id} if completed_unit_id else set()
    )
    if finish and completed != {u.unit_id for u in expected.units}:
        raise HTTPException(409, "Selesaikan semua bagian materi sebelum menandai selesai.")
    if row is None:
        row = MaterialLearningProgress(
            student_id=student_id,
            material_id=material.id,
            content_version=material.content_version,
            unit_manifest_hash=manifest.unit_manifest_hash,
            total_units=len(manifest.units),
        )
        session.add(row)
    row.completed_unit_ids = [u.unit_id for u in expected.units if u.unit_id in completed]
    row.last_activity_at = datetime.now(UTC)
    if finish:
        row.status, row.completed_at = "completed", row.completed_at or datetime.now(UTC)
    await session.flush()
    return row

"""Audit legacy ready indexes and queue canonical rebuilding with --apply.

Run inside the configured backend environment. The default is read-only.
Source documents, content/mapping versions, accounts and progress are never edited.
The durable worker regenerates embeddings and provenance from accepted source blocks.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import uuid


def index_issue(material, chunks) -> str | None:
    """Compare stored evidence with the current canonical block document."""
    from api.learning_content import PARTITIONER_VERSION, material_learning_units

    units = material_learning_units(material)
    if not units:
        return "no_learning_content"
    if not chunks or len(chunks) != material.n_chunks:
        return "missing_chunks"
    digest = units[0]["document_hash"]
    accepted_ids = {block for unit in units for block in unit["block_ids"]}
    for chunk in chunks:
        if (
            chunk["content_version"] != material.content_version
            or chunk["mapping_version"] != material.mapping_version
        ):
            return "stale_versions"
        metadata = chunk.get("accessibility_metadata") or {}
        blocks, spans = metadata.get("block_ids"), metadata.get("spans")
        if not metadata.get("document_hash") or not blocks or not spans:
            return "incomplete_provenance"
        if metadata["document_hash"] != digest:
            return "stale_document"
        if metadata.get("partitioner_version") != PARTITIONER_VERSION:
            return "stale_partitioner"
        if not set(blocks) <= accepted_ids or any(
            not isinstance(span, dict) or span.get("block_id") not in blocks for span in spans
        ):
            return "invalid_block_spans"
    return None


async def audit(*, apply=False, material_id=None):
    from sqlalchemy import select

    from api.durable_jobs import enqueue_material
    from database.models import ClassMaterial, Classroom, CurriculumChunk
    from database.session import async_session, close_db, init_db

    await init_db()
    report = []
    try:
        async with async_session() as session:
            query = (
                select(ClassMaterial)
                .join(Classroom, ClassMaterial.class_id == Classroom.id)
                .where(
                    ClassMaterial.published.is_(True),
                    ClassMaterial.rag_status == "ready",
                    Classroom.is_archived.is_(False),
                )
                .order_by(ClassMaterial.id)
            )
            if material_id:
                query = query.where(ClassMaterial.id == material_id)
            if apply:
                query = query.with_for_update(of=ClassMaterial)
            for material in (await session.scalars(query)).all():
                rows = (
                    (
                        await session.execute(
                            select(
                                CurriculumChunk.material_version.label("content_version"),
                                CurriculumChunk.material_mapping_version.label("mapping_version"),
                                CurriculumChunk.accessibility_metadata,
                            ).where(
                                CurriculumChunk.material_id == material.id,
                                CurriculumChunk.material_version == material.content_version,
                                CurriculumChunk.material_mapping_version
                                == material.mapping_version,
                            )
                        )
                    )
                    .mappings()
                    .all()
                )
                issue = index_issue(material, rows)
                action = "healthy" if issue is None else "needs_reindex"
                if apply and issue and issue != "no_learning_content":
                    material.rag_status, material.rag_error = "pending", None
                    await enqueue_material(session, material, retry=True)
                    action = "queued"
                report.append(
                    {
                        "material_id": str(material.id),
                        "title": material.title,
                        "issue": issue,
                        "action": action,
                    }
                )
            if apply:
                await session.commit()
            else:
                await session.rollback()
        return report
    finally:
        await close_db()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply", action="store_true", help="Queue stale ready indexes for rebuilding"
    )
    parser.add_argument("--material-id", type=uuid.UUID, help="Audit or repair one material only")
    args = parser.parse_args()
    report = asyncio.run(audit(apply=args.apply, material_id=args.material_id))
    print(json.dumps({"apply": args.apply, "materials": report}, ensure_ascii=False))


if __name__ == "__main__":
    main()

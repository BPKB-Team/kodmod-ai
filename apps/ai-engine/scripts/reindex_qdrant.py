"""Copy canonical PostgreSQL vectors into Qdrant without embedding or deleting."""

from __future__ import annotations

import argparse
import asyncio
import logging
import uuid

from sqlalchemy import Text, and_, func, or_, select

from database.models import ClassMaterial, Classroom, CurriculumChunk
from database.session import async_session, close_db, init_db
from rag.stores.qdrant_store import close_client, ensure_collection, upsert_points

logger = logging.getLogger(__name__)


async def reindex(batch_size: int = 256) -> int:
    """Upsert current global and published class vectors, preserving point IDs."""
    if batch_size < 1:
        raise ValueError("batch_size must be greater than zero")
    await init_db()
    indexed = 0
    last_id: uuid.UUID | None = None
    try:
        await ensure_collection()
        while True:
            stmt = (
                select(
                    CurriculumChunk.id,
                    CurriculumChunk.embedding,
                    CurriculumChunk.concept_id,
                    CurriculumChunk.subject_id,
                    CurriculumChunk.language,
                    CurriculumChunk.material_id,
                    CurriculumChunk.material_version,
                    CurriculumChunk.material_mapping_version,
                    func.md5(CurriculumChunk.embedding.cast(Text)).label("vector_hash"),
                    ClassMaterial.class_id,
                )
                .outerjoin(ClassMaterial, CurriculumChunk.material_id == ClassMaterial.id)
                .outerjoin(Classroom, ClassMaterial.class_id == Classroom.id)
                .where(
                    or_(
                        CurriculumChunk.material_id.is_(None),
                        and_(
                            ClassMaterial.published.is_(True),
                            ClassMaterial.rag_status == "ready",
                            ClassMaterial.indexed_version == ClassMaterial.content_version,
                            ClassMaterial.indexed_mapping_version == ClassMaterial.mapping_version,
                            CurriculumChunk.material_version == ClassMaterial.content_version,
                            CurriculumChunk.material_mapping_version
                            == ClassMaterial.mapping_version,
                            Classroom.is_archived.is_(False),
                        ),
                    )
                )
                .order_by(CurriculumChunk.id)
                .limit(batch_size)
            )
            if last_id is not None:
                stmt = stmt.where(CurriculumChunk.id > last_id)
            async with async_session() as session:
                rows = (await session.execute(stmt)).mappings().all()
            if not rows:
                break
            points = []
            for row in rows:
                is_class = row["material_id"] is not None
                points.append(
                    {
                        "id": str(row["id"]),
                        "embedding": row["embedding"],
                        "scope": "class" if is_class else "global",
                        "class_id": str(row["class_id"]) if is_class else None,
                        "material_id": str(row["material_id"]) if is_class else None,
                        "material_version": row["material_version"],
                        "material_mapping_version": row["material_mapping_version"],
                        "concept_id": str(row["concept_id"]) if row["concept_id"] else None,
                        "subject_id": str(row["subject_id"]) if row["subject_id"] else None,
                        "language": row["language"],
                        "vector_hash": row["vector_hash"],
                    }
                )
            await upsert_points(points)
            indexed += len(points)
            last_id = rows[-1]["id"]
            logger.info("Indexed %d canonical vectors into Qdrant", indexed)
    finally:
        await close_client()
        await close_db()
    return indexed


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--batch-size", type=int, default=256)
    args = parser.parse_args()
    count = asyncio.run(reindex(args.batch_size))
    print(f"Upserted {count} current PostgreSQL vectors into Qdrant.")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    main()

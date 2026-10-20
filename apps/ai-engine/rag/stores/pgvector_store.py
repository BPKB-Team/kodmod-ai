"""
KODMOD AI - pgvector Store
==========================

Backs curriculum retrieval and versioned classroom material retrieval against
the Alembic-managed curriculum_chunks table. Classroom chunks always require
current enrollment, publication, active class, and the current indexed revision.
"""

from __future__ import annotations

import logging
import uuid
from pathlib import PurePosixPath

from sqlalchemy import Text, delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from config.settings import settings
from database.models import ClassMaterial, Classroom, CurriculumChunk, Enrollment, MaterialConcept
from database.session import async_session

logger = logging.getLogger(__name__)


def _vec_literal(vec: list[float]) -> str:
    """Format a Python list as a pgvector literal."""
    return "[" + ",".join(f"{x:.7f}" for x in vec) + "]"


async def upsert_chunks(records: list[dict]) -> int:
    """
    Insert (or replace) chunk rows.
    Each record must have:
      id (str/uuid), text, embedding (list[float]), source, language,
      concept_id (uuid|None), subject_id (uuid|None), document_id (uuid|None),
      chunk_index, accessibility_metadata (dict)
    """
    if not records:
        return 0
    prepared = []
    for record in records:
        item = dict(record)
        item["id"] = str(item.get("id") or uuid.uuid4())
        prepared.append(item)
    sql = text("""
        INSERT INTO curriculum_chunks
          (id, content, embedding, source, language, concept_id, subject_id,
           document_id, chunk_index, section_title, accessibility_metadata, created_at)
        VALUES
          (:id, :content, CAST(:embedding AS vector), :source, :language, :concept_id,
           :subject_id, :document_id, :chunk_index, :section_title, CAST(:meta AS jsonb), NOW())
        ON CONFLICT (id) DO UPDATE SET
          content = EXCLUDED.content,
          embedding = EXCLUDED.embedding,
          source = EXCLUDED.source,
          language = EXCLUDED.language,
          concept_id = EXCLUDED.concept_id,
          subject_id = EXCLUDED.subject_id,
          document_id = EXCLUDED.document_id,
          chunk_index = EXCLUDED.chunk_index,
          section_title = EXCLUDED.section_title,
          accessibility_metadata = EXCLUDED.accessibility_metadata,
          created_at = NOW();
    """)
    n = 0
    canonical_vectors: dict[str, tuple[list[float], str]] = {}
    async with async_session() as session:
        for r in prepared:
            await session.execute(
                sql,
                {
                    "id": r.get("id") or str(uuid.uuid4()),
                    "content": r["text"],
                    "embedding": _vec_literal(r["embedding"]),
                    "source": r.get("source", ""),
                    "language": r.get("language", "id"),
                    "concept_id": r.get("concept_id"),
                    "subject_id": r.get("subject_id"),
                    "document_id": r.get("document_id"),
                    "chunk_index": r.get("chunk_index", 0),
                    "section_title": r.get("section_title"),
                    "meta": __import__("json").dumps(r.get("accessibility_metadata", {})),
                },
            )
            n += 1
        if settings.VECTOR_BACKEND == "qdrant":
            ids = [uuid.UUID(r["id"]) for r in prepared]
            hash_rows = (
                await session.execute(
                    select(
                        CurriculumChunk.id,
                        CurriculumChunk.embedding,
                        func.md5(CurriculumChunk.embedding.cast(Text)).label("vector_hash"),
                    ).where(CurriculumChunk.id.in_(ids))
                )
            ).all()
            canonical_vectors = {str(row.id): (row.embedding, row.vector_hash) for row in hash_rows}
    if settings.VECTOR_BACKEND == "qdrant":
        try:
            from rag.stores.qdrant_store import upsert_points

            await upsert_points(
                [
                    {
                        **record,
                        "scope": "global",
                        "embedding": canonical_vectors[record["id"]][0],
                        "vector_hash": canonical_vectors[record["id"]][1],
                    }
                    for record in prepared
                ]
            )
        except Exception:
            logger.exception("Qdrant mirror upsert failed; PostgreSQL remains authoritative")
    logger.info("Upserted %d chunks into curriculum_chunks", n)
    return n


async def replace_material_chunks(
    session: AsyncSession,
    material_id: uuid.UUID,
    version: int,
    records: list[dict],
    *,
    class_id: uuid.UUID | None = None,
    mapping_version: int = 0,
) -> tuple[list[str], list[dict]]:
    """Replace a material's chunks inside the caller's locked transaction."""
    mirror_qdrant = settings.VECTOR_BACKEND == "qdrant"
    old_ids = []
    if mirror_qdrant:
        old_ids = [
            str(chunk_id)
            for chunk_id in await session.scalars(
                select(CurriculumChunk.id).where(CurriculumChunk.material_id == material_id)
            )
        ]
        if class_id is None:
            material = await session.get(ClassMaterial, material_id)
            class_id = material.class_id if material else None
    prepared = []
    for record in records:
        item = dict(record)
        item["id"] = str(item.get("id") or uuid.uuid4())
        prepared.append(item)
    await session.execute(delete(CurriculumChunk).where(CurriculumChunk.material_id == material_id))
    session.add_all(
        [
            CurriculumChunk(
                id=uuid.UUID(record["id"]),
                material_id=material_id,
                material_version=version,
                material_mapping_version=record.get("material_mapping_version", mapping_version),
                content=record["text"],
                embedding=record["embedding"],
                source=record["source"],
                language=record.get("language", "id"),
                chunk_index=record["chunk_index"],
                section_title=record.get("section_title"),
                accessibility_metadata=record.get("accessibility_metadata", {}),
            )
            for record in prepared
        ]
    )
    await session.flush()
    ids = [uuid.UUID(record["id"]) for record in prepared]
    canonical_vectors = {}
    if mirror_qdrant and ids:
        hash_rows = (
            await session.execute(
                select(
                    CurriculumChunk.id,
                    CurriculumChunk.embedding,
                    func.md5(CurriculumChunk.embedding.cast(Text)).label("vector_hash"),
                ).where(CurriculumChunk.id.in_(ids))
            )
        ).all()
        canonical_vectors = {str(row.id): (row.embedding, row.vector_hash) for row in hash_rows}
    points = []
    if mirror_qdrant:
        points = [
            {
                "id": record["id"],
                "embedding": canonical_vectors[record["id"]][0],
                "scope": "class",
                "class_id": str(class_id) if class_id else None,
                "material_id": str(material_id),
                "material_version": version,
                "material_mapping_version": record.get("material_mapping_version", mapping_version),
                "language": record.get("language", "id"),
                "vector_hash": canonical_vectors[record["id"]][1],
            }
            for record in prepared
        ]
    return old_ids, points


async def query(
    embedding: list[float],
    *,
    top_k: int = 8,
    concept_id: uuid.UUID | None = None,
    subject_id: uuid.UUID | None = None,
    language: str | None = None,
    student_id: uuid.UUID | None = None,
    class_id: uuid.UUID | None = None,
    material_id: uuid.UUID | None = None,
    content_version: int | None = None,
    mapping_version: int | None = None,
    candidate_ids: list[uuid.UUID] | None = None,
    include_vector_hash: bool = False,
) -> list[dict]:
    """Cosine search; shared curriculum queries never include class materials."""
    if not candidate_ids and candidate_ids is not None:
        return []
    if (class_id and not student_id) or (material_id and not class_id):
        return []
    distance = CurriculumChunk.embedding.cosine_distance(embedding)
    source = (
        func.coalesce(ClassMaterial.source_filename, ClassMaterial.title)
        if class_id
        else CurriculumChunk.source
    )
    stmt = select(
        CurriculumChunk.id,
        CurriculumChunk.content.label("text"),
        source.label("source"),
        CurriculumChunk.section_title,
        CurriculumChunk.accessibility_metadata,
        CurriculumChunk.concept_id,
        CurriculumChunk.material_id,
        CurriculumChunk.material_version.label("content_version"),
        CurriculumChunk.material_mapping_version.label("mapping_version"),
        (1 - distance).label("score"),
    )
    if include_vector_hash:
        stmt = stmt.add_columns(
            func.md5(CurriculumChunk.embedding.cast(Text)).label("_vector_hash")
        )
    if class_id:
        stmt = (
            stmt.add_columns(
                Classroom.id.label("class_id"), ClassMaterial.title.label("material_title")
            )
            .join(ClassMaterial, CurriculumChunk.material_id == ClassMaterial.id)
            .join(Classroom, ClassMaterial.class_id == Classroom.id)
            .join(Enrollment, Enrollment.class_id == Classroom.id)
            .where(
                Classroom.id == class_id,
                Classroom.is_archived.is_(False),
                Enrollment.student_id == student_id,
                ClassMaterial.published.is_(True),
                ClassMaterial.rag_status == "ready",
                ClassMaterial.indexed_version == ClassMaterial.content_version,
                ClassMaterial.indexed_mapping_version == ClassMaterial.mapping_version,
                CurriculumChunk.material_version == ClassMaterial.content_version,
                CurriculumChunk.material_mapping_version == ClassMaterial.mapping_version,
            )
        )
        if material_id:
            stmt = stmt.where(ClassMaterial.id == material_id)
        if subject_id:
            stmt = stmt.where(Classroom.subject_id == subject_id)
        if concept_id:
            approved_mapping = select(MaterialConcept.material_id).where(
                MaterialConcept.material_id == ClassMaterial.id,
                MaterialConcept.concept_id == concept_id,
                MaterialConcept.mapping_version == ClassMaterial.mapping_version,
                MaterialConcept.content_version == ClassMaterial.content_version,
            )
            stmt = stmt.where(ClassMaterial.id.in_(approved_mapping))
        if content_version is not None:
            stmt = stmt.where(ClassMaterial.content_version == content_version)
        if mapping_version is not None:
            stmt = stmt.where(ClassMaterial.mapping_version == mapping_version)
    else:
        stmt = stmt.where(CurriculumChunk.material_id.is_(None))
        if concept_id:
            stmt = stmt.where(CurriculumChunk.concept_id == concept_id)
        if subject_id:
            stmt = stmt.where(CurriculumChunk.subject_id == subject_id)
        if content_version is not None or mapping_version is not None:
            return []
    if language:
        stmt = stmt.where(CurriculumChunk.language == language)
    if candidate_ids is not None:
        stmt = stmt.where(CurriculumChunk.id.in_(candidate_ids))
    stmt = stmt.order_by(distance).limit(top_k)
    async with async_session() as session:
        rows = (await session.execute(stmt)).mappings().all()
    docs = []
    for row in rows:
        doc = dict(row)
        for key in ("id", "concept_id", "class_id", "material_id"):
            if key in doc and doc[key] is not None:
                doc[key] = str(doc[key])
        doc["source"] = PurePosixPath((doc.get("source") or "Materi").replace("\\", "/")).name
        doc["concept_ids"] = (
            doc["accessibility_metadata"].get("approved_concept_ids", [])
            if class_id
            else [doc["concept_id"]]
            if doc.get("concept_id")
            else []
        )
        metadata = doc.get("accessibility_metadata") or {}
        doc["block_ids"] = metadata.get("block_ids", [])
        doc["spans"] = metadata.get("spans", [])
        doc["document_hash"] = metadata.get("document_hash")
        doc["approved_concept_ids"] = metadata.get("approved_concept_ids", [])
        docs.append(doc)
    return docs


async def delete_by_source(source: str) -> int:
    ids: list[str] = []
    async with async_session() as session:
        ids = [
            str(chunk_id)
            for chunk_id in await session.scalars(
                select(CurriculumChunk.id).where(CurriculumChunk.source == source)
            )
        ]
        await session.execute(delete(CurriculumChunk).where(CurriculumChunk.source == source))
    await _mirror_delete_ids(ids)
    return len(ids)


async def delete_by_document(document_id: uuid.UUID | str) -> int:
    """Remove every chunk produced by one uploaded document."""
    document_uuid = uuid.UUID(str(document_id))
    ids: list[str] = []
    async with async_session() as session:
        ids = [
            str(chunk_id)
            for chunk_id in await session.scalars(
                select(CurriculumChunk.id).where(CurriculumChunk.document_id == document_uuid)
            )
        ]
        await session.execute(
            delete(CurriculumChunk).where(CurriculumChunk.document_id == document_uuid)
        )
    await _mirror_delete_ids(ids)
    return len(ids)


async def _mirror_delete_ids(ids: list[str]) -> None:
    if not ids or settings.VECTOR_BACKEND != "qdrant":
        return
    try:
        from rag.stores.qdrant_store import delete_points

        await delete_points(ids)
    except Exception:
        logger.exception("Qdrant mirror delete failed; PostgreSQL remains authoritative")


class PgVectorStore:
    """Thin object wrapper over the module-level functions above.

    ``RAGTool`` (and other callers) expect a store object exposing
    ``similarity_search``. New code should call the module functions directly.
    """

    async def similarity_search(
        self,
        *,
        embedding: list[float],
        top_k: int = 8,
        filters: dict | None = None,
    ) -> list[dict]:
        filters = filters or {}
        class_id = _coerce_uuid(filters.get("class_id"))
        material_id = _coerce_uuid(filters.get("material_id"))
        student_id = _coerce_uuid(filters.get("student_id"))
        if (filters.get("class_id") or filters.get("material_id")) and (
            not class_id or not student_id or (filters.get("material_id") and not material_id)
        ):
            return []
        return await query(
            embedding,
            top_k=top_k,
            concept_id=_coerce_uuid(filters.get("concept_id")),
            subject_id=_coerce_uuid(filters.get("subject_id")),
            language=filters.get("language"),
            student_id=student_id,
            class_id=class_id,
            material_id=material_id,
        )

    async def upsert_chunks(self, records: list[dict]) -> int:
        return await upsert_chunks(records)

    async def delete_by_source(self, source: str) -> int:
        return await delete_by_source(source)


def _coerce_uuid(value) -> uuid.UUID | None:
    """Accept a UUID, a string, or None; return None for anything unparseable."""
    if not value:
        return None
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError):
        return None

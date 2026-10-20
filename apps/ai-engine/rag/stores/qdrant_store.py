"""Qdrant candidate retrieval with PostgreSQL authorization and content reads."""

from __future__ import annotations

import asyncio
import logging
import uuid

from config.settings import settings

logger = logging.getLogger(__name__)

_client_instance = None
_client_lock = asyncio.Lock()
_client_retry_at = 0.0


async def _client():
    """Lazily connect to Qdrant and prepare the versioned collection."""
    global _client_instance, _client_retry_at
    if _client_instance is None:
        loop = asyncio.get_running_loop()
        if loop.time() < _client_retry_at:
            raise ConnectionError("Qdrant initialization is cooling down")
        async with _client_lock:
            if _client_instance is None:
                # Waiters share the failed probe instead of each paying another timeout.
                if loop.time() < _client_retry_at:
                    raise ConnectionError("Qdrant initialization is cooling down")
                from qdrant_client import AsyncQdrantClient

                client = AsyncQdrantClient(
                    url=settings.QDRANT_URL,
                    api_key=settings.QDRANT_API_KEY,
                    timeout=settings.QDRANT_TIMEOUT_SECONDS,
                )
                try:
                    async with asyncio.timeout(settings.QDRANT_TIMEOUT_SECONDS):
                        await ensure_collection(client)
                except (Exception, asyncio.CancelledError):
                    _client_retry_at = loop.time() + settings.QDRANT_TIMEOUT_SECONDS
                    await client.close()
                    raise
                _client_instance = client
                _client_retry_at = 0.0
    return _client_instance


async def ensure_collection(client=None) -> None:
    """Create the collection and filter indexes without deleting existing data."""
    from qdrant_client.http.models import Distance, PayloadSchemaType, VectorParams

    if client is None:
        await _client()
        return
    exists = await client.collection_exists(collection_name=settings.QDRANT_COLLECTION)
    if not exists:
        try:
            await client.create_collection(
                collection_name=settings.QDRANT_COLLECTION,
                vectors_config=VectorParams(
                    size=settings.EMBEDDING_DIM,
                    distance=Distance.COSINE,
                ),
            )
        except Exception:
            # Another API worker may have created it between the check and create.
            if not await client.collection_exists(collection_name=settings.QDRANT_COLLECTION):
                raise
            logger.info(
                "Qdrant collection %s was created by another worker", settings.QDRANT_COLLECTION
            )
    for field in ("scope", "class_id", "material_id", "concept_id", "subject_id", "language"):
        try:
            await client.create_payload_index(
                collection_name=settings.QDRANT_COLLECTION,
                field_name=field,
                field_schema=PayloadSchemaType.KEYWORD,
            )
        except Exception:
            # Existing indexes are harmless; retrieval can still fall back to PostgreSQL.
            logger.debug("Qdrant payload index %s already exists or could not be created", field)


async def close_client() -> None:
    """Close the process-wide async client during application shutdown."""
    global _client_instance, _client_retry_at
    client, _client_instance = _client_instance, None
    _client_retry_at = 0.0
    if client is not None:
        await client.close()


def _payload(record: dict) -> dict:
    """Keep only routing and freshness metadata in Qdrant; content stays in PostgreSQL."""
    payload = {
        "scope": record.get("scope", "global"),
        "vector_hash": record.get("vector_hash"),
    }
    for key in (
        "class_id",
        "material_id",
        "material_version",
        "material_mapping_version",
        "concept_id",
        "subject_id",
        "language",
    ):
        value = record.get(key)
        if value is not None:
            payload[key] = str(value) if key.endswith("_id") else value
    return payload


async def upsert_points(records: list[dict]) -> int:
    """Mirror vectors and safe filters after their canonical PostgreSQL commit."""
    if not records:
        return 0
    from qdrant_client.http.models import PointStruct

    client = await _client()
    points = [
        PointStruct(
            id=str(record["id"]),
            vector=record["embedding"],
            payload=_payload(record),
        )
        for record in records
    ]
    await client.upsert(
        collection_name=settings.QDRANT_COLLECTION,
        points=points,
        wait=True,
    )
    return len(points)


async def delete_points(ids: list[str]) -> int:
    """Delete known point IDs; Qdrant is never asked to delete by source metadata."""
    if not ids:
        return 0
    from qdrant_client.http.models import PointIdsList

    client = await _client()
    await client.delete(
        collection_name=settings.QDRANT_COLLECTION,
        points_selector=PointIdsList(points=[str(point_id) for point_id in ids]),
        wait=True,
    )
    return len(ids)


async def sync_material_replacement(old_ids: list[str], points: list[dict]) -> None:
    """Mirror a committed material replacement without affecting its DB status."""
    if settings.VECTOR_BACKEND != "qdrant":
        return
    try:
        await delete_points(old_ids)
        await upsert_points(points)
    except Exception:
        logger.exception("Qdrant material sync failed; PostgreSQL remains authoritative")


async def _postgres_query(
    embedding: list[float],
    *,
    top_k: int,
    concept_id: uuid.UUID | None,
    subject_id: uuid.UUID | None,
    language: str | None,
    student_id: uuid.UUID | None,
    class_id: uuid.UUID | None,
    material_id: uuid.UUID | None,
    content_version: int | None = None,
    mapping_version: int | None = None,
    candidate_ids: list[uuid.UUID] | None = None,
    include_vector_hash: bool = False,
) -> list[dict]:
    from rag.stores import pgvector_store

    filters: pgvector_store.PostgresQueryFilters = {
        "top_k": top_k,
        "concept_id": concept_id,
        "subject_id": subject_id,
        "language": language,
        "student_id": student_id,
        "class_id": class_id,
        "material_id": material_id,
    }
    if content_version is not None:
        filters["content_version"] = content_version
    if mapping_version is not None:
        filters["mapping_version"] = mapping_version
    if candidate_ids is not None:
        filters["candidate_ids"] = candidate_ids
    if include_vector_hash:
        filters["include_vector_hash"] = True
    return await pgvector_store.query(embedding, **filters)


async def query_with_trace(
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
) -> tuple[list[dict], dict]:
    """Return SQL-authorized documents and diagnose candidate fallback decisions."""
    if (class_id and not student_id) or (material_id and not class_id):
        return [], {
            "candidate_count": 0,
            "hydrated_count": 0,
            "fallback_reason": "invalid_scope",
        }

    async def postgres_fallback() -> list[dict]:
        return await _postgres_query(
            embedding,
            top_k=top_k,
            concept_id=concept_id,
            subject_id=subject_id,
            language=language,
            student_id=student_id,
            class_id=class_id,
            material_id=material_id,
            content_version=content_version,
            mapping_version=mapping_version,
        )

    try:
        from qdrant_client.http.models import Condition, FieldCondition, Filter, MatchValue

        client = await _client()
        must: list[Condition] = [
            FieldCondition(
                key="scope",
                match=MatchValue(value="class" if class_id else "global"),
            )
        ]
        qdrant_filters: list[tuple[str, uuid.UUID | str | None]] = [
            ("class_id", class_id),
            ("material_id", material_id),
        ]
        if not class_id:
            qdrant_filters.extend(
                [("concept_id", concept_id), ("subject_id", subject_id), ("language", language)]
            )
        for key, value in qdrant_filters:
            if value is not None:
                must.append(FieldCondition(key=key, match=MatchValue(value=str(value))))
        result = await client.query_points(
            collection_name=settings.QDRANT_COLLECTION,
            query=embedding,
            query_filter=Filter(must=must),
            limit=top_k,
            with_payload=["vector_hash"],
            with_vectors=False,
        )
        points = result.points
        ids: list[uuid.UUID] = []
        qdrant_hashes: dict[str, str | None] = {}
        for point in points:
            try:
                point_id = str(uuid.UUID(str(point.id)))
            except (ValueError, TypeError, AttributeError):
                continue
            ids.append(uuid.UUID(point_id))
            qdrant_hashes[point_id] = (point.payload or {}).get("vector_hash")
        if not ids:
            fallback = await postgres_fallback()
            return fallback, {
                "candidate_count": len(points),
                "hydrated_count": len(fallback),
                "fallback_reason": "qdrant_empty",
            }

        from rag.stores import pgvector_store

        docs = await pgvector_store.query(
            embedding,
            top_k=top_k,
            concept_id=concept_id,
            subject_id=subject_id,
            language=language,
            student_id=student_id,
            class_id=class_id,
            material_id=material_id,
            content_version=content_version,
            mapping_version=mapping_version,
            candidate_ids=ids,
            include_vector_hash=True,
        )
        stale = any(
            not doc.get("_vector_hash")
            or doc.get("_vector_hash") != qdrant_hashes.get(str(doc["id"]))
            for doc in docs
        )
        hydrated_count = len(docs)
        if stale:
            fallback = await postgres_fallback()
            return fallback, {
                "candidate_count": len(points),
                "hydrated_count": len(fallback),
                "fallback_reason": "stale_vector",
            }

        reason = None
        effective_budget = min(top_k, len(points))
        if len(points) < top_k or len(docs) < effective_budget:
            # Check the authorized SQL inventory before labelling a short vector
            # page as missing data. Small classes often contain fewer than top_k.
            available = await postgres_fallback()
            hydrated_ids = {str(doc["id"]) for doc in docs}
            available_ids = {str(doc["id"]) for doc in available}
            if available_ids - hydrated_ids:
                docs = available
                hydrated_count = len(available)
                reason = "insufficient_authorized_candidates"
            elif len(docs) < len(points):
                reason = "insufficient_authorized"
        for doc in docs:
            doc.pop("_vector_hash", None)
        return docs, {
            "candidate_count": len(points),
            "hydrated_count": hydrated_count,
            "fallback_reason": reason,
        }
    except Exception:
        logger.warning("Qdrant retrieval failed; falling back to PostgreSQL", exc_info=True)
        fallback = await postgres_fallback()
        return fallback, {
            "candidate_count": 0,
            "hydrated_count": len(fallback),
            "fallback_reason": "qdrant_unavailable",
        }


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
) -> list[dict]:
    """Compatibility list facade; new orchestration also consumes its trace."""
    docs, _ = await query_with_trace(
        embedding,
        top_k=top_k,
        concept_id=concept_id,
        subject_id=subject_id,
        language=language,
        student_id=student_id,
        class_id=class_id,
        material_id=material_id,
        content_version=content_version,
        mapping_version=mapping_version,
    )
    return docs


class QdrantVectorStore:
    """Object adapter used by RAGTool when Qdrant is the selected backend."""

    async def similarity_search(
        self,
        *,
        embedding: list[float],
        top_k: int = 8,
        filters: dict | None = None,
    ) -> list[dict]:
        from rag.stores.pgvector_store import _coerce_uuid

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
        from rag.stores.pgvector_store import upsert_chunks as postgres_upsert

        return await postgres_upsert(records)

    async def delete_by_source(self, source: str) -> int:
        from rag.stores.pgvector_store import delete_by_source as postgres_delete

        return await postgres_delete(source)

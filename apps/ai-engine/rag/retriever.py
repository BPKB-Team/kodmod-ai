"""Legacy list-shaped facade over the shared authorized retrieval service."""

from __future__ import annotations

import logging
import uuid
from dataclasses import asdict
from typing import TypedDict

from fastapi import HTTPException

from config.settings import settings
from rag.retrieval_service import RetrievalRequest, retrieve_sources
from rag.source_bundle import MaterialScope

logger = logging.getLogger(__name__)


class QueryFilters(TypedDict, total=False):
    top_k: int
    concept_id: uuid.UUID | None
    subject_id: uuid.UUID | None
    language: str | None
    student_id: uuid.UUID | None
    class_id: uuid.UUID | None
    material_id: uuid.UUID | None
    content_version: int | None
    mapping_version: int | None


async def retrieve_result(
    query: str,
    *,
    concept_id: uuid.UUID | None = None,
    subject_id: uuid.UUID | None = None,
    student_id: uuid.UUID | None = None,
    class_id: uuid.UUID | None = None,
    material_id: uuid.UUID | None = None,
    content_version: int | None = None,
    mapping_version: int | None = None,
    language: str | None = None,
    top_k: int | None = None,
    rerank_top_k: int | None = None,
    use_reranker: bool | None = None,
):
    candidate_k = top_k or settings.RAG_TOP_K
    final_k = min(candidate_k, rerank_top_k or settings.RAG_RERANK_TOP_K)
    request = RetrievalRequest(
        query=query,
        scope=MaterialScope(
            student_id=student_id,
            class_id=class_id,
            material_id=material_id,
            concept_id=concept_id,
            subject_id=subject_id,
            content_version=content_version,
            mapping_version=mapping_version,
            language=language,
        ),
        candidate_k=candidate_k,
        final_k=final_k,
        use_reranker=use_reranker,
    )
    try:
        result = await retrieve_sources(request)
    except ValueError as error:
        if class_id or material_id:
            raise HTTPException(
                409,
                "Pilih materi atau konsep yang disetujui guru sebelum mencari sumber kelas.",
            ) from error
        raise
    if not result.documents and (class_id or material_id):
        raise HTTPException(
            409,
            "Materi kelas berubah atau belum siap. Buka kembali materi atau minta guru memproses indeks AI.",
        )
    return result


async def retrieve(query: str, **filters) -> list[dict]:
    """Return ranked PostgreSQL-hydrated chunks for existing list consumers."""
    if not query.strip():
        return []
    return (await retrieve_result(query, **filters)).documents


async def rag_retrieval_node(state) -> dict:
    """Retrieve current sources for the graph and keep a compact diagnostic trace."""
    query = state.get("user_input") or ""
    if not query and state.get("messages"):
        for message in reversed(state["messages"]):
            try:
                role = getattr(message, "type", None) or getattr(message, "role", None)
                if role in {"human", "user"}:
                    query = getattr(message, "content", "") or ""
                    break
            except Exception:  # noqa: S112
                continue
    if not query.strip():
        return {
            "retrieved_docs": [],
            "retrieval_trace": None,
            "next_action": "tutor",
            "last_node": "rag_retrieval",
        }

    filters = {
        "concept_id": _as_uuid(state.get("current_concept_id")),
        "subject_id": _as_uuid(state.get("subject_id")),
        "language": state.get("learning_profile", {}).get("language"),
    }
    if state.get("class_id") or state.get("material_id"):
        class_id = _as_uuid(state.get("class_id"))
        student_id = _as_uuid(state.get("student_id"))
        material_id = _as_uuid(state.get("material_id"))
        if not class_id or not student_id or (state.get("material_id") and not material_id):
            raise HTTPException(
                409, "Konteks materi tidak valid. Mulai sesi dari materi yang dapat Anda akses."
            )
        filters.update(student_id=student_id, class_id=class_id, material_id=material_id)
    result = await retrieve_result(query, **filters)
    docs = result.documents
    logger.info("RAG retrieved %d chunks for query=%r", len(docs), query[:64])
    updates = {
        "retrieved_docs": docs,
        "retrieval_trace": asdict(result.trace),
        "next_action": "tutor",
        "last_node": "rag_retrieval",
    }
    if not state.get("current_concept_id"):
        concept = next((doc.get("concept_id") for doc in docs if doc.get("concept_id")), None)
        if concept:
            updates["current_concept_id"] = str(concept)
    return updates


def _as_uuid(value) -> uuid.UUID | None:
    if not value:
        return None
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        return None

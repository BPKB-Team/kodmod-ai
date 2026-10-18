"""
KODMOD AI - RAG Retriever (orchestration layer)
===============================================

Single entry point used by `tools/rag_tool.py` and the LangGraph
`rag_retrieval_node`. Embeds the query, performs the pgvector search, and runs
the cross-encoder reranker.

This module is intentionally thin - it composes:
    embeddings.embed_text + vector-store query + reranker.rerank
"""

from __future__ import annotations

import logging
import uuid
from typing import TypedDict

from fastapi import HTTPException

from config.settings import settings
from rag.embeddings import embed_text
from rag.reranker import rerank
from rag.stores import pgvector_store

logger = logging.getLogger(__name__)


class QueryFilters(TypedDict, total=False):
    top_k: int
    concept_id: uuid.UUID | None
    subject_id: uuid.UUID | None
    language: str | None
    student_id: uuid.UUID | None
    class_id: uuid.UUID | None
    material_id: uuid.UUID | None


async def retrieve(
    query: str,
    *,
    concept_id: uuid.UUID | None = None,
    subject_id: uuid.UUID | None = None,
    student_id: uuid.UUID | None = None,
    class_id: uuid.UUID | None = None,
    material_id: uuid.UUID | None = None,
    language: str | None = None,
    top_k: int | None = None,
    rerank_top_k: int | None = None,
    use_reranker: bool | None = None,
) -> list[dict]:
    """
    Returns ranked chunks: list of dicts with keys
    `id, text, source, section_title, score, rerank_score (opt), accessibility_metadata`.
    """
    if not query.strip():
        return []
    top_k = top_k or settings.RAG_TOP_K
    rerank_top_k = rerank_top_k or settings.RAG_RERANK_TOP_K
    if use_reranker is None:
        use_reranker = settings.RAG_RERANK_ENABLED

    embedding = (await embed_text([query]))[0]
    filters: QueryFilters = {
        "top_k": top_k,
        "concept_id": concept_id,
        "subject_id": subject_id,
        "language": language or settings.DEFAULT_LANGUAGE,
    }
    if class_id or material_id:
        # Response language is a learner preference; the source can be in
        # another language. Keep the permission scope, regardless of language.
        filters.update(
            QueryFilters(
                student_id=student_id, class_id=class_id, material_id=material_id, language=None
            )
        )
    if settings.VECTOR_BACKEND == "qdrant":
        from rag.stores.qdrant_store import query as qdrant_query

        candidates = await qdrant_query(embedding, **filters)
    else:
        candidates = await pgvector_store.query(embedding, **filters)
    if not candidates:
        if class_id or material_id:
            raise HTTPException(
                409,
                "Materi kelas berubah atau belum siap. Buka kembali materi atau minta guru memproses indeks AI.",
            )
        return []

    if use_reranker and len(candidates) > rerank_top_k:
        return await rerank(query, candidates, top_k=rerank_top_k)
    return candidates[:rerank_top_k]


# ---------------------------------------------------------------------------
# LangGraph node - used directly from `graphs/main_graph.py`
# ---------------------------------------------------------------------------
async def rag_retrieval_node(state) -> dict:
    """
    LangGraph node wrapping `retrieve()`. Reads the latest student
    utterance from `state["user_input"]` (or, if missing, the last
    HumanMessage), retrieves grounding chunks scoped to the selected subject,
    and writes them into `state["retrieved_docs"]`.
    """
    query = state.get("user_input") or ""
    if not query and state.get("messages"):
        # Fall back to the most recent HumanMessage content.
        for m in reversed(state["messages"]):
            try:
                role = getattr(m, "type", None) or getattr(m, "role", None)
                if role in {"human", "user"}:
                    query = getattr(m, "content", "") or ""
                    break
            except Exception:  # noqa: S112  # skip malformed message entries, keep scanning history
                continue

    if not query.strip():
        return {"retrieved_docs": [], "next_action": "tutor", "last_node": "rag_retrieval"}

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
    docs = await retrieve(query, **filters)
    logger.info("RAG retrieved %d chunks for query=%r", len(docs), query[:64])
    updates = {"retrieved_docs": docs, "next_action": "tutor", "last_node": "rag_retrieval"}
    if not state.get("current_concept_id"):
        concept = next((doc.get("concept_id") for doc in docs if doc.get("concept_id")), None)
        if concept:
            updates["current_concept_id"] = str(concept)
    return updates


def _as_uuid(value) -> uuid.UUID | None:
    """Coerce a state value to a UUID, or None when it is absent or malformed."""
    if not value:
        return None
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        return None

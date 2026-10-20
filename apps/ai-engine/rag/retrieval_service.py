"""One budgeted vector retrieval, SQL authorization and evidence assembly path."""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass

from config.settings import settings
from rag.embeddings import embed_text
from rag.reranker import rerank
from rag.source_bundle import MaterialScope, QuestionSourceBundle, bundle_from_docs
from rag.stores import pgvector_store


@dataclass(frozen=True)
class RetrievalRequest:
    query: str
    scope: MaterialScope
    candidate_k: int
    final_k: int
    use_reranker: bool | None = None

    def validate(self):
        self.scope.validate()
        if not self.query.strip():
            return
        if not 1 <= self.candidate_k <= 100 or not 1 <= self.final_k <= self.candidate_k:
            raise ValueError(
                "Retrieval budgets must be positive, bounded, and final_k <= candidate_k."
            )


@dataclass(frozen=True)
class RetrievalTrace:
    candidate_count: int
    hydrated_count: int
    returned_count: int
    fallback_reason: str | None
    backend: str
    latency_ms: int


@dataclass(frozen=True)
class RetrievalResult:
    documents: list[dict]
    bundle: QuestionSourceBundle
    trace: RetrievalTrace


def scope_from_filters(filters: dict | None) -> MaterialScope:
    filters = filters or {}
    scope = MaterialScope(
        student_id=_uuid(filters.get("student_id"), "student_id"),
        class_id=_uuid(filters.get("class_id"), "class_id"),
        material_id=_uuid(filters.get("material_id"), "material_id"),
        concept_id=_uuid(filters.get("concept_id"), "concept_id", allow_text=True),
        subject_id=_uuid(filters.get("subject_id"), "subject_id"),
        content_version=_optional_int(filters.get("content_version"), "content_version"),
        mapping_version=_optional_int(filters.get("mapping_version"), "mapping_version"),
        language=filters.get("language"),
    )
    scope.validate()
    return scope


async def retrieve_sources(request: RetrievalRequest) -> RetrievalResult:
    """Search one selected vector backend and return SQL-hydrated, traceable evidence."""
    request.validate()
    started = time.perf_counter()
    backend = "qdrant" if settings.VECTOR_BACKEND == "qdrant" else "pgvector"
    if not request.query.strip():
        bundle = bundle_from_docs(request.query, request.scope, [])
        trace = RetrievalTrace(0, 0, 0, "empty_query", backend, 0)
        await _trace_retrieval(request, bundle, trace)
        return RetrievalResult([], bundle, trace)

    scope = request.scope
    embedding = (await embed_text([request.query]))[0]
    args: pgvector_store.QueryFilters = {
        "top_k": request.candidate_k,
        "concept_id": scope.concept_id,
        "subject_id": scope.subject_id,
        "language": None
        if scope.class_id or scope.material_id
        else (scope.language or settings.DEFAULT_LANGUAGE),
        "student_id": scope.student_id,
        "class_id": scope.class_id,
        "material_id": scope.material_id,
        "content_version": scope.content_version,
        "mapping_version": scope.mapping_version,
    }
    fallback_reason = None
    if backend == "qdrant":
        from rag.stores.qdrant_store import query_with_trace

        candidates, vector_trace = await query_with_trace(embedding, **args)
        candidate_count = vector_trace["candidate_count"]
        hydrated_count = vector_trace["hydrated_count"]
        fallback_reason = vector_trace["fallback_reason"]
    else:
        candidates = await pgvector_store.query(embedding, **args)
        candidate_count = len(candidates)
        hydrated_count = len(candidates)

    rerank_enabled = (
        request.use_reranker if request.use_reranker is not None else settings.RAG_RERANK_ENABLED
    )
    if rerank_enabled and candidates:
        ranked = await rerank(request.query, candidates, top_k=request.final_k)
    else:
        ranked = candidates[: request.final_k]
    bundle = bundle_from_docs(request.query, scope, ranked)
    trace = RetrievalTrace(
        candidate_count=candidate_count,
        hydrated_count=hydrated_count,
        returned_count=len(ranked),
        fallback_reason=fallback_reason,
        backend=backend,
        latency_ms=max(0, round((time.perf_counter() - started) * 1000)),
    )
    await _trace_retrieval(request, bundle, trace)
    return RetrievalResult(ranked, bundle, trace)


async def _trace_retrieval(request, bundle, trace):
    from tools.learning_trace import LearningTraceEvent, record_learning_trace
    from tools.provider_usage import current_usage_context

    context = current_usage_context()
    if context is None:
        return
    fallback = trace.fallback_reason or (
        "no_authorized_candidates" if trace.returned_count == 0 else None
    )
    await record_learning_trace(
        LearningTraceEvent(
            request_id=context.request_id,
            student_id=request.scope.student_id,
            stage="retrieval",
            node=f"rag.retrieval.{trace.backend}",
            source_ids=[source.id for source in bundle.sources[:32]],
            candidate_count=trace.candidate_count,
            accepted_count=trace.hydrated_count,
            returned_count=trace.returned_count,
            fallback_reason=fallback[:80] if fallback else None,
            latency_ms=min(180_000, trace.latency_ms),
        )
    )


def _uuid(value, name, *, allow_text=False):
    if value is None or value == "":
        return None
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        if allow_text and name == "concept_id":
            # Human topic labels are query text, never database identifiers.
            return None
        raise ValueError(f"Invalid {name} in retrieval scope.") from None


def _optional_int(value, name):
    if value is None or value == "":
        return None
    try:
        parsed = int(value)
    except (ValueError, TypeError):
        raise ValueError(f"Invalid {name} in retrieval scope.") from None
    if parsed < 0 or (name == "content_version" and parsed < 1):
        raise ValueError(f"Invalid {name} in retrieval scope.")
    return parsed

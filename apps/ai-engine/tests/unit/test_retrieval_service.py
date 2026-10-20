"""Shared retrieval budgets, source provenance and candidate fallback semantics."""

import uuid
from types import SimpleNamespace

import pytest

pytestmark = pytest.mark.unit


async def test_rag_facades_share_candidate_budget_and_scope_filters(monkeypatch):
    from rag import retriever
    from rag.retrieval_service import RetrievalResult, RetrievalTrace
    from tools import rag_tool

    calls = []
    documents = [{"id": "chunk", "text": "Pecahan adalah bagian dari keseluruhan."}]

    async def retrieve(request):
        calls.append(request)
        return RetrievalResult(
            documents=documents,
            bundle=None,
            trace=RetrievalTrace(1, 1, 1, None, "pgvector", 1),
        )

    monkeypatch.setattr(retriever, "retrieve_sources", retrieve)
    monkeypatch.setattr(rag_tool, "retrieve_sources", retrieve)
    monkeypatch.setattr(retriever.settings, "RAG_TOP_K", 8)
    monkeypatch.setattr(retriever.settings, "RAG_RERANK_TOP_K", 4)
    monkeypatch.setattr(rag_tool.settings, "RAG_TOP_K", 8)
    monkeypatch.setattr(rag_tool.settings, "RAG_RERANK_TOP_K", 4)
    monkeypatch.setattr(rag_tool.settings, "RAG_RERANK_ENABLED", False)
    student_id, class_id, material_id = (uuid.uuid4() for _ in range(3))
    await retriever.retrieve(
        "Jelaskan pecahan",
        student_id=student_id,
        class_id=class_id,
        material_id=material_id,
        use_reranker=False,
    )
    tool = rag_tool.RAGTool()
    await tool.retrieve(
        "Jelaskan pecahan",
        filters={
            "student_id": student_id,
            "class_id": class_id,
            "material_id": material_id,
        },
    )

    assert len(calls) == 2
    assert [(call.candidate_k, call.final_k) for call in calls] == [(8, 4), (8, 4)]
    assert calls[0].scope == calls[1].scope
    assert calls[0].scope.student_id == student_id
    assert calls[0].scope.class_id == class_id
    assert calls[0].scope.material_id == material_id


async def test_qdrant_small_authorized_corpus_does_not_fallback_for_missing_budget_slots(
    monkeypatch,
):
    from rag.stores import pgvector_store, qdrant_store

    chunk_ids = [uuid.uuid4() for _ in range(7)]
    hashes = {str(chunk_id): f"hash-{index}" for index, chunk_id in enumerate(chunk_ids)}

    class Client:
        async def query_points(self, **kwargs):
            assert kwargs["limit"] == 20
            return SimpleNamespace(
                points=[
                    SimpleNamespace(
                        id=str(chunk_id), payload={"vector_hash": hashes[str(chunk_id)]}
                    )
                    for chunk_id in chunk_ids
                ]
            )

    async def client():
        return Client()

    calls = []

    async def postgres_query(_embedding, **kwargs):
        calls.append(kwargs)
        rows = [
            {
                "id": chunk_id,
                "text": f"Authorized source block {index}",
                "_vector_hash": hashes[str(chunk_id)],
            }
            for index, chunk_id in enumerate(chunk_ids)
        ]
        if kwargs.get("candidate_ids") is not None:
            rows = [row for row in rows if row["id"] in kwargs["candidate_ids"]]
        return rows

    monkeypatch.setattr(qdrant_store, "_client", client)
    monkeypatch.setattr(pgvector_store, "query", postgres_query)
    rows, trace = await qdrant_store.query_with_trace([0.1] * 8, top_k=20)

    assert len(rows) == 7
    assert trace == {"candidate_count": 7, "hydrated_count": 7, "fallback_reason": None}
    assert len(calls) == 2, (
        "a short Qdrant page is checked against authorized PostgreSQL availability"
    )


async def test_qdrant_stale_vectors_are_replaced_from_postgres_and_reason_is_traced(monkeypatch):
    from rag.stores import pgvector_store, qdrant_store

    chunk_id, recovered_id = uuid.uuid4(), uuid.uuid4()

    class Client:
        async def query_points(self, **kwargs):
            return SimpleNamespace(
                points=[SimpleNamespace(id=str(chunk_id), payload={"vector_hash": "old"})]
            )

    async def client():
        return Client()

    calls = []

    async def postgres_query(_embedding, **kwargs):
        calls.append(kwargs)
        rows = [
            {"id": chunk_id, "text": "Current approved SQL text"},
            {"id": recovered_id, "text": "Additional current approved SQL text"},
        ]
        if kwargs.get("include_vector_hash"):
            for row in rows:
                row["_vector_hash"] = "new"
        if kwargs.get("candidate_ids") is not None:
            return [row for row in rows if row["id"] in kwargs["candidate_ids"]]
        return rows

    monkeypatch.setattr(qdrant_store, "_client", client)
    monkeypatch.setattr(pgvector_store, "query", postgres_query)
    rows, trace = await qdrant_store.query_with_trace([0.1] * 8, top_k=4)

    assert {row["id"] for row in rows} == {chunk_id, recovered_id}
    assert trace["fallback_reason"] == "stale_vector"
    assert trace["candidate_count"] == 1 and trace["hydrated_count"] == 2
    assert len(calls) == 2 and "candidate_ids" not in calls[-1]


async def test_qdrant_empty_page_trace_counts_postgres_fallback_documents(monkeypatch):
    from rag.stores import qdrant_store

    class Client:
        async def query_points(self, **_kwargs):
            return SimpleNamespace(points=[])

    async def client():
        return Client()

    async def postgres_query(_embedding, **_kwargs):
        return [{"id": uuid.uuid4(), "text": "Authorized SQL source"}]

    monkeypatch.setattr(qdrant_store, "_client", client)
    monkeypatch.setattr(qdrant_store, "_postgres_query", postgres_query)
    rows, trace = await qdrant_store.query_with_trace([0.1] * 8, top_k=4)

    assert len(rows) == 1
    assert trace == {"candidate_count": 0, "hydrated_count": 1, "fallback_reason": "qdrant_empty"}


async def test_qdrant_unavailable_trace_counts_authorized_fallback_documents(monkeypatch):
    from rag.stores import qdrant_store

    async def unavailable():
        raise ConnectionError("qdrant unavailable")

    async def postgres_query(_embedding, **_kwargs):
        return [{"id": uuid.uuid4(), "text": "Current authorized source"}]

    monkeypatch.setattr(qdrant_store, "_client", unavailable)
    monkeypatch.setattr(qdrant_store, "_postgres_query", postgres_query)
    rows, trace = await qdrant_store.query_with_trace([0.1] * 8, top_k=4)

    assert len(rows) == 1
    assert trace == {
        "candidate_count": 0,
        "hydrated_count": 1,
        "fallback_reason": "qdrant_unavailable",
    }


async def test_insufficient_qdrant_candidates_trace_counts_full_authorized_fallback(monkeypatch):
    from rag.stores import pgvector_store, qdrant_store

    candidate_id, recovered_id = uuid.uuid4(), uuid.uuid4()

    class Client:
        async def query_points(self, **_kwargs):
            return SimpleNamespace(
                points=[SimpleNamespace(id=str(candidate_id), payload={"vector_hash": "same"})]
            )

    async def client():
        return Client()

    async def postgres_query(_embedding, **kwargs):
        rows = [
            {"id": candidate_id, "text": "Candidate source", "_vector_hash": "same"},
            {
                "id": recovered_id,
                "text": "Authorized source missed by Qdrant",
                "_vector_hash": "same",
            },
        ]
        if kwargs.get("candidate_ids") is not None:
            return [row for row in rows if row["id"] in kwargs["candidate_ids"]]
        return rows

    monkeypatch.setattr(qdrant_store, "_client", client)
    monkeypatch.setattr(pgvector_store, "query", postgres_query)
    rows, trace = await qdrant_store.query_with_trace([0.1] * 8, top_k=2)

    assert {row["id"] for row in rows} == {candidate_id, recovered_id}
    assert trace == {
        "candidate_count": 1,
        "hydrated_count": 2,
        "fallback_reason": "insufficient_authorized_candidates",
    }


def test_source_bundle_preserves_versioned_block_and_page_evidence_and_rejects_empty_units():
    from rag.source_bundle import MaterialScope, bundle_from_unit

    scope = MaterialScope(
        student_id=uuid.uuid4(),
        class_id=uuid.uuid4(),
        material_id=uuid.uuid4(),
        content_version=4,
        mapping_version=2,
    )
    unit = {
        "retrieval_text": "Pecahan senilai memiliki pembilang dan penyebut dengan nilai sama.",
        "block_ids": ["paragraph-7"],
        "spans": [{"block_id": "paragraph-7", "page": 11, "bbox": [1, 2, 3, 4]}],
        "document_hash": "a" * 64,
        "base_id": "base-7",
        "approved_concept_ids": [str(uuid.uuid4())],
    }

    bundle = bundle_from_unit(unit, scope)
    source = bundle.sources[0]
    assert source.material_id == scope.material_id
    assert source.content_version == 4 and source.mapping_version == 2
    assert source.block_ids == ("paragraph-7",)
    assert source.spans[0]["page"] == 11
    assert source.document_hash == "a" * 64
    with pytest.raises(ValueError, match="learning evidence"):
        bundle_from_unit({"retrieval_text": "Judul modul: Pecahan", "block_ids": []}, scope)


def test_source_bundle_preserves_zero_mapping_version_from_retrieval_docs():
    from rag.source_bundle import MaterialScope, bundle_from_docs

    scope = MaterialScope(
        student_id=uuid.uuid4(),
        class_id=uuid.uuid4(),
        material_id=uuid.uuid4(),
        content_version=1,
        mapping_version=0,
    )
    evidence = bundle_from_docs(
        "pecahan",
        scope,
        [
            {
                "chunk_id": "chunk-1",
                "text": "Pecahan senilai memiliki pembilang dan penyebut dengan nilai sama.",
                "material_id": str(scope.material_id),
                "content_version": 1,
                "mapping_version": 0,
            }
        ],
    )

    assert evidence.sources[0].mapping_version == 0


def test_class_filter_cannot_silently_use_a_text_topic_as_all_material_scope():
    from rag.retrieval_service import scope_from_filters

    with pytest.raises(ValueError, match="selected material or approved concept"):
        scope_from_filters(
            {
                "student_id": uuid.uuid4(),
                "class_id": uuid.uuid4(),
                "concept_id": "Pecahan senilai",
            }
        )

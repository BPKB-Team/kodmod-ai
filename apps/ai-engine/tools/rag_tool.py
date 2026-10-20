"""Shared RAG facade for tutors, quiz generation and curriculum tools."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from langchain_core.tools import Tool

from config.settings import settings
from graphs.state import RetrievedDoc
from rag.retrieval_service import RetrievalRequest, retrieve_sources, scope_from_filters


class RAGTool:
    """List-shaped compatibility adapter over the canonical retrieval service."""

    def __init__(self, top_k_vector: int | None = None, top_k_final: int | None = None):
        self.top_k_vector = top_k_vector or settings.RAG_TOP_K
        self.top_k_final = top_k_final or settings.RAG_RERANK_TOP_K

    async def retrieve(
        self,
        query: str,
        k: int | None = None,
        filters: dict[str, Any] | None = None,
    ) -> list[RetrievedDoc]:
        if not query.strip():
            return []
        final_k = k or self.top_k_final
        candidate_k = max(self.top_k_vector, final_k)
        if candidate_k > 100 or final_k > candidate_k:
            raise ValueError("Retrieval budgets exceed the supported range.")
        try:
            scope = scope_from_filters(filters)
            request = RetrievalRequest(
                query=query,
                scope=scope,
                candidate_k=candidate_k,
                final_k=final_k,
            )
            result = await retrieve_sources(request)
        except ValueError as error:
            if filters and (filters.get("class_id") or filters.get("material_id")):
                raise HTTPException(
                    409,
                    "Pilih materi atau konsep yang disetujui guru sebelum mencari sumber kelas.",
                ) from error
            raise
        if not result.documents and (scope.class_id or scope.material_id):
            raise HTTPException(
                409,
                "Materi kelas berubah atau belum siap. Buka kembali materi atau minta guru memproses indeks AI.",
            )
        return [self._retrieved_doc(row) for row in result.documents]

    @staticmethod
    def _retrieved_doc(row: dict) -> RetrievedDoc:
        return RetrievedDoc(
            doc_id=str(row.get("doc_id") or row.get("material_id") or row.get("id") or ""),
            chunk_id=str(row.get("chunk_id") or row.get("id") or ""),
            text=row.get("text", ""),
            score=float(row.get("rerank_score", row.get("score", 0.0))),
            source=row.get("source", "curriculum"),
            concept_ids=row.get("approved_concept_ids") or row.get("concept_ids", []),
            concept_id=row.get("concept_id"),
            class_id=row.get("class_id"),
            material_id=row.get("material_id"),
            material_title=row.get("material_title"),
            section_title=row.get("section_title"),
            block_ids=row.get("block_ids", []),
            spans=row.get("spans", []),
            content_version=row.get("content_version"),
            mapping_version=row.get("mapping_version"),
            document_hash=row.get("document_hash"),
            approved_concept_ids=row.get("approved_concept_ids", []),
        )

    def as_langchain_tool(self) -> Tool:
        async def _arun(query: str) -> str:
            docs = await self.retrieve(query)
            return "\n---\n".join(f"[{doc['source']}] {doc['text']}" for doc in docs)

        return Tool(
            name="curriculum_search",
            description=(
                "Search authorized, versioned KODMOD learning sources. "
                "Input: a natural-language question. Output: relevant source text."
            ),
            coroutine=_arun,
        )

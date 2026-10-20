"""Authorized, versioned evidence bundles shared by tutoring and quiz generation."""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class MaterialScope:
    student_id: uuid.UUID | None = None
    class_id: uuid.UUID | None = None
    material_id: uuid.UUID | None = None
    concept_id: uuid.UUID | None = None
    content_version: int | None = None
    mapping_version: int | None = None
    subject_id: uuid.UUID | None = None
    language: str | None = None

    def validate(self) -> None:
        if (self.class_id or self.material_id) and (not self.student_id or not self.class_id):
            raise ValueError("Classroom material scope requires student, class, and material IDs.")
        if self.class_id and not self.material_id and not self.concept_id:
            raise ValueError(
                "Class retrieval requires a selected material or approved concept scope."
            )
        if self.content_version is not None and self.content_version < 1:
            raise ValueError("Material content version must be positive.")
        if self.mapping_version is not None and self.mapping_version < 0:
            raise ValueError("Material mapping version cannot be negative.")


@dataclass(frozen=True)
class SourceEvidence:
    id: str
    material_id: uuid.UUID | None
    chunk_id: str
    block_ids: tuple[str, ...]
    spans: tuple[dict[str, Any], ...]
    text: str
    content_version: int | None
    mapping_version: int | None
    document_hash: str | None
    approved_concept_ids: tuple[str, ...]
    source: str | None = None
    section_title: str | None = None


@dataclass(frozen=True)
class QuestionSourceBundle:
    query: str
    scope: MaterialScope
    sources: tuple[SourceEvidence, ...]

    @property
    def has_evidence(self) -> bool:
        return bool(self.sources)


def bundle_from_docs(
    query: str, scope: MaterialScope, documents: list[dict]
) -> QuestionSourceBundle:
    """Convert SQL-hydrated retrieval rows into the only evidence shape agents use."""
    scope.validate()
    sources = []
    for document in documents:
        metadata = document.get("accessibility_metadata") or {}
        chunk_id = str(document.get("chunk_id") or document.get("id") or "")
        text = str(document.get("text") or "").strip()
        if not chunk_id or not text:
            continue
        material_raw = document.get("material_id") or scope.material_id
        material_id = _optional_uuid(material_raw)
        block_ids = document.get("block_ids") or metadata.get("block_ids") or []
        spans = document.get("spans") or metadata.get("spans") or []
        concepts = (
            document.get("approved_concept_ids")
            or metadata.get("approved_concept_ids")
            or document.get("concept_ids")
            or []
        )
        sources.append(
            SourceEvidence(
                id=str(document.get("evidence_id") or chunk_id),
                material_id=material_id,
                chunk_id=chunk_id,
                block_ids=tuple(str(item) for item in block_ids),
                spans=tuple(dict(item) for item in spans if isinstance(item, dict)),
                text=text,
                content_version=_optional_int(
                    document.get("content_version")
                    or document.get("material_version")
                    or metadata.get("content_version")
                ),
                mapping_version=_optional_int(
                    document.get("mapping_version")
                    or document.get("material_mapping_version")
                    or metadata.get("mapping_version")
                ),
                document_hash=document.get("document_hash") or metadata.get("document_hash"),
                approved_concept_ids=tuple(str(value) for value in concepts),
                source=document.get("source"),
                section_title=document.get("section_title"),
            )
        )
    return QuestionSourceBundle(query=query, scope=scope, sources=tuple(sources))


def bundle_from_unit(unit: dict, scope: MaterialScope) -> QuestionSourceBundle:
    """Make unit-backed evidence only from a substantive canonical learning unit."""
    scope.validate()
    if not scope.material_id or not scope.student_id or not scope.class_id:
        raise ValueError(
            "Direct material units require an authorized student/class/material scope."
        )
    text = str(unit.get("retrieval_text") or unit.get("text") or "").strip()
    block_ids = [str(value) for value in unit.get("block_ids") or [] if value]
    if not block_ids or not text or not _substantive(text):
        raise ValueError("Unit does not contain approved learning evidence.")
    span_rows = unit.get("spans") or []
    spans = tuple(dict(value) for value in span_rows if isinstance(value, dict))
    version = _optional_int(unit.get("content_version") or scope.content_version)
    mapping_version = _optional_int(unit.get("mapping_version") or scope.mapping_version)
    digest = unit.get("document_hash")
    chunk_id = str(unit.get("base_id") or block_ids[0])
    evidence = SourceEvidence(
        id=chunk_id,
        material_id=scope.material_id,
        chunk_id=chunk_id,
        block_ids=tuple(block_ids),
        spans=spans,
        text=text,
        content_version=version,
        mapping_version=mapping_version,
        document_hash=digest,
        approved_concept_ids=tuple(str(value) for value in unit.get("approved_concept_ids") or []),
        section_title=unit.get("title"),
    )
    return QuestionSourceBundle(query=text, scope=scope, sources=(evidence,))


def _substantive(text: str) -> bool:
    from api.learning_content import is_learning_text

    if is_learning_text(text):
        return True
    # A complete scientific equation or reviewed table can be meaningful with few words.
    return bool(re.search(r"(?:=|<|>|\\(?:frac|sqrt)|\^[{A-Za-z0-9])", text))


def _optional_uuid(value) -> uuid.UUID | None:
    if value is None or value == "":
        return None
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        return None


def _optional_int(value) -> int | None:
    try:
        return int(value) if value is not None else None
    except (ValueError, TypeError):
        return None

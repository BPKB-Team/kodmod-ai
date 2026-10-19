"""Student-visible facts. Planner receives this projection, never raw grading state."""

from typing import Literal

from pydantic import BaseModel, Field


class ConceptEvidence(BaseModel):
    concept_id: str
    concept_name: str
    mastery: float = Field(ge=0, le=1)
    evidence_count: int = Field(ge=0)
    session_count: int = Field(ge=0)
    enough_evidence: bool
    label: Literal["strong", "needs_practice", "collect_evidence"]
    history: list[dict] = Field(default_factory=list)


class StudentProgressFacts(BaseModel):
    mastery_available: bool
    overall_mastery: float = Field(ge=0, le=1)
    assessed_concepts: int = Field(ge=0)
    mapped_concepts: int = Field(ge=0)
    unmapped_materials: int = Field(ge=0)
    materials_started: int = Field(ge=0)
    materials_completed: int = Field(ge=0)
    completed_units: int = Field(ge=0)
    total_units: int = Field(ge=0)
    visible_evidence_hash: str
    concept_evidence: list[ConceptEvidence]
    learning_materials: list[dict]

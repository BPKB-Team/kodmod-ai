"""Typed facts, bounded planner proposals and deterministic public recommendations."""

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ProgressFact(BaseModel):
    fact_id: str
    kind: str
    data: dict[str, Any]


class PlanCandidate(BaseModel):
    candidate_id: str
    kind: Literal["review_unit", "practice", "self_explain"]
    class_id: str
    material_id: str
    material_title: str
    concept_id: str | None = None
    unit_id: str
    unit_index: int = Field(ge=0)
    content_version: int
    mapping_version: int
    unit_manifest_hash: str
    supported_question_count: int = Field(ge=0, le=3)
    estimated_minutes: int = Field(ge=1, le=15)
    allowed_reason_fact_ids: list[str]
    priority: int = Field(ge=0)


class GuidanceSnapshot(BaseModel):
    source_snapshot_hash: str
    as_of: datetime
    timezone: str
    planning_window: dict
    facts: list[ProgressFact] = Field(max_length=100)
    candidates: list[PlanCandidate] = Field(max_length=60)
    policy_version: str = "progress-v1"
    prompt_version: str = "planner-v1"


class ProgressInsight(BaseModel):
    kind: str
    fact_ids: list[str]
    title: str
    body: str


class PlanProposal(BaseModel):
    model_config = ConfigDict(extra="forbid")
    goal_candidate_id: str
    step_candidate_ids: list[str] = Field(min_length=1, max_length=3)
    reason_fact_ids: list[str] = Field(min_length=1, max_length=6)


class ValidatedPlan(BaseModel):
    goal_candidate_id: str | None
    step_candidate_ids: list[str]
    reason_fact_ids: list[str]
    used_fallback: bool = False
    status: Literal["ready", "no_available_material"] = "ready"


class RecommendationView(BaseModel):
    candidate_id: str
    title: str
    body: str
    reason_text: str
    estimated_minutes: int
    href: str


class GuidanceRefreshRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: uuid.UUID
    expected_revision: int = Field(ge=0, strict=True)
    timezone: str = Field(default="UTC", min_length=1, max_length=80)


class PlanStepActionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: uuid.UUID
    expected_revision: int = Field(ge=0, strict=True)

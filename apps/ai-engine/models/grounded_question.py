"""Private generation and review contracts for source-grounded questions."""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class QuestionQualityReason(StrEnum):
    NO_LEARNING_CONTENT = "no_learning_content"
    GENERIC_TITLE = "generic_title"
    UNSUPPORTED_ANSWER = "unsupported_answer"
    ENTITY_MISMATCH = "entity_mismatch"
    UNREADABLE_FORMULA = "unreadable_formula"
    DUPLICATE = "duplicate"
    INSUFFICIENT_DEPTH = "insufficient_depth"


class GroundedQuestion(BaseModel):
    """Answer-key-bearing internal model; never expose directly to a student."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    text: str = Field(min_length=1, max_length=4000)
    type: Literal["mcq", "spoken", "explain", "reasoning", "step_by_step"]
    options: list[str] = Field(default_factory=list, max_length=4)
    expected_answer: str = Field(min_length=1, max_length=4000)
    rubric: dict = Field(default_factory=dict)
    explanation: str = Field(default="", max_length=4000)
    evidence_refs: list[str] = Field(min_length=1, max_length=6)
    objective: str = Field(min_length=5, max_length=500)
    cognitive_level: Literal["recall", "understanding", "application", "reasoning", "analysis"]
    concept_id: str = Field(default="", max_length=100)
    difficulty: Literal["beginner", "easy", "medium", "hard", "expert"] | None = None

    @model_validator(mode="after")
    def usable_answer_contract(self):
        if not self.text.strip() or not self.expected_answer.strip():
            raise ValueError("Question and expected answer must not be blank.")
        if self.expected_answer.casefold().strip(" .") in {
            "open-ended",
            "placeholder",
            "tbd",
            "n/a",
            "...",
        }:
            raise ValueError("Question must have a gradable expected answer.")
        if self.type == "mcq":
            if (
                len(self.options) != 4
                or len({value.casefold().strip() for value in self.options}) != 4
            ):
                raise ValueError("MCQ requires four distinct options.")
            accepted = {"a", "b", "c", "d"} | {value.casefold().strip() for value in self.options}
            if self.expected_answer.casefold().rstrip(".") not in accepted:
                raise ValueError("MCQ answer must identify one of its options.")
        elif self.options:
            raise ValueError("Only MCQ questions can have options.")
        if len(set(self.evidence_refs)) != len(self.evidence_refs):
            raise ValueError("Evidence references must be unique.")
        return self


class QuestionQualityDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    accepted: bool
    reasons: list[QuestionQualityReason] = Field(default_factory=list, max_length=7)

    @model_validator(mode="after")
    def decision_matches_reasons(self):
        if (self.accepted and self.reasons) or (not self.accepted and not self.reasons):
            raise ValueError("Rejected questions need reason codes; accepted questions have none.")
        if len(set(self.reasons)) != len(self.reasons):
            raise ValueError("Quality reason codes must be unique.")
        return self


class GroundedQuestionBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    questions: list[GroundedQuestion] = Field(min_length=1, max_length=20)
    prompt_version: str = Field(min_length=1, max_length=80)
    prompt_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    generation_calls: int = Field(ge=1, le=3)
    verification_calls: int = Field(ge=0, le=3)


class QuestionSemanticReview(BaseModel):
    """One structured verifier decision; feedback is internal and bounded."""

    model_config = ConfigDict(extra="forbid")

    accepted: bool
    reasons: list[QuestionQualityReason] = Field(default_factory=list, max_length=7)
    feedback: str = Field(default="", max_length=500)

    @model_validator(mode="after")
    def decision_matches_reasons(self):
        if (self.accepted and self.reasons) or (not self.accepted and not self.reasons):
            raise ValueError("Rejected questions need reason codes; accepted questions have none.")
        if len(set(self.reasons)) != len(self.reasons):
            raise ValueError("Quality reason codes must be unique.")
        return self


class QuestionSemanticReviewBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decisions: list[QuestionSemanticReview] = Field(min_length=1, max_length=20)

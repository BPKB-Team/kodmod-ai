"""Manual quiz contracts; student DTOs intentionally have no answer key."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from models.quiz import ScoreSummary


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ProposalInput(Input):
    class_id: uuid.UUID
    material_id: uuid.UUID
    n_questions: int = Field(default=5, ge=1, le=20)
    difficulty: Literal["easy", "medium", "hard"] = "medium"
    language: Literal["id", "en"] = "id"


class Option(Input):
    id: str = Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")
    label: str = Field(min_length=1, max_length=1000)


class QuestionInput(Input):
    order_index: int = Field(ge=1, le=20, strict=True)
    prompt: str = Field(min_length=1, max_length=4000)
    narration: str = Field(default="", max_length=6000)
    options: list[Option] = Field(min_length=2, max_length=6)
    correct_option_id: str = Field(min_length=1, max_length=40)
    explanation: str = Field(default="", max_length=4000)
    concept_id: uuid.UUID | None = None
    difficulty: Literal["easy", "medium", "hard"] = "medium"

    @model_validator(mode="after")
    def options_and_key(self):
        ids = [o.id for o in self.options]
        if len(ids) != len(set(ids)) or self.correct_option_id not in ids:
            raise ValueError("Options must be unique and include exactly one correct option.")
        return self


class DraftInput(Input):
    subject_id: uuid.UUID
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    release_policy: Literal["after_submission", "after_due"] = "after_submission"
    questions: list[QuestionInput] = Field(min_length=1, max_length=20)

    @model_validator(mode="after")
    def question_order(self):
        orders = [q.order_index for q in self.questions]
        if sorted(orders) != list(range(1, len(orders) + 1)):
            raise ValueError("Question order must be consecutive and unique, starting at one.")
        return self


class SaveDraft(DraftInput):
    expected_version: int = Field(ge=1, strict=True)


class VersionAction(Input):
    version_id: uuid.UUID
    expected_review_revision: int = Field(ge=0, strict=True)


class ReviewerAction(VersionAction):
    reviewer_id: uuid.UUID | None = None


class ReviewDecision(VersionAction):
    note: str = Field(default="", max_length=2000)


class RejectDecision(ReviewDecision):
    note: str = Field(min_length=1, max_length=2000)


class AssignInput(Input):
    version_id: uuid.UUID
    class_id: uuid.UUID
    opens_at: datetime | None = None
    due_at: datetime | None = None

    @field_validator("opens_at", "due_at")
    @classmethod
    def aware_utc(cls, value):
        if value is not None:
            if value.tzinfo is None or value.utcoffset() is None:
                raise ValueError("Schedules must include a timezone.")
            return value.astimezone(UTC)
        return value

    @model_validator(mode="after")
    def schedule_order(self):
        if self.opens_at and self.due_at and self.opens_at >= self.due_at:
            raise ValueError("Availability must precede the due date.")
        return self


class SaveAnswer(Input):
    option_id: str = Field(min_length=1, max_length=40)
    expected_revision: int = Field(ge=0, strict=True)


class SubmitAttempt(Input):
    expected_revision: int = Field(ge=0, strict=True)


class StudentQuestion(BaseModel):
    id: uuid.UUID
    order_index: int
    prompt: str
    narration: str
    options: list[Option]
    concept_id: uuid.UUID | None


class StaffQuestion(StudentQuestion):
    correct_option_id: str
    explanation: str
    difficulty: str


class VersionOut(BaseModel):
    id: uuid.UUID
    version: int
    subject_id: uuid.UUID
    title: str
    description: str
    state: str
    reviewer_id: uuid.UUID | None
    review_revision: int
    release_policy: str
    questions: list[StaffQuestion]


class AssignmentOut(BaseModel):
    score_summary: ScoreSummary | None = None
    id: uuid.UUID
    version_id: uuid.UUID
    version: int
    title: str
    description: str
    class_id: uuid.UUID
    class_name: str
    opens_at: datetime | None
    due_at: datetime | None
    is_closed: bool
    release_policy: str
    total_questions: int
    attempt_state: str | None = None
    score: float | None = None


class DraftOut(BaseModel):
    id: uuid.UUID
    teacher_id: uuid.UUID
    current_version: int
    is_archived: bool
    version: VersionOut
    events: list[dict]
    assignments: list[AssignmentOut]


class AttemptOut(BaseModel):
    id: uuid.UUID
    assignment: AssignmentOut
    revision: int
    state: str
    questions: list[StudentQuestion]
    answers: dict[str, str]


class ResultOut(BaseModel):
    score_summary: ScoreSummary | None = None
    attempt_id: uuid.UUID
    assignment_id: uuid.UUID
    score: float
    correct_count: int
    total_questions: int
    submitted_at: datetime
    feedback_released: bool
    review: list[dict]

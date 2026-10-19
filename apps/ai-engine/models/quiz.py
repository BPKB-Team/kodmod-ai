"""Pydantic schemas for /quiz endpoints."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class QuizStartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    concept_id: uuid.UUID | None = None
    class_id: uuid.UUID | None = None
    material_id: uuid.UUID | None = None
    n_questions: int = Field(default=5, ge=1, le=20)
    difficulty: Literal["easy", "medium", "hard"] | None = None
    language: Literal["id", "en"] = "id"

    @model_validator(mode="after")
    def validate_scope(self):
        if bool(self.class_id) != bool(self.material_id):
            raise ValueError("Pilih kelas dan materi bersama.")
        if self.class_id and self.concept_id:
            raise ValueError("Konsep kurikulum dan materi kelas adalah pilihan berbeda.")
        return self


class QuizQuestionOut(BaseModel):
    question_id: str
    order_index: int
    question: str
    question_type: Literal["mcq", "spoken", "explain", "reasoning", "step_by_step"]
    options: list[str] = Field(default_factory=list)
    difficulty: str = "medium"


class ScoreSummary(BaseModel):
    points_earned: int = Field(ge=0)
    points_possible: int = Field(ge=0)
    points_per_question: Literal[100] = 100
    answered_questions: int = Field(ge=0)
    total_questions: int = Field(ge=0)
    skipped_questions: int = Field(ge=0)
    assisted_questions: int = Field(ge=0)


class QuizInteractionView(BaseModel):
    final_summary: str | None = None
    score_summary: ScoreSummary | None = None
    score_presentation: Literal["session_total", "legacy_item_only"] = "legacy_item_only"
    policy_version: Literal[1, 2] = 1
    question_state: Literal["answering", "review", "complete"] = "answering"
    available_actions: list[Literal["answer", "hint", "advance"]] = Field(
        default_factory=lambda: ["answer"]
    )
    current_question: QuizQuestionOut | None = None
    review_question: QuizQuestionOut | None = None
    last_review: str | None = None
    hint_text: str | None = None


class QuizActionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action_id: uuid.UUID
    question_id: uuid.UUID
    action: Literal["hint", "advance"]


class QuizStartResponse(QuizInteractionView):
    quiz_session_id: uuid.UUID
    first_question: QuizQuestionOut
    total_questions: int


class QuizSubmitRequest(BaseModel):
    quiz_session_id: uuid.UUID
    question_id: uuid.UUID
    submission_id: uuid.UUID
    student_answer: str = Field(min_length=1, max_length=4000)
    response_latency_ms: int | None = Field(default=None, ge=0, le=3600000, strict=True)

    @field_validator("student_answer", mode="before")
    @classmethod
    def trim_answer(cls, value):
        return value.strip() if isinstance(value, str) else value


class QuizSubmitResponse(QuizInteractionView):
    score: float = Field(ge=0.0, le=1.0)
    is_correct: bool
    feedback: str
    next_question: QuizQuestionOut | None = None
    quiz_complete: bool = False
    final_summary: str | None = None
    cumulative_score: float = 0.0


class QuizRecoveryResponse(QuizInteractionView):
    quiz_session_id: uuid.UUID
    kind: Literal["assessment", "tutor"] = "assessment"
    status: Literal["in_progress", "completed"]
    class_id: uuid.UUID | None = None
    material_id: uuid.UUID | None = None
    material_title: str | None = None
    language: Literal["id", "en"] = "id"
    total_questions: int
    answered_questions: int
    current_question: QuizQuestionOut | None = None
    last_result: QuizSubmitResponse | None = None
    started_at: datetime


class QuizSessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    student_id: uuid.UUID
    started_at: datetime
    ended_at: datetime | None
    total_questions: int
    correct_count: int
    final_score: float | None
    status: str

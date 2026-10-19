"""Material-led Tutor sessions; mini quizzes are distinct from assignments."""

import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from models.quiz import QuizRecoveryResponse


class LearningStart(BaseModel):
    model_config = ConfigDict(extra="forbid")
    class_id: uuid.UUID
    material_id: uuid.UUID
    language: Literal["id", "en"] = "id"


class LearningAction(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    request_id: uuid.UUID
    revision: int = Field(ge=0, strict=True)
    action: Literal["question", "continue", "repeat", "quiz", "check", "finish", "self_explain"]
    text: str | None = Field(default=None, min_length=1, max_length=4000)
    language: Literal["id", "en"] = "id"

    @model_validator(mode="after")
    def validate_question(self):
        if self.action == "self_explain" and len(self.text or "") < 20:
            raise ValueError("Jelaskan pemahamanmu sedikit lebih rinci, minimal 20 karakter.")
        if self.action in {"question", "self_explain"} and not self.text:
            raise ValueError("Tuliskan pertanyaan terlebih dahulu.")
        if self.action not in {"question", "self_explain"} and self.text is not None:
            raise ValueError("Teks hanya dikirim untuk pertanyaan.")
        return self


class LearningOut(BaseModel):
    scope: Literal["full_material", "planned_review", "self_explain"] = "full_material"
    learning_progress: dict | None = None
    session_id: uuid.UUID
    revision: int
    phase: Literal["learning", "quiz", "completed"]
    class_id: uuid.UUID
    material_id: uuid.UUID
    material_title: str
    subject: str
    source_filename: str | None = None
    language: Literal["id", "en"]
    unit_index: int
    total_units: int
    unit_title: str | None = None
    unit_titles: list[str | None]
    text: str
    available_actions: list[str]
    quiz: QuizRecoveryResponse | None = None


class UnitIdentity(BaseModel):
    base_id: str
    unit_id: str
    content_hash: str


class LearningUnitManifest(BaseModel):
    content_version: int
    partitioner_version: str
    unit_manifest_hash: str
    units: list[UnitIdentity]

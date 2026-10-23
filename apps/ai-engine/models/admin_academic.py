"""
Pydantic schemas for Admin Academic Management (Classrooms & Subjects).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class AdminClassOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    subject: str
    subject_id: uuid.UUID | None = None
    description: str = ""
    is_archived: bool = False
    teacher_id: uuid.UUID
    teacher_name: str
    teacher_username: str
    member_count: int = 0
    material_count: int = 0
    assignment_count: int = 0
    created_at: datetime


class AdminCreateClassRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    name: str = Field(min_length=1, max_length=120)
    subject_id: uuid.UUID | None = None
    subject: str | None = Field(default=None, max_length=120)
    teacher_id: uuid.UUID
    description: str = Field(default="", max_length=2000)
    is_archived: bool = False


class AdminUpdateClassRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=120)
    subject_id: uuid.UUID | None = None
    subject: str | None = Field(default=None, max_length=120)
    teacher_id: uuid.UUID | None = None
    description: str | None = Field(default=None, max_length=2000)
    is_archived: bool | None = None


class AdminSubjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str | None = None
    created_by: uuid.UUID | None = None
    creator_name: str | None = None
    class_count: int = 0
    concept_count: int = 0
    document_count: int = 0
    quiz_count: int = 0
    created_at: datetime


class AdminCreateSubjectRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default="", max_length=2000)


class AdminUpdateSubjectRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)

"""
KODMOD AI - Student Self-Service Routes
=======================================

- GET /student/me/profile  -> the signed-in student's learning profile

Account fields (name, language, password) are edited through `/auth/me`.
This module is only about learning state.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from analytics.progress_projection import public_progress
from api.dependencies import db_session, require_student
from database.models import User
from memory.long_term import load_profile
from models.user import UserOut

logger = logging.getLogger(__name__)
router = APIRouter(tags=["student"])


@router.get("/me/profile")
async def my_profile(
    student: User = Depends(require_student), session: AsyncSession = Depends(db_session)
) -> dict:
    """Account details plus mastery, weak concepts, and the practice streak."""
    # MasteryScore is a mixed internal snapshot. Assignment outcomes can reach
    # it before the teacher releases them, so the student-facing profile must
    # use the same release-aware evidence projection as the Progress page.
    public, _ = await public_progress(session, student.id)
    profile = await load_profile(student.id)
    mastery = {item["concept_id"]: item["mastery"] for item in public["concept_evidence"]}
    weak = [
        {"concept_id": item["concept_id"], "mastery": item["mastery"]}
        for item in public["weak_concepts"]
    ]

    return {
        "account": UserOut.model_validate(student).model_dump(mode="json"),
        "overall_mastery": public["overall_mastery"],
        "mastery": mastery,
        "weak_concepts": weak,
        "streak_days": profile.get("streak_days", 0),
    }

"""
KODMOD AI - Analytics Routes
============================

- GET /analytics/me                      -> the signed-in student's own rollup
- GET /analytics/me/spoken               -> the same, as a short spoken summary
- GET /analytics/student/{id}            -> self, or a teacher's enrolled student
- GET /analytics/cohort                  -> active classroom students (teacher only)
- GET /analytics/cohort/alerts           -> cohort alerts plus per-student rows
"""

from __future__ import annotations

import uuid
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from analytics.aggregator import CohortAggregator, StudentAggregator
from analytics.insights import generate_cohort_alerts, generate_student_spoken_summary
from api.dependencies import current_user, db_session, require_student, require_teacher
from api.teacher_access import require_teacher_student
from database.models import User

router = APIRouter(tags=["analytics"])

Window = Literal["today", "week", "month", "all"]


def valid_timezone(value):
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(422, "Zona waktu tidak valid.") from None
    return value


@router.get("/me")
async def my_analytics(
    window: Window = Query(default="week"),
    timezone: str = Query(default="UTC", max_length=80),
    student: User = Depends(require_student),
) -> dict:
    """Your own progress: mastery, quiz accuracy, engagement, misconceptions."""
    return await StudentAggregator().summarise(
        student_id=student.id, window=window, timezone=valid_timezone(timezone)
    )


@router.get("/me/spoken")
async def my_analytics_spoken(
    window: Window = Query(default="week"),
    timezone: str = Query(default="UTC", max_length=80),
    student: User = Depends(require_student),
) -> dict:
    """Your own progress, plus a few sentences written to be heard."""
    summary = await StudentAggregator().summarise(
        student_id=student.id, window=window, timezone=valid_timezone(timezone)
    )
    return {
        "summary": summary,
        "spoken": generate_student_spoken_summary(summary, language=student.preferred_language),
    }


@router.get("/student/{student_id}")
async def student_analytics(
    student_id: uuid.UUID,
    window: Window = Query(default="week"),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(db_session),
) -> dict:
    """A student reads their own rollup; a teacher needs classroom membership."""
    if user.role != "teacher" and user.id != student_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only view your own analytics.")
    if user.role == "teacher":
        await require_teacher_student(session, user.id, student_id)
    return await StudentAggregator().summarise(student_id=student_id, window=window)


@router.get("/cohort")
async def cohort_analytics(
    window: Window = Query(default="week"),
    teacher: User = Depends(require_teacher),
) -> dict:
    """Averages and weakest concepts across this teacher's active classrooms."""
    return await CohortAggregator().summarise(window=window, teacher_id=teacher.id)


@router.get("/cohort/alerts")
async def cohort_alerts(
    window: Window = Query(default="week"),
    teacher: User = Depends(require_teacher),
) -> dict:
    """Cohort-level alerts, plus the rollup they were derived from."""
    rollup = await CohortAggregator().summarise(window=window, teacher_id=teacher.id)
    return {
        "alerts": generate_cohort_alerts(rollup, language=teacher.preferred_language),
        "summary": rollup,
    }

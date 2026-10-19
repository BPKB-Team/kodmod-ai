"""Adaptive quiz REST endpoints with durable, transactional submissions."""

from __future__ import annotations

import logging
import uuid

from database.models import User
from database.session import async_session
from fastapi import APIRouter, Depends, HTTPException, Request
from models.quiz import (
    QuizActionRequest,
    QuizInteractionView,
    QuizRecoveryResponse,
    QuizStartRequest,
    QuizStartResponse,
    QuizSubmitRequest,
    QuizSubmitResponse,
)

from api.assessment_service import (
    active_assessments,
    recover_assessment,
    start_assessment,
    submit_assessment,
)
from api.dependencies import require_student

log = logging.getLogger(__name__)
router = APIRouter(tags=["quiz"])


@router.get("/active", response_model=list[QuizRecoveryResponse])
async def active_quizzes(student: User = Depends(require_student)):
    """List the student independent assessments that can be resumed."""
    async with async_session() as session:
        return await active_assessments(session, student)


@router.get("/sessions/{session_id}", response_model=QuizRecoveryResponse)
async def recover_quiz(session_id: uuid.UUID, student: User = Depends(require_student)):
    """Recover the owned durable assessment question and accepted progress."""
    async with async_session() as session:
        return await recover_assessment(session, student, session_id)


@router.post("/start", response_model=QuizStartResponse)
async def start_quiz(
    request: Request, body: QuizStartRequest, student: User = Depends(require_student)
):
    """Create and commit an owned adaptive quiz before returning its first question."""
    try:
        async with async_session() as session:
            response = await start_assessment(session, request.app.state.graph, student, body)
        return response
    except HTTPException:
        raise
    except Exception:
        log.exception("Could not create assessment session")
        raise HTTPException(503, "Latihan belum dapat disiapkan. Coba lagi.") from None


@router.post("/submit", response_model=QuizSubmitResponse)
async def submit_answer(
    request: Request, body: QuizSubmitRequest, student: User = Depends(require_student)
):
    """Accept one answer atomically or replay the same committed submission result."""
    try:
        async with async_session() as session:
            response = await submit_assessment(session, request.app.state.graph, student, body)
        return response
    except HTTPException:
        raise
    except Exception:
        log.exception("Could not accept assessment submission %s", body.submission_id)
        raise HTTPException(
            503, "Hasil belum dapat dipastikan. Kirim ulang jawaban yang sama."
        ) from None


async def _load_mastery(student_id: str) -> tuple[dict, dict]:
    """Compatibility helper for other graph entry points."""
    from analytics.student_model import StudentModel

    model = await StudentModel.load(student_id)
    return await model.mastery_scores(), dict(model._confidence)


@router.post("/{session_id}/actions", response_model=QuizInteractionView)
async def quiz_action(
    session_id: uuid.UUID,
    body: QuizActionRequest,
    student: User = Depends(require_student),
):
    from api.quiz_actions import apply_quiz_action

    try:
        async with async_session() as session:
            return await apply_quiz_action(session, student, session_id, body)
    except HTTPException:
        raise
    except Exception:
        log.exception("Could not accept quiz action %s", body.action_id)
        raise HTTPException(
            503, "Aksi belum dapat dipastikan. Kirim ulang aksi yang sama."
        ) from None

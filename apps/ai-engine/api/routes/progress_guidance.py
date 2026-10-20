"""Self-only progress guidance and revision-checked plan actions."""

import uuid

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from api.dependencies import db_session, require_student
from api.progress_guidance_service import guidance, refresh_guidance, step_action
from api.routes.analytics import valid_timezone
from models.progress_guidance import GuidanceRefreshRequest, PlanStepActionRequest

router = APIRouter(tags=["progress guidance"])


@router.get("/me/guidance", summary="Read the student's progress guidance")
async def read_guidance(
    timezone: str = "UTC", student=Depends(require_student), session=Depends(db_session)
):
    """Read current insights and a saved learning plan without creating a job."""
    return await guidance(session, student, timezone=valid_timezone(timezone))


@router.post("/me/guidance/refresh", summary="Refresh the student's learning plan")
async def refresh(
    body: GuidanceRefreshRequest, student=Depends(require_student), session=Depends(db_session)
):
    """Queue an idempotent plan refresh for evidence visible to this student."""
    valid_timezone(body.timezone)
    result, status = await refresh_guidance(session, student, body)
    await session.commit()
    return JSONResponse(result, status_code=status)


@router.post(
    "/me/plans/{plan_id}/steps/{step_id}/start",
    summary="Start a validated learning-plan step",
)
async def start(
    plan_id: uuid.UUID,
    step_id: uuid.UUID,
    body: PlanStepActionRequest,
    request: Request,
    student=Depends(require_student),
    session=Depends(db_session),
):
    """Revalidate the plan target and return its server-built destination."""
    result = await step_action(
        session, request.app.state.graph, student, plan_id, step_id, body, action="start"
    )
    await session.commit()
    return result


@router.post(
    "/me/plans/{plan_id}/steps/{step_id}/skip",
    summary="Skip a learning-plan step",
)
async def skip(
    plan_id: uuid.UUID,
    step_id: uuid.UUID,
    body: PlanStepActionRequest,
    request: Request,
    student=Depends(require_student),
    session=Depends(db_session),
):
    """Skip one pending step without recording points or mastery evidence."""
    result = await step_action(
        session, request.app.state.graph, student, plan_id, step_id, body, action="skip"
    )
    await session.commit()
    return result

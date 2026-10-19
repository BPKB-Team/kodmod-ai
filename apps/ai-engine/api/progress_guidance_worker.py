"""Run the Planner outside learner locks; publish only a current, fenced snapshot."""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from analytics.progress_guidance import build_guidance_snapshot
from api import durable_jobs as jobs
from api.progress_guidance_service import ensure_plan_job, publish_plan
from database.models import BackgroundJob, LearningPlan, User
from database.session import async_session
from graphs.progress_planning import build_progress_planning_graph

planning_graph = build_progress_planning_graph()


async def process_progress_plan(job):
    student_id = uuid.UUID(job.payload["student_id"])
    async with async_session() as session:
        student = await session.get(User, student_id)
        plan = await session.get(LearningPlan, job.target_id)
        if not student or not student.is_active or not plan or plan.status != "active":
            return {"cancelled": True}
        snapshot = await build_guidance_snapshot(
            session, student=student, timezone=job.payload["timezone"]
        )
        if (
            snapshot.source_snapshot_hash != job.payload["snapshot_hash"]
            or student.preferred_language != job.payload["language"]
        ):
            await ensure_plan_job(session, student.id, snapshot, cycle_id=plan.cycle_id)
            await session.commit()
            return {"stale": True}
        await jobs.assert_lease(session, job.id, job.lease_token)
        await session.commit()
    # No SQL transaction or learner lock remains while this one bounded call runs.
    result = await planning_graph.ainvoke(
        {"snapshot": snapshot, "language": job.payload["language"]}
    )
    async with async_session() as session:
        await session.scalar(select(User.id).where(User.id == student_id).with_for_update())
        student = await session.get(User, student_id)
        plan = await session.scalar(
            select(LearningPlan).where(LearningPlan.id == job.target_id).with_for_update()
        )
        await jobs.assert_lease(session, job.id, job.lease_token)
        if not plan or plan.status != "active":
            return {"cancelled": True}
        current = await build_guidance_snapshot(
            session, student=student, timezone=job.payload["timezone"]
        )
        if (
            current.source_snapshot_hash != snapshot.source_snapshot_hash
            or student.preferred_language != job.payload["language"]
        ):
            await ensure_plan_job(session, student_id, current, cycle_id=plan.cycle_id)
            await session.commit()
            return {"stale": True}
        await publish_plan(session, student, plan, current, result["plan"])
        # Plan, recommendation projection and job receipt commit together.
        row = await session.get(BackgroundJob, job.id)
        row.state, row.result = "complete", {"plan_id": str(plan.id), "revision": plan.revision}
        row.lease_token, row.lease_expires_at = None, None
        await session.commit()
        return {"plan_id": str(plan.id), "revision": plan.revision}


async def reconcile_due_plans():
    """Cheap, bounded SQL outbox sweep also notices scheduled feedback release."""
    now = datetime.now(UTC)
    async with async_session() as session:
        plans = (
            await session.scalars(
                select(LearningPlan)
                .where(LearningPlan.status == "active", LearningPlan.next_check_at <= now)
                .order_by(LearningPlan.next_check_at)
                .limit(3)
                .with_for_update(skip_locked=True)
            )
        ).all()
        for plan in plans:
            student = await session.get(User, plan.student_id)
            if student and student.is_active:
                snapshot = await build_guidance_snapshot(
                    session, student=student, timezone=plan.timezone
                )
                if snapshot.source_snapshot_hash != plan.source_snapshot_hash:
                    await ensure_plan_job(session, student.id, snapshot, cycle_id=plan.cycle_id)
            plan.next_check_at = now + timedelta(minutes=1)
        await session.commit()

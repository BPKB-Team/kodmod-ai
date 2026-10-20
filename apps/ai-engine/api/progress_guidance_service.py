"""Durable, self-only plans. GET derives public facts but never writes or calls AI."""

import hashlib
import json
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import select, update

from agents.planner_agent import fallback_plan
from agents.recommendation_agent import recommendations_from_plan
from analytics.progress_guidance import (
    build_guidance_snapshot,
    derive_progress_insights,
    substantive,
)
from api.durable_jobs import enqueue
from api.learning_content import material_learning_units
from api.learning_progress import canonical_manifest
from api.material_service import resolve_tutoring_context
from database.models import (
    BackgroundJob,
    ClassMaterial,
    LearningPlan,
    LearningPlanStep,
    PlanActionReceipt,
    Recommendation,
    User,
)
from models.progress_guidance import PlanCandidate, ValidatedPlan


def stamp(body, scope):
    return hashlib.sha256(
        json.dumps(
            {"scope": scope, "body": body.model_dump(mode="json", exclude={"request_id"})},
            sort_keys=True,
        ).encode()
    ).hexdigest()


async def latest_plan(session, student_id):
    return await session.scalar(
        select(LearningPlan)
        .where(
            LearningPlan.student_id == student_id, LearningPlan.status.in_(["active", "completed"])
        )
        .order_by(LearningPlan.created_at.desc())
        .limit(1)
    )


async def require_target(session, student, target, *, versions=True):
    from api.learning_service import learning_units

    candidate = PlanCandidate.model_validate(target)
    context = await resolve_tutoring_context(
        session,
        uuid.UUID(candidate.class_id),
        uuid.UUID(candidate.material_id),
        student,
        require_ready=versions,
    )
    material = await session.get(ClassMaterial, uuid.UUID(candidate.material_id))
    if versions:
        manifest = canonical_manifest(material)
        units = material_learning_units(material)
        if (
            material.content_version != candidate.content_version
            or material.mapping_version != candidate.mapping_version
            or manifest.unit_manifest_hash != candidate.unit_manifest_hash
            or candidate.unit_index >= len(manifest.units)
            or manifest.units[candidate.unit_index].unit_id != candidate.unit_id
            or not substantive(units[candidate.unit_index]["text"])
        ):
            raise HTTPException(
                409, "Target belajar berubah. Perbarui rencana dari halaman Progres."
            )
        if candidate.concept_id and candidate.concept_id not in {
            c["id"] for c in context["approved_material_concepts"]
        }:
            raise HTTPException(409, "Pemetaan konsep berubah. Perbarui rencana belajar.")
    return candidate, material


async def plan_view(session, student, plan, snapshot):
    rows = (
        await session.scalars(
            select(LearningPlanStep)
            .where(LearningPlanStep.plan_id == plan.id, LearningPlanStep.status != "invalidated")
            .order_by(LearningPlanStep.order_index, LearningPlanStep.id)
        )
    ).all()
    steps, focus = [], None
    for row in rows:
        try:
            candidate, _ = await require_target(session, student, row.target)
        except (HTTPException, ValueError):
            steps.append(
                {
                    "id": str(row.id),
                    "status": "invalidated",
                    "kind": row.target.get("kind"),
                    "title": "Material unavailable"
                    if student.preferred_language == "en"
                    else "Materi tidak tersedia",
                    "body": "",
                    "reason_text": "",
                    "estimated_minutes": 0,
                    "href": None,
                }
            )
            continue
        expanded = snapshot.model_copy(update={"candidates": [candidate]})
        rendered = recommendations_from_plan(
            ValidatedPlan(
                goal_candidate_id=candidate.candidate_id,
                step_candidate_ids=[candidate.candidate_id],
                reason_fact_ids=plan.reason_fact_ids or [],
            ),
            expanded,
            student.preferred_language,
        )[0].model_dump()
        item = {**rendered, "id": str(row.id), "kind": candidate.kind, "status": row.status}
        steps.append(item)
        if (
            row.status == "in_progress" and (focus is None or focus["status"] != "in_progress")
        ) or (focus is None and row.status == "pending"):
            focus = item
    return {
        "id": str(plan.id),
        "cycle_id": str(plan.cycle_id),
        "revision": plan.revision,
        "status": plan.status,
        "source_snapshot_hash": plan.source_snapshot_hash,
        "used_fallback": plan.used_fallback,
        "steps": steps,
    }, focus


async def guidance(session, student, *, timezone="UTC"):
    snapshot = await build_guidance_snapshot(session, student=student, timezone=timezone)
    plan = await latest_plan(session, student.id)
    view, focus = await plan_view(session, student, plan, snapshot) if plan else (None, None)
    job = (
        await session.scalar(
            select(BackgroundJob)
            .where(BackgroundJob.kind == "progress_plan", BackgroundJob.target_id == plan.id)
            .order_by(BackgroundJob.created_at.desc())
            .limit(1)
        )
        if plan
        else None
    )
    if not focus and (not plan or plan.status != "completed"):
        choices = recommendations_from_plan(
            fallback_plan(snapshot), snapshot, student.preferred_language
        )
        focus = choices[0].model_dump() if choices else None
    ready = (
        plan and plan.revision > 0 and plan.source_snapshot_hash == snapshot.source_snapshot_hash
    )
    state = (
        "completed"
        if plan and plan.status == "completed"
        else "updating"
        if job and job.state in {"pending", "running", "retry"}
        else "ready"
        if ready
        else "stale"
        if plan
        else "idle"
    )
    if not snapshot.candidates and not focus:
        state = "no_available_material"
    return {
        "status": state,
        "timezone": snapshot.timezone,
        "updating": bool(job and job.state in {"pending", "running", "retry"}),
        "as_of": snapshot.as_of.isoformat(),
        "source_snapshot_hash": snapshot.source_snapshot_hash,
        "planning_window": snapshot.planning_window,
        "insights": [
            i.model_dump()
            for i in derive_progress_insights(snapshot, language=student.preferred_language)
        ],
        "focus": focus,
        "plan": view,
        "needs_refresh": not ready and state != "completed",
        "empty_action": {
            "href": "/siswa/kelas",
            "label": "Choose a class or ask your teacher"
            if student.preferred_language == "en"
            else "Pilih kelas atau hubungi guru",
        },
    }


async def ensure_plan_job(session, student_id, snapshot, *, cycle_id):
    plan = await session.scalar(
        select(LearningPlan).where(
            LearningPlan.student_id == student_id,
            LearningPlan.cycle_id == cycle_id,
            LearningPlan.status == "active",
        )
    )
    if plan is None:
        return None
    student = await session.get(User, student_id)
    language = student.preferred_language
    return await enqueue(
        session,
        "progress_plan",
        plan.id,
        {
            "student_id": str(student_id),
            "plan_id": str(plan.id),
            "snapshot_hash": snapshot.source_snapshot_hash,
            "timezone": snapshot.timezone,
            "language": language,
        },
        f"plan:{student_id}:{cycle_id}:{snapshot.source_snapshot_hash}:{snapshot.policy_version}:{snapshot.prompt_version}:{language}",
        max_attempts=1,
    )


async def refresh_guidance(session, student, body):
    await session.scalar(select(User.id).where(User.id == student.id).with_for_update())
    fingerprint = stamp(body, "refresh")
    receipt = await session.get(PlanActionReceipt, body.request_id)
    if receipt:
        if receipt.student_id != student.id or receipt.request_fingerprint != fingerprint:
            raise HTTPException(409, "ID tindakan sudah digunakan.")
        return receipt.response_payload, 202 if receipt.response_payload[
            "status"
        ] == "updating" else 200
    snapshot = await build_guidance_snapshot(session, student=student, timezone=body.timezone)
    plan = await latest_plan(session, student.id)
    if body.expected_revision != (plan.revision if plan else 0):
        raise HTTPException(409, "Rencana telah berubah. Muat ulang Progres.")
    if not plan or plan.status == "completed":
        plan = LearningPlan(
            student_id=student.id,
            source_snapshot_hash="",
            timezone=body.timezone,
            language=student.preferred_language,
        )
        session.add(plan)
        await session.flush()
    plan.timezone, plan.language = body.timezone, student.preferred_language
    job = await ensure_plan_job(session, student.id, snapshot, cycle_id=plan.cycle_id)
    if job.state == "failed":
        await publish_plan(session, student, plan, snapshot, fallback_plan(snapshot))
        job.state, job.result = "complete", {"fallback": True, "plan_id": str(plan.id)}
    ready = plan.revision > 0 and plan.source_snapshot_hash == snapshot.source_snapshot_hash
    payload = {
        "status": "ready" if ready else "updating",
        "job_id": str(job.id),
        "plan_id": str(plan.id),
        "revision": plan.revision,
    }
    session.add(
        PlanActionReceipt(
            id=body.request_id,
            student_id=student.id,
            plan_id=plan.id,
            request_fingerprint=fingerprint,
            response_payload=payload,
        )
    )
    await session.flush()
    return payload, 200 if ready else 202


async def publish_plan(session, student, plan, snapshot, proposal):
    rows = (
        await session.scalars(
            select(LearningPlanStep)
            .where(LearningPlanStep.plan_id == plan.id)
            .order_by(LearningPlanStep.order_index, LearningPlanStep.id)
            .with_for_update()
        )
    ).all()
    plan.history = [
        *(plan.history or []),
        {
            "revision": plan.revision,
            "snapshot_hash": plan.source_snapshot_hash,
            "steps": [
                {"id": str(s.id), "status": s.status, "candidate_id": s.candidate_id} for s in rows
            ],
        },
    ]
    preserved = []
    for row in rows:
        if row.status in {"completed", "skipped"}:
            preserved.append(row)
        elif row.status == "in_progress":
            try:
                await require_target(session, student, row.target)
                preserved.append(row)
            except HTTPException:
                row.status = "invalidated"
    candidates = {c.candidate_id: c for c in snapshot.candidates}
    used = {s.candidate_id for s in preserved}
    selected = [candidates[i] for i in proposal.step_candidate_ids if i not in used][
        : max(0, 3 - len(preserved))
    ]
    retained = set()
    for order, candidate in enumerate(selected, start=len(preserved)):
        row = next(
            (s for s in rows if s.candidate_id == candidate.candidate_id and s.status == "pending"),
            None,
        )
        if row is None:
            row = LearningPlanStep(
                plan_id=plan.id,
                order_index=order,
                candidate_id=candidate.candidate_id,
                target=candidate.model_dump(),
            )
            session.add(row)
        row.order_index = order
        retained.add(row.id)
    for row in rows:
        if row.status == "pending" and row.id not in retained:
            row.status = "invalidated"
    for order, row in enumerate(preserved):
        row.order_index = order
    plan.goal = preserved[0].target if preserved else selected[0].model_dump() if selected else None
    plan.reason_fact_ids = proposal.reason_fact_ids
    plan.source_snapshot_hash, plan.used_fallback = (
        snapshot.source_snapshot_hash,
        proposal.used_fallback,
    )
    plan.timezone, plan.language = snapshot.timezone, student.preferred_language
    plan.policy_version, plan.prompt_version = snapshot.policy_version, snapshot.prompt_version
    plan.revision += 1
    plan.updated_at, plan.next_check_at = (
        datetime.now(UTC),
        datetime.now(UTC) + timedelta(minutes=1),
    )
    await session.flush()
    await finish_plan_if_done(session, plan)
    await project_recommendations(session, student, plan, snapshot)


async def finish_plan_if_done(session, plan):
    rows = (
        await session.scalars(
            select(LearningPlanStep).where(
                LearningPlanStep.plan_id == plan.id, LearningPlanStep.status != "invalidated"
            )
        )
    ).all()
    if rows and all(s.status in {"completed", "skipped"} for s in rows):
        plan.status = "completed"
        await session.execute(
            update(Recommendation).where(Recommendation.plan_id == plan.id).values(consumed=True)
        )


async def project_recommendations(session, student, plan, snapshot):
    await session.execute(
        update(Recommendation).where(Recommendation.plan_id == plan.id).values(consumed=True)
    )
    if plan.status != "active":
        return
    view, _ = await plan_view(session, student, plan, snapshot)
    for index, step in enumerate(view["steps"]):
        if step["status"] in {"pending", "in_progress"}:
            session.add(
                Recommendation(
                    student_id=student.id,
                    plan_id=plan.id,
                    plan_step_id=uuid.UUID(step["id"]),
                    kind="practice" if step["kind"] == "practice" else "next_lesson",
                    title=step["title"],
                    body=f"{step['body']} {step['reason_text']}",
                    priority=index + 1,
                    expires_at=datetime.now(UTC) + timedelta(days=1),
                )
            )


async def step_action(session, graph, student, plan_id, step_id, body, *, action):
    await session.scalar(select(User.id).where(User.id == student.id).with_for_update())
    plan = await session.scalar(
        select(LearningPlan)
        .where(LearningPlan.id == plan_id, LearningPlan.student_id == student.id)
        .with_for_update()
    )
    step = (
        await session.scalar(
            select(LearningPlanStep)
            .where(LearningPlanStep.id == step_id, LearningPlanStep.plan_id == plan_id)
            .with_for_update()
        )
        if plan
        else None
    )
    if not plan or not step:
        raise HTTPException(404, "Langkah belajar tidak ditemukan.")
    if action == "start":
        await require_target(session, student, step.target, versions=False)
    fingerprint = stamp(body, f"{action}:{plan_id}:{step_id}")
    receipt = await session.get(PlanActionReceipt, body.request_id)
    if receipt:
        if receipt.student_id != student.id or receipt.request_fingerprint != fingerprint:
            raise HTTPException(409, "ID tindakan sudah digunakan.")
        return receipt.response_payload
    if (
        plan.status != "active"
        or plan.revision != body.expected_revision
        or step.status not in {"pending", "in_progress"}
    ):
        raise HTTPException(409, "Rencana telah berubah. Muat ulang Progres.")
    if action == "skip":
        step.status, step.completed_at = "skipped", datetime.now(UTC)
        payload = {"status": "skipped", "revision": plan.revision + 1}
    else:
        candidate, material = await require_target(session, student, step.target)
        if step.session_id is None:
            if candidate.kind == "practice":
                from api.assessment_service import start_assessment
                from api.learning_service import learning_units
                from models.quiz import QuizStartRequest

                unit = material_learning_units(material)[candidate.unit_index]
                quiz = await start_assessment(
                    session,
                    graph,
                    student,
                    QuizStartRequest(
                        class_id=uuid.UUID(candidate.class_id),
                        material_id=material.id,
                        n_questions=1,
                        language=student.preferred_language,
                    ),
                    source_docs=[
                        {
                            "text": unit["text"],
                            "source": material.source_filename or material.title,
                            "material_id": str(material.id),
                            "class_id": candidate.class_id,
                        }
                    ],
                )
                step.session_id = quiz.quiz_session_id
            else:
                from api.learning_service import start_planned_lesson

                lesson = await start_planned_lesson(session, student, material, candidate)
                step.session_id = lesson.id
        step.status, step.started_at = "in_progress", step.started_at or datetime.now(UTC)
        payload = {
            "status": "in_progress",
            "revision": plan.revision + 1,
            "session_id": str(step.session_id),
            "destination": f"/siswa/{'latihan' if candidate.kind == 'practice' else 'tutor'}?session_id={step.session_id}",
        }
    plan.revision += 1
    await session.flush()
    await finish_plan_if_done(session, plan)
    if step.status == "skipped":
        await session.execute(
            update(Recommendation)
            .where(Recommendation.plan_step_id == step.id)
            .values(consumed=True)
        )
    session.add(
        PlanActionReceipt(
            id=body.request_id,
            student_id=student.id,
            plan_id=plan.id,
            request_fingerprint=fingerprint,
            response_payload=payload,
        )
    )
    await session.flush()
    return payload


async def queue_plan_refresh(session, student_id):
    plan = await session.scalar(
        select(LearningPlan).where(
            LearningPlan.student_id == student_id, LearningPlan.status == "active"
        )
    )
    if plan is None:
        return
    await session.flush()
    student = await session.get(User, student_id)
    snapshot = await build_guidance_snapshot(session, student=student, timezone=plan.timezone)
    if snapshot.source_snapshot_hash != plan.source_snapshot_hash:
        await ensure_plan_job(session, student_id, snapshot, cycle_id=plan.cycle_id)


async def queue_affected_plans(session, class_id):
    from database.models import Enrollment

    ids = (
        await session.scalars(
            select(LearningPlan.student_id)
            .join(Enrollment, Enrollment.student_id == LearningPlan.student_id)
            .where(LearningPlan.status == "active", Enrollment.class_id == class_id)
        )
    ).all()
    for student_id in set(ids):
        await queue_plan_refresh(session, student_id)


async def apply_plan_learning_event(session, *, receipt_id, student_id):
    from database.models import (
        LearningActionReceipt,
        LearningSession,
        QuizActionReceipt,
        QuizSession,
    )

    plan = await session.scalar(
        select(LearningPlan)
        .where(LearningPlan.student_id == student_id, LearningPlan.status == "active")
        .with_for_update()
    )
    if plan is None:
        return
    quiz_receipt = await session.get(QuizActionReceipt, receipt_id)
    lesson_receipt = (
        await session.get(LearningActionReceipt, receipt_id) if quiz_receipt is None else None
    )
    session_id = None
    if (
        quiz_receipt
        and quiz_receipt.student_id == student_id
        and quiz_receipt.response_payload.get("question_state") == "complete"
    ):
        quiz = await session.get(QuizSession, quiz_receipt.quiz_session_id)
        if quiz and quiz.student_id == student_id and quiz.status == "completed":
            session_id = quiz.id
    elif lesson_receipt and lesson_receipt.response_payload.get("phase") == "completed":
        lesson = await session.get(LearningSession, lesson_receipt.session_id)
        if lesson and lesson.student_id == student_id and lesson.ended_at:
            session_id = lesson.id
    if session_id:
        steps = (
            await session.scalars(
                select(LearningPlanStep)
                .where(
                    LearningPlanStep.plan_id == plan.id,
                    LearningPlanStep.session_id == session_id,
                    LearningPlanStep.status == "in_progress",
                )
                .with_for_update()
            )
        ).all()
        student = await session.get(User, student_id)
        for step in steps:
            try:
                await require_target(session, student, step.target)
            except HTTPException:
                step.status = "invalidated"
                continue
            step.status, step.completed_at, step.evidence_receipt_id = (
                "completed",
                datetime.now(UTC),
                receipt_id,
            )
            plan.revision += 1
            await session.execute(
                update(Recommendation)
                .where(Recommendation.plan_step_id == step.id)
                .values(consumed=True)
            )
        await session.flush()
        await finish_plan_if_done(session, plan)
    if plan.status == "active":
        await queue_plan_refresh(session, student_id)

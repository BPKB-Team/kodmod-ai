"""Material-led learning, backed by SQL state and retry-safe action receipts."""

from __future__ import annotations

import copy
import hashlib
import json
import re
import uuid
from datetime import UTC, datetime
from itertools import pairwise

from fastapi import HTTPException
from sqlalchemy import select

from api.assessment_service import recover_assessment, start_assessment
from api.learning_content import material_learning_units
from api.learning_progress import (
    active_learning_progress,
    build_unit_manifest,
    canonical_manifest,
    record_learning_unit,
)
from api.material_service import resolve_tutoring_context
from database.models import (
    ClassMaterial,
    InteractionLog,
    LearningActionReceipt,
    LearningSession,
    User,
)
from graphs.guided_learning import build_guided_graph
from graphs.state import build_learning_profile
from models.learning import LearningAction, LearningOut, LearningStart, LearningUnitManifest
from models.quiz import QuizStartRequest

guided_graph = build_guided_graph()


def learning_units(content: str, *, limit: int = 2400) -> list[dict]:
    """Partition reviewed text in order; no loss or invented chapter hierarchy."""
    if not content.strip():
        raise HTTPException(409, "Materi belum memiliki teks yang dapat dipelajari.")
    if limit < 1:
        raise ValueError("Learning unit limit must be positive")
    headings = re.compile(
        r"^[ \t]*(?:#{1,6}[ \t]+\S[^\n]*|"
        r"(?:bab|chapter|bagian|sub[ -]?bab)[ \t]+(?:\d+(?:\.\d+)*|[IVXLCDM]+)\b[^\n]*)$",
        re.I | re.M,
    )
    starts = [0] + [match.start() for match in headings.finditer(content) if match.start() > 0]
    starts.append(len(content))
    units = []
    for start, stop in pairwise(starts):
        first = content[start:stop].strip().split("\n", 1)[0].strip()
        heading = (
            re.sub(r"^#{1,6}\s+", "", first)
            if len(first) <= 110
            and (headings.fullmatch(first) or (first.isupper() and len(first) > 3))
            else None
        )
        position = start
        while position < stop:
            end = min(position + limit, stop)
            if end < stop:
                boundary = content.rfind("\n\n", position + limit // 3, end)
                if boundary < 0:
                    boundary = content.rfind(" ", position + limit // 3, end)
                if boundary >= 0:
                    end = boundary + (2 if content[boundary : boundary + 2] == "\n\n" else 1)
            units.append({"text": content[position:end], "title": heading})
            position = end
    return units


async def owned_lesson(session, sid, student, *, lock=False):
    query = select(LearningSession).where(
        LearningSession.id == sid,
        LearningSession.student_id == student.id,
        LearningSession.guided_state.is_not(None),
    )
    if lock:
        query = query.with_for_update()
    row = await session.scalar(query)
    if row is None:
        raise HTTPException(404, "Sesi belajar tidak ditemukan.")
    await resolve_tutoring_context(session, row.class_id, row.material_id, student)
    material = await session.get(ClassMaterial, row.material_id)
    if material is None or material.content_version != row.guided_state["material_version"]:
        raise HTTPException(409, "Materi telah diperbarui. Mulai sesi dari versi materi terbaru.")
    if build_unit_manifest(material, row.guided_state["units"]) != canonical_manifest(material):
        raise HTTPException(409, "Pembagian materi berubah. Mulai sesi dari versi terbaru.")
    return row, material


async def lesson_out(session, row, student, material=None):
    if material is None:
        row, material = await owned_lesson(session, row.id, student)
    state = row.guided_state
    quiz = (
        await recover_assessment(session, student, uuid.UUID(state["quiz_id"]))
        if state.get("quiz_id")
        else None
    )
    phase = state["phase"]
    if phase == "quiz" and quiz and quiz.status == "completed":
        phase = "learning"
    actions = []
    if phase == "learning":
        actions = ["question", "repeat", "check", "quiz"]
        if state["unit_index"] + 1 < len(state["units"]):
            actions.append("continue")
        else:
            actions.append("finish")
        if state.get("scope") == "planned_review":
            actions = ["question", "repeat", "finish"]
        elif state.get("scope") == "self_explain":
            actions = ["question", "repeat", "self_explain"]
    return LearningOut(
        scope=state.get("scope", "full_material"),
        learning_progress=await active_learning_progress(session, student.id, material),
        session_id=row.id,
        revision=state["revision"],
        phase=phase,
        class_id=row.class_id,
        material_id=row.material_id,
        material_title=material.title,
        subject=state["subject"],
        source_filename=material.source_filename,
        language=state["language"],
        unit_index=state["unit_index"],
        total_units=len(state["units"]),
        unit_title=state["units"][state["unit_index"]]["title"],
        unit_titles=[unit["title"] for unit in state["units"]],
        text=state["text"],
        available_actions=actions,
        quiz=quiz,
    )


def unit_source(row, material, state):
    unit = state["units"][state["unit_index"]]
    from api.learning_content import learning_unit_source

    return learning_unit_source(unit, material, row.class_id)


async def teach(session, row, material, student, state, action, question=""):
    from tools.provider_usage import usage_context

    history = (
        await session.scalars(
            select(InteractionLog)
            .where(InteractionLog.session_id == row.id)
            .order_by(InteractionLog.timestamp.desc())
            .limit(6)
        )
    ).all()
    unit = state["units"][state["unit_index"]]
    with usage_context(
        actor_id=student.id,
        target_id=row.id,
        target_type="learning_session",
        language=state["language"],
    ):
        result = await guided_graph.ainvoke(
            {
                "action": action,
                "question": question,
                "unit_text": unit["text"],
                "unit_title": unit["title"] or "",
                "previous_explanation": state.get("text", ""),
                "history": [{"role": log.role, "text": log.text} for log in reversed(history)],
                "learning_profile": {
                    **build_learning_profile(student),
                    "language": state["language"],
                },
            }
        )
    text = result.get("accessible_response", "").strip()
    if not text:
        raise ValueError("Tutor returned no accessible explanation")
    state["text"] = text
    metadata = {
        "guided_action": action,
        "unit_index": state["unit_index"],
        "material_version": state["material_version"],
        "sources": [{k: v for k, v in unit_source(row, material, state).items() if k != "text"}],
    }
    if question:
        session.add(
            InteractionLog(
                session_id=row.id,
                role="student",
                intent="tutoring",
                text=question,
                metadata_=metadata,
            )
        )
    session.add(
        InteractionLog(
            session_id=row.id, role="assistant", intent="tutoring", text=text, metadata_=metadata
        )
    )


async def start_lesson(session, student, body: LearningStart):
    # Serialize simultaneous start requests for this learner across devices.
    await session.scalar(select(User).where(User.id == student.id).with_for_update())
    context = await resolve_tutoring_context(session, body.class_id, body.material_id, student)
    if context is None:
        raise HTTPException(422, "Pilih kelas dan materi untuk mulai belajar.")
    material = await session.get(ClassMaterial, body.material_id)
    rows = (
        await session.scalars(
            select(LearningSession)
            .where(
                LearningSession.student_id == student.id,
                LearningSession.ended_at.is_(None),
                LearningSession.guided_state.is_not(None),
            )
            .order_by(LearningSession.started_at.desc())
            .limit(50)
        )
    ).all()
    for existing in rows:
        state = existing.guided_state
        if (
            existing.material_id == body.material_id
            and state["material_version"] == material.content_version
        ):
            return await lesson_out(session, existing, student, material)
        if state.get("phase") == "quiz" and state.get("quiz_id"):
            try:
                quiz = await recover_assessment(session, student, uuid.UUID(state["quiz_id"]))
            except HTTPException as error:
                # A withdrawn source stays in the audit trail but must not
                # prevent learning from a different, available material.
                if error.status_code in (403, 404, 409):
                    continue
                raise
            if quiz.status == "in_progress":
                raise HTTPException(
                    409, "Selesaikan mini kuis yang sedang berjalan sebelum mengganti materi."
                )
    state = {
        "revision": 0,
        "phase": "learning",
        "language": body.language,
        "material_version": material.content_version,
        "unit_index": 0,
        "units": material_learning_units(material, require_content=True),
        "text": "",
        "subject": context["subject_name"],
    }
    manifest = build_unit_manifest(material, state["units"])
    state["unit_manifest"] = manifest.model_dump()
    await record_learning_unit(
        session,
        student_id=student.id,
        material=material,
        manifest=manifest,
        completed_unit_id=None,
        finish=False,
    )
    row = LearningSession(
        student_id=student.id,
        class_id=body.class_id,
        material_id=body.material_id,
        title=material.title,
        mode="guided_tutoring",
        # Keep the pre-teaching JSON snapshot independent. Mutating the same
        # dict after flush hides the first explanation from ORM dirty tracking.
        guided_state=copy.deepcopy(state),
    )
    session.add(row)
    await session.flush()
    await teach(session, row, material, student, state, "teach")
    row.guided_state = copy.deepcopy(state)
    await session.flush()
    return await lesson_out(session, row, student, material)


async def apply_learning_action(session, assessment_graph, student, sid, body: LearningAction):
    row, material = await owned_lesson(session, sid, student, lock=True)
    fingerprint = hashlib.sha256(
        json.dumps(
            body.model_dump(mode="json", exclude={"request_id"}), sort_keys=True, ensure_ascii=False
        ).encode()
    ).hexdigest()
    receipt = await session.get(LearningActionReceipt, body.request_id)
    if receipt:
        if receipt.session_id != sid or receipt.request_fingerprint != fingerprint:
            raise HTTPException(409, "ID tindakan sudah digunakan. Muat ulang sesi belajar.")
        return LearningOut.model_validate(receipt.response_payload)
    state = copy.deepcopy(row.guided_state)
    if body.revision != state["revision"]:
        raise HTTPException(
            409, "Sesi telah berubah di perangkat lain. Muat ulang untuk melanjutkan."
        )
    current = await lesson_out(session, row, student, material)
    if body.action not in current.available_actions:
        raise HTTPException(409, "Selesaikan mini kuis terlebih dahulu atau muat ulang sesi.")
    state["language"], state["phase"] = body.language, "learning"
    if body.action in ("continue", "finish"):
        manifest = LearningUnitManifest.model_validate(
            state.get("unit_manifest") or build_unit_manifest(material, state["units"]).model_dump()
        )
        await record_learning_unit(
            session,
            student_id=student.id,
            material=material,
            manifest=manifest,
            completed_unit_id=manifest.units[state["unit_index"]].unit_id,
            finish=body.action == "finish"
            and state.get("scope", "full_material") == "full_material",
        )
    if body.action in ("quiz", "check"):
        started = await start_assessment(
            session,
            assessment_graph,
            student,
            QuizStartRequest(
                class_id=row.class_id,
                material_id=row.material_id,
                language=body.language,
                n_questions=1 if body.action == "check" else 3,
            ),
            kind="tutor",
            source_docs=[unit_source(row, material, state)],
        )
        state["quiz_id"], state["phase"] = str(started.quiz_session_id), "quiz"
    elif body.action in {"finish", "self_explain"}:
        if body.action == "self_explain":
            await teach(session, row, material, student, state, "question", body.text or "")
        row.ended_at, state["phase"] = datetime.now(UTC), "completed"
        row.summary = state["text"]
    else:
        if body.action == "continue":
            state["unit_index"] += 1
            state.pop("quiz_id", None)
        await teach(session, row, material, student, state, body.action, body.text or "")
    state["revision"] += 1
    row.guided_state = state
    await session.flush()
    output = await lesson_out(session, row, student, material)
    session.add(
        LearningActionReceipt(
            id=body.request_id,
            session_id=row.id,
            revision=state["revision"],
            request_fingerprint=fingerprint,
            response_payload=output.model_dump(mode="json"),
        )
    )
    await session.flush()
    from api.progress_guidance_service import apply_plan_learning_event, queue_plan_refresh

    if body.action in {"finish", "self_explain"}:
        await apply_plan_learning_event(session, receipt_id=body.request_id, student_id=student.id)
    elif body.action == "continue":
        await queue_plan_refresh(session, student.id)
    return output


async def start_planned_lesson(session, student, material, candidate):
    """An isolated review session pins the full manifest and never skips another session."""
    from database.models import QuizSession

    active = (
        await session.scalars(
            select(LearningSession).where(
                LearningSession.student_id == student.id, LearningSession.ended_at.is_(None)
            )
        )
    ).all()
    for current in active:
        state = current.guided_state or {}
        if state.get("quiz_id"):
            quiz = await session.get(QuizSession, uuid.UUID(state["quiz_id"]))
            if quiz and quiz.status == "in_progress":
                raise HTTPException(
                    409, "Selesaikan mini kuis yang sedang berjalan terlebih dahulu."
                )
    context = await resolve_tutoring_context(session, material.class_id, material.id, student)
    units = material_learning_units(material, require_content=True)
    state = {
        "revision": 0,
        "phase": "learning",
        "scope": "self_explain" if candidate.kind == "self_explain" else "planned_review",
        "language": student.preferred_language,
        "material_version": material.content_version,
        "unit_index": candidate.unit_index,
        "units": units,
        "unit_manifest": canonical_manifest(material).model_dump(),
        "text": "",
        "subject": context["subject_name"],
    }
    row = LearningSession(
        student_id=student.id,
        class_id=material.class_id,
        material_id=material.id,
        title=material.title,
        mode="guided_tutoring",
        guided_state=copy.deepcopy(state),
    )
    session.add(row)
    await session.flush()
    await teach(session, row, material, student, state, "teach")
    row.guided_state = copy.deepcopy(state)
    await session.flush()
    return row

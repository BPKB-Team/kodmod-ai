"""Canonical assessment operations inside the caller's SQL transaction.

Graph checkpoints are temporary projections, never accepted evidence. Each turn
uses a fresh thread reconstructed from committed state, even after a failed write.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
import uuid
from datetime import UTC, datetime
from typing import Literal, cast

from analytics.student_model import StudentModel
from database.models import (
    AssessmentSubmission,
    ClassMaterial,
    Concept,
    MasteryEvent,
    MasteryScore,
    QuizAttempt,
    QuizQuestion,
    QuizSession,
    User,
)
from fastapi import HTTPException
from graphs.state import KODMODState, build_learning_profile, initial_state
from models.quiz import (
    QuizQuestionOut,
    QuizRecoveryResponse,
    QuizStartRequest,
    QuizStartResponse,
    QuizSubmitRequest,
    QuizSubmitResponse,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.material_service import resolve_tutoring_context

# Durable learning JSON, excluding provider metadata and reducer messages.
STATE_KEYS = (
    "quiz_session_id",
    "quiz_n_questions",
    "quiz_questions",
    "quiz_question",
    "quiz_attempts",
    "current_question_index",
    "current_question_attempts",
    "mastery_applied_attempts",
    "quiz_score",
    "cumulative_quiz_score",
    "current_topic",
    "current_concept_id",
    "current_difficulty",
    "detected_language",
    "subject_id",
    "class_id",
    "material_id",
    "material_version",
    "material_mapping_version",
    "approved_material_concepts",
    "assessment_kind",
    "quiz_policy_version",
    "question_state",
    "last_review",
    "review_question_id",
    "hint_text",
    "hinted_questions",
    "first_answer_assisted",
    "score_summary",
    "quiz_source_docs",
    "tutoring_context",
    "retrieved_docs",
    "mastery_scores",
    "mastery_confidence",
    "learning_profile",
    "analytics_summary",
    "recommendations",
    "accessibility_flags",
    "emotional_state",
    "misconceptions_detected",
)


def snapshot(state: dict) -> dict:
    return json.loads(json.dumps({k: state[k] for k in STATE_KEYS if k in state}, allow_nan=False))


def question_out(question: dict, index: int) -> QuizQuestionOut:
    return QuizQuestionOut(
        question_id=question["question_id"],
        order_index=index,
        question=question.get("text", ""),
        question_type=question.get("type", "spoken"),
        options=question.get("options", []),
        difficulty=question.get("difficulty", "medium"),
    )


def bounded_score(value) -> float:
    score = float(value)
    if not math.isfinite(score) or not 0 <= score <= 1:
        raise ValueError("Invalid assessment score")
    return score


def as_uuid(value) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        return None


async def load_model(session: AsyncSession, student_id: uuid.UUID) -> tuple[StudentModel, dict]:
    rows = list(
        (
            await session.scalars(select(MasteryScore).where(MasteryScore.student_id == student_id))
        ).all()
    )
    model = StudentModel(str(student_id))
    by_concept = {}
    for row in rows:
        cid = str(row.concept_id)
        model._scores[cid], model._confidence[cid], model._attempts[cid] = (
            row.mastery,
            row.confidence,
            row.n_attempts,
        )
        if row.last_seen:
            model._last_practiced[cid] = (
                row.last_seen if row.last_seen.tzinfo else row.last_seen.replace(tzinfo=UTC)
            )
        by_concept[cid] = row
    model.apply_decay()
    return model, by_concept


async def invoke(graph, state: dict, sid: uuid.UUID) -> dict:
    from tools.provider_usage import usage_context

    with usage_context(
        target_id=sid,
        target_type="quiz_session",
        language=state.get("learning_profile", {}).get("language"),
    ):
        return await graph.ainvoke(
            state,
            config={"configurable": {"thread_id": f"assessment:{sid}:{uuid.uuid4()}"}},
        )


async def start_assessment(
    session: AsyncSession,
    graph,
    student: User,
    body: QuizStartRequest,
    *,
    kind: Literal["assessment", "tutor"] = "assessment",
    source_docs: list[dict] | None = None,
) -> QuizStartResponse:
    context = await resolve_tutoring_context(session, body.class_id, body.material_id, student)
    material = await session.get(ClassMaterial, body.material_id) if body.material_id else None
    concept = await session.get(Concept, body.concept_id) if body.concept_id else None
    if body.concept_id and concept is None:
        raise HTTPException(404, "Konsep tidak ditemukan.")
    sid = uuid.uuid4()
    state = initial_state(
        str(sid),
        str(student.id),
        subject_id=str(concept.subject_id) if concept else None,
        class_id=str(body.class_id) if body.class_id else None,
        material_id=str(body.material_id) if body.material_id else None,
    )
    model, _ = await load_model(session, student.id)
    state.update(
        KODMODState(
            assessment_managed=True,
            assessment_kind=kind,
            quiz_policy_version=2,
            material_version=material.content_version if material else None,
            material_mapping_version=material.mapping_version if material else None,
            approved_material_concepts=context.get("approved_material_concepts", [])
            if context
            else [],
            quiz_source_docs=copy.deepcopy(source_docs or []),
            intent="quiz",
            quiz_n_questions=body.n_questions,
            current_concept_id=str(concept.id) if concept else "",
            current_topic=context["material_title"] if context else concept.name if concept else "",
            current_difficulty=body.difficulty or "medium",
            detected_language=body.language,
            mastery_scores=dict(model._scores),
            mastery_confidence=dict(model._confidence),
            learning_profile={
                **build_learning_profile(student),
                "language": body.language,
            },
        )
    )
    if context:
        state["subject_id"] = context.get("subject_id")
        state["current_concept_id"] = ""
        if body.concept_id and str(body.concept_id) not in {
            c["id"] for c in state["approved_material_concepts"]
        }:
            raise HTTPException(422, "Konsep harus sudah disetujui untuk materi ini.")
    final = await invoke(graph, dict(state), sid)
    questions = copy.deepcopy(final.get("quiz_questions", []))
    if len(questions) != body.n_questions:
        raise ValueError("Graph did not generate a valid quiz")
    for question in questions:
        question["question_id"] = str(as_uuid(question.get("question_id")) or uuid.uuid4())
        cid = as_uuid(question.get("concept_id"))
        if context:
            allowed = {c["id"] for c in state["approved_material_concepts"]}
            if allowed and cid and str(cid) not in allowed:
                raise ValueError("Question claims an unapproved material Concept")
            question["concept_id"] = str(cid) if allowed and cid else ""
        else:
            known_concept = await session.get(Concept, cid) if cid is not None else None
            question["concept_id"] = str(cid) if known_concept is not None else ""
    final.update(
        quiz_questions=questions,
        quiz_question=questions[0],
        quiz_session_id=str(sid),
        quiz_attempts=[],
        current_question_index=0,
        current_question_attempts=0,
        mastery_applied_attempts=0,
        quiz_policy_version=2,
        question_state="answering",
    )
    from api.quiz_points import build_score_summary

    final["score_summary"] = build_score_summary([], total_questions=len(questions)).model_dump()
    session.add(
        QuizSession(
            id=sid,
            student_id=student.id,
            concept_id=body.concept_id,
            total_questions=len(questions),
            status="in_progress",
            assessment_state=snapshot(final),
        )
    )
    await session.flush()
    for index, question in enumerate(questions):
        session.add(
            QuizQuestion(
                id=uuid.UUID(question["question_id"]),
                quiz_session_id=sid,
                order_index=index,
                question=question.get("text", ""),
                question_type=question.get("type", "spoken"),
                options=question.get("options", []),
                correct_answer=question.get("expected_answer", ""),
                concept_id=as_uuid(question.get("concept_id")),
                difficulty=question.get("difficulty", "medium"),
            )
        )
    await session.flush()
    return QuizStartResponse(
        quiz_session_id=sid,
        first_question=question_out(questions[0], 0),
        total_questions=len(questions),
        policy_version=2,
        score_presentation="session_total",
        score_summary=final["score_summary"],
        current_question=question_out(questions[0], 0),
        available_actions=["answer", "hint", "advance"] if kind == "tutor" else ["answer"],
    )


async def validate_assessment_source(
    session: AsyncSession, owned: QuizSession, student: User, *, check_versions=True
):
    canonical = owned.assessment_state or {}
    if canonical.get("class_id") or canonical.get("material_id"):
        await resolve_tutoring_context(
            session,
            as_uuid(canonical.get("class_id")),
            as_uuid(canonical.get("material_id")),
            student,
            require_ready=check_versions,
        )
        material = await session.get(ClassMaterial, as_uuid(canonical.get("material_id")))
        if check_versions and (
            material is None
            or canonical.get("material_version") != material.content_version
            or (
                canonical.get("quiz_policy_version", 1) == 2
                and canonical.get("material_mapping_version") != material.mapping_version
            )
        ):
            raise HTTPException(409, "Materi kuis sudah berubah. Minta guru meninjau sesi ini.")


async def recover_assessment(
    session: AsyncSession, student: User, sid: uuid.UUID
) -> QuizRecoveryResponse:
    owned = await session.scalar(
        select(QuizSession).where(QuizSession.id == sid, QuizSession.student_id == student.id)
    )
    if owned is None:
        raise HTTPException(404, "Sesi kuis tidak ditemukan.")
    if not owned.assessment_state:
        raise HTTPException(409, "Sesi lama belum mendukung pemulihan. Mulai latihan baru.")
    if owned.status not in ("in_progress", "completed"):
        raise HTTPException(409, "Sesi kuis ini tidak dapat dilanjutkan.")
    await validate_assessment_source(session, owned, student)
    state = owned.assessment_state
    index = int(state.get("current_question_index", 0))
    questions = state.get("quiz_questions", [])
    receipt = await session.scalar(
        select(AssessmentSubmission)
        .where(AssessmentSubmission.quiz_session_id == sid)
        .order_by(AssessmentSubmission.attempt_index.desc())
        .limit(1)
    )
    extra = {}
    if state.get("quiz_policy_version", 1) == 2:
        from api.quiz_actions import interaction

        extra = interaction(owned).model_dump(exclude={"current_question"})
    return QuizRecoveryResponse(
        **extra,
        quiz_session_id=sid,
        kind=state.get("assessment_kind", "assessment"),
        status=cast(Literal["in_progress", "completed"], owned.status),
        class_id=state.get("class_id"),
        material_id=state.get("material_id"),
        material_title=state.get("current_topic") or None,
        language=state.get("detected_language", "id"),
        total_questions=owned.total_questions,
        answered_questions=min(index, owned.total_questions),
        current_question=question_out(questions[index], index)
        if owned.status == "in_progress"
        and index < len(questions)
        and state.get("question_state") != "review"
        else None,
        last_result=QuizSubmitResponse.model_validate(receipt.response_payload)
        if receipt
        else None,
        started_at=owned.started_at,
    )


async def active_assessments(session: AsyncSession, student: User, *, kind="assessment"):
    rows = (
        await session.scalars(
            select(QuizSession)
            .where(
                QuizSession.student_id == student.id,
                QuizSession.status == "in_progress",
            )
            .order_by(QuizSession.started_at.desc())
            .limit(50)
        )
    ).all()
    result = []
    for row in rows:
        if (
            not row.assessment_state
            or row.assessment_state.get("assessment_kind", "assessment") != kind
        ):
            continue
        try:
            result.append(await recover_assessment(session, student, row.id))
        except HTTPException as exc:
            if exc.status_code not in (404, 409):
                raise
    return result


async def submit_assessment(
    session: AsyncSession, graph, student: User, body: QuizSubmitRequest
) -> QuizSubmitResponse:
    owned = await session.scalar(
        select(QuizSession)
        .where(
            QuizSession.id == body.quiz_session_id,
            QuizSession.student_id == student.id,
        )
        .with_for_update()
    )
    if owned is None:
        raise HTTPException(404, "Sesi kuis tidak ditemukan.")
    if (owned.assessment_state or {}).get("quiz_policy_version", 1) == 2:
        from api.quiz_actions import submit_v2

        return await submit_v2(session, graph, student, body, owned)
    await validate_assessment_source(session, owned, student)
    fingerprint = hashlib.sha256(
        json.dumps(
            body.model_dump(mode="json", exclude={"submission_id"}),
            sort_keys=True,
            ensure_ascii=False,
        ).encode()
    ).hexdigest()
    receipt = await session.get(AssessmentSubmission, body.submission_id)
    if receipt is not None:
        if (
            receipt.quiz_session_id != owned.id
            or receipt.student_id != student.id
            or receipt.request_fingerprint != fingerprint
        ):
            raise HTTPException(409, "ID pengiriman sudah digunakan. Muat ulang latihan.")
        return QuizSubmitResponse.model_validate(receipt.response_payload)
    canonical = copy.deepcopy(owned.assessment_state)
    if owned.status != "in_progress" or not canonical:
        raise HTTPException(409, "Sesi selesai atau perlu dimulai ulang.")
    questions = canonical.get("quiz_questions", [])
    index = canonical.get("current_question_index", 0)
    if index >= len(questions):
        raise HTTPException(409, "Sesi sudah selesai.")
    active = questions[index]
    question = await session.scalar(
        select(QuizQuestion).where(
            QuizQuestion.id == body.question_id,
            QuizQuestion.quiz_session_id == owned.id,
        )
    )
    if question is None:
        raise HTTPException(404, "Soal tidak ditemukan.")
    if str(body.question_id) != active.get("question_id"):
        raise HTTPException(409, "Soal sudah berganti. Mulai ulang latihan.")
    # Serialize mastery updates across different quizzes for the same learner.
    await session.scalar(select(User.id).where(User.id == student.id).with_for_update())
    model, model_rows = await load_model(session, student.id)
    state = {**initial_state(str(owned.id), str(student.id)), **canonical}
    state.update(
        assessment_managed=True,
        intent="quiz",
        student_answer=body.student_answer,
        user_input=body.student_answer,
        quiz_question=active,
        mastery_scores=dict(model._scores),
        mastery_confidence=dict(model._confidence),
    )
    final = await invoke(graph, state, owned.id)
    previous = canonical.get("quiz_attempts", [])
    attempts = copy.deepcopy(final.get("quiz_attempts", []))
    if (
        len(attempts) != len(previous) + 1
        or attempts[:-1] != previous
        or attempts[-1].get("question_id") != str(body.question_id)
        or attempts[-1].get("student_answer") != body.student_answer
        or final.get("quiz_questions") != questions
    ):
        raise ValueError("Graph did not return exactly one matching attempt")
    attempt = attempts[-1]
    score, confidence = (
        bounded_score(attempt.get("score", 0)),
        bounded_score(attempt.get("confidence", 0)),
    )
    attempt["response_latency_ms"] = body.response_latency_ms
    new_index = int(final.get("current_question_index", index))
    if new_index not in (index, index + 1):
        raise ValueError("Graph returned an invalid question cursor")
    cursor, applied = (
        int(final.get("mastery_applied_attempts", 0)),
        int(canonical.get("mastery_applied_attempts", 0)),
    )
    if cursor != (len(attempts) if new_index > index else applied):
        raise ValueError("Graph returned an invalid mastery cursor")
    complete = new_index == len(questions)
    cumulative = sum(bounded_score(a["score"]) for a in attempts) / len(attempts)
    is_correct = bool(attempt.get("is_correct"))
    english = canonical.get("learning_profile", {}).get("language") == "en"
    if complete:
        feedback = (
            final.get("accessible_response")
            or final.get("generated_response")
            or attempt.get("feedback", "")
        )
    elif is_correct:
        base_feedback = attempt.get("feedback", "").strip()
        next_prompt = (
            "Please select continue to go to the next question."
            if english
            else "Silakan tekan lanjut ke soal berikutnya."
        )
        feedback = f"{base_feedback} {next_prompt}".strip() if base_feedback else next_prompt
    else:
        feedback = attempt.get("feedback", "") or final.get("generated_response", "")

    response = QuizSubmitResponse(
        score=score,
        is_correct=is_correct,
        feedback=feedback,
        next_question=None if complete else question_out(questions[new_index], new_index),
        quiz_complete=complete,
        final_summary=feedback if complete else None,
        cumulative_score=cumulative,
    )
    attempt_row = QuizAttempt(
        id=uuid.uuid4(),
        quiz_session_id=owned.id,
        quiz_question_id=body.question_id,
        student_answer=body.student_answer,
        score=score,
        is_correct=response.is_correct,
        confidence=confidence,
        feedback=attempt.get("feedback", ""),
        response_latency_ms=body.response_latency_ms,
    )
    session.add(attempt_row)
    await session.flush()
    session.add(
        AssessmentSubmission(
            id=body.submission_id,
            quiz_session_id=owned.id,
            student_id=student.id,
            question_id=body.question_id,
            quiz_attempt_id=attempt_row.id,
            attempt_index=len(previous),
            request_fingerprint=fingerprint,
            response_payload=response.model_dump(mode="json"),
        )
    )
    await session.flush()
    receipts = {
        r.attempt_index: r
        for r in (
            await session.scalars(
                select(AssessmentSubmission).where(
                    AssessmentSubmission.quiz_session_id == owned.id,
                    AssessmentSubmission.attempt_index >= applied,
                    AssessmentSubmission.attempt_index < cursor,
                )
            )
        ).all()
    }
    q_by_id = {q["question_id"]: q for q in questions}
    for position in range(applied, cursor):
        evidence = attempts[position]
        cid = as_uuid(q_by_id[evidence["question_id"]].get("concept_id"))
        if not cid:
            continue
        if canonical.get("class_id") or canonical.get("material_id"):
            approved_ids = {c["id"] for c in canonical.get("approved_material_concepts", [])}
            if str(cid) not in approved_ids:
                continue
        if await session.get(Concept, cid) is None:
            continue
        event_receipt = receipts[position]
        existing = await session.scalar(
            select(MasteryEvent.id).where(
                MasteryEvent.submission_id == event_receipt.id,
                MasteryEvent.concept_id == cid,
            )
        )
        if existing is not None:
            continue
        key = str(cid)
        before = model._scores.get(key, 0.5)
        event_score, event_confidence = (
            bounded_score(evidence["score"]),
            bounded_score(evidence["confidence"]),
        )
        model.update(key, event_score, event_confidence)
        row = model_rows.get(key)
        if row is None:
            row = MasteryScore(student_id=student.id, concept_id=cid)
            model_rows[key] = row
            session.add(row)
        row.mastery, row.confidence, row.n_attempts = (
            model._scores[key],
            model._confidence[key],
            model._attempts[key],
        )
        row.last_seen = model._last_practiced[key]
        session.add(
            MasteryEvent(
                submission_id=event_receipt.id,
                student_id=student.id,
                concept_id=cid,
                score=event_score,
                confidence=event_confidence,
                mastery_before=before,
                mastery_after=row.mastery,
                source_snapshot={
                    "material_id": canonical.get("material_id"),
                    "content_version": canonical.get("material_version"),
                    "mapping_version": canonical.get("material_mapping_version"),
                    "subject_id": canonical.get("subject_id"),
                },
            )
        )
    final.update(
        quiz_attempts=attempts,
        cumulative_quiz_score=cumulative,
        mastery_scores=dict(model._scores),
        mastery_confidence=dict(model._confidence),
    )
    owned.assessment_state = snapshot(final)
    owned.correct_count = sum(bool(a.get("is_correct")) for a in attempts)
    if complete:
        owned.status, owned.ended_at, owned.final_score = (
            "completed",
            datetime.now(UTC),
            cumulative,
        )
    await session.flush()
    return response

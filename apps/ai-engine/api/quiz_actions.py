"""Policy-v2 transactions. Session lock precedes learner lock in every mutation.

The graph grades answers; this service alone advances questions and applies evidence.
"""

from __future__ import annotations

import copy
import hashlib
import json
import uuid
from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.quiz_points import points_for_score
from api.quiz_policy import QuizPolicy, decide_transition
from database.models import (
    AssessmentSubmission,
    Concept,
    MasteryEvent,
    MasteryScore,
    QuizActionReceipt,
    QuizAttempt,
    QuizQuestionOutcome,
    QuizSession,
    User,
)
from models.quiz import QuizActionRequest, QuizInteractionView, QuizSubmitResponse


def fingerprint(body, exclude):
    return hashlib.sha256(
        json.dumps(
            body.model_dump(mode="json", exclude=exclude),
            sort_keys=True,
            ensure_ascii=False,
        ).encode()
    ).hexdigest()


def interaction(owned: QuizSession) -> QuizInteractionView:
    from api.assessment_service import question_out
    from api.quiz_points import session_result_text
    from models.quiz import ScoreSummary

    state = owned.assessment_state or {}
    index = state.get("current_question_index", 0)
    questions = state.get("quiz_questions", [])
    phase = state.get("question_state", "answering")
    complete = owned.status == "completed"
    return QuizInteractionView(
        score_presentation="session_total",
        score_summary=state.get("score_summary"),
        final_summary=session_result_text(
            ScoreSummary.model_validate(state["score_summary"]),
            language=state.get("detected_language", "id"),
        )
        if complete and state.get("score_summary")
        else None,
        policy_version=2,
        question_state="complete" if complete else phase,
        available_actions=[]
        if complete
        else ["advance"]
        if phase == "review"
        else ["answer", "hint", "advance"]
        if state.get("assessment_kind") == "tutor"
        else ["answer"],
        current_question=question_out(questions[index], index)
        if phase != "review" and not complete and index < len(questions)
        else None,
        last_review=state.get("last_review"),
        review_question=question_out(questions[max(0, index - 1)], max(0, index - 1))
        if (phase == "review" or complete) and questions
        else None,
        hint_text=state.get("hint_text"),
    )


def review(question, attempt=None, *, english=False):
    answer = question.get("expected_answer", "")
    if question.get("type") == "mcq":
        for option in question.get("options", []):
            if option.strip().upper().startswith(str(answer).upper() + "."):
                answer = option
                break
    # Canonical review is only rendered after the question has been closed.
    explanation = question.get("explanation") or question.get("review_explanation") or ""
    return (
        f"Correct answer: {answer}. {explanation}"
        if english
        else f"Jawaban benar: {answer}. {explanation}"
    ).strip()


async def authorize(session, owned, student, *, versions=True):
    from api.assessment_service import validate_assessment_source

    await validate_assessment_source(session, owned, student, check_versions=versions)


async def finalize_question_outcome(
    session: AsyncSession, owned: QuizSession, question_id: uuid.UUID
) -> QuizQuestionOutcome:
    from api.assessment_service import as_uuid, bounded_score, load_model

    existing = await session.scalar(
        select(QuizQuestionOutcome).where(
            QuizQuestionOutcome.quiz_session_id == owned.id,
            QuizQuestionOutcome.question_id == question_id,
        )
    )
    if existing:
        return existing
    first = await session.scalar(
        select(AssessmentSubmission)
        .where(
            AssessmentSubmission.quiz_session_id == owned.id,
            AssessmentSubmission.question_id == question_id,
        )
        .order_by(AssessmentSubmission.attempt_index)
        .limit(1)
    )
    attempt = await session.get(QuizAttempt, first.quiz_attempt_id) if first else None
    if first is not None and attempt is None:
        raise HTTPException(409, "Hasil jawaban belum tersedia. Muat ulang sesi.")
    state = owned.assessment_state or {}
    assisted = state.get("first_answer_assisted", {}).get(str(question_id), False)
    outcome = QuizQuestionOutcome(
        quiz_session_id=owned.id,
        question_id=question_id,
        first_submission_id=first.id if first else None,
        status="answered" if first else "skipped",
        first_score=bounded_score(attempt.score) if attempt else 0,
        assisted=assisted,
    )
    session.add(outcome)
    if first and attempt is not None and not assisted:
        question = next(q for q in state["quiz_questions"] if q["question_id"] == str(question_id))
        cid = as_uuid(question.get("concept_id"))
        approved = {c["id"] for c in state.get("approved_material_concepts", [])}
        concept = (
            await session.get(Concept, cid)
            if cid is not None and (not state.get("material_id") or str(cid) in approved)
            else None
        )
        if concept is not None:
            model, rows = await load_model(session, owned.student_id)
            key = str(cid)
            before = model._scores.get(key, 0.5)
            model.update(key, bounded_score(attempt.score), bounded_score(attempt.confidence))
            row = rows.get(key)
            if row is None:
                row = MasteryScore(student_id=owned.student_id, concept_id=cid)
                session.add(row)
            row.mastery, row.confidence, row.n_attempts = (
                model._scores[key],
                model._confidence[key],
                model._attempts[key],
            )
            row.last_seen = model._last_practiced[key]
            session.add(
                MasteryEvent(
                    submission_id=first.id,
                    student_id=owned.student_id,
                    concept_id=cid,
                    score=attempt.score,
                    confidence=attempt.confidence,
                    mastery_before=before,
                    mastery_after=row.mastery,
                    source_snapshot={
                        "material_id": state.get("material_id"),
                        "content_version": state.get("material_version"),
                        "mapping_version": state.get("material_mapping_version"),
                        "subject_id": state.get("subject_id"),
                        "quiz_policy_version": 2,
                    },
                )
            )
    await session.flush()
    outcomes = (
        await session.scalars(
            select(QuizQuestionOutcome).where(QuizQuestionOutcome.quiz_session_id == owned.id)
        )
    ).all()
    owned.correct_count = sum(o.first_score >= 0.6 for o in outcomes)
    owned.final_score = sum(o.first_score for o in outcomes) / max(owned.total_questions, 1)
    from api.quiz_points import build_score_summary

    owned.assessment_state = {
        **state,
        "score_summary": build_score_summary(
            outcomes, total_questions=owned.total_questions
        ).model_dump(),
    }
    return outcome


async def submit_v2(session, graph, student, body, owned):
    from api.assessment_service import bounded_score, initial_state, invoke, snapshot

    await authorize(session, owned, student, versions=False)
    stamp = fingerprint(body, {"submission_id"})
    receipt = await session.get(AssessmentSubmission, body.submission_id)
    if receipt:
        if (
            receipt.quiz_session_id != owned.id
            or receipt.student_id != student.id
            or receipt.request_fingerprint != stamp
        ):
            raise HTTPException(409, "ID pengiriman sudah digunakan.")
        return QuizSubmitResponse.model_validate(receipt.response_payload)
    await authorize(session, owned, student)
    state = copy.deepcopy(owned.assessment_state)
    index = state.get("current_question_index", 0)
    questions = state["quiz_questions"]
    if (
        owned.status != "in_progress"
        or state.get("question_state") == "review"
        or index >= len(questions)
    ):
        raise HTTPException(409, "Baca pembahasan lalu pilih lanjut.")
    question = questions[index]
    if question["question_id"] != str(body.question_id):
        raise HTTPException(409, "Soal sudah berganti.")
    await session.scalar(select(User.id).where(User.id == student.id).with_for_update())
    previous = state.get("quiz_attempts", [])
    final = await invoke(
        graph,
        {
            **initial_state(str(owned.id), str(student.id)),
            **state,
            "assessment_managed": True,
            "intent": "quiz",
            "quiz_question": question,
            "student_answer": body.student_answer,
            "user_input": body.student_answer,
        },
        owned.id,
    )
    attempts = copy.deepcopy(final.get("quiz_attempts", []))
    if (
        len(attempts) != len(previous) + 1
        or attempts[:-1] != previous
        or attempts[-1].get("question_id") != str(body.question_id)
        or attempts[-1].get("student_answer") != body.student_answer
        or final.get("quiz_questions") != questions
    ):
        raise ValueError("Grader did not return one matching attempt")
    attempt = attempts[-1]
    score, confidence = (
        bounded_score(attempt["score"]),
        bounded_score(attempt["confidence"]),
    )
    correct = score >= 0.6
    english = state.get("detected_language") == "en"
    decision = decide_transition(
        QuizPolicy(2, state.get("assessment_kind", "assessment")),
        correct=correct,
        action="answer",
        question_closed=False,
    )
    feedback = (
        "Not quite yet. Request a hint, try again, or continue."
        if english
        else "Belum tepat. Kamu boleh meminta petunjuk, mencoba lagi, atau lanjut soal."
    )
    if decision.close_question:
        feedback = review(question, attempt, english=english)
    elif final.get("hint_text"):
        feedback = final["hint_text"]
    attempt["feedback"] = feedback
    attempt["response_latency_ms"] = body.response_latency_ms
    assisted = dict(state.get("first_answer_assisted", {}))
    assisted.setdefault(
        str(body.question_id),
        str(body.question_id) in state.get("hinted_questions", []),
    )
    state.update(
        quiz_attempts=attempts,
        first_answer_assisted=assisted,
        current_question_attempts=state.get("current_question_attempts", 0) + 1,
        hint_text=None,
        question_state=decision.question_state,
    )
    owned.assessment_state = snapshot(state)
    row = QuizAttempt(
        id=uuid.uuid4(),
        quiz_session_id=owned.id,
        quiz_question_id=body.question_id,
        student_answer=body.student_answer,
        score=score,
        confidence=confidence,
        is_correct=correct,
        feedback=feedback,
        response_latency_ms=body.response_latency_ms,
    )
    session.add(row)
    await session.flush()
    receipt = AssessmentSubmission(
        id=body.submission_id,
        quiz_session_id=owned.id,
        student_id=student.id,
        question_id=body.question_id,
        quiz_attempt_id=row.id,
        attempt_index=len(previous),
        request_fingerprint=stamp,
        response_payload={},
    )
    session.add(receipt)
    await session.flush()
    if decision.close_question:
        outcome = await finalize_question_outcome(session, owned, body.question_id)
        state["score_summary"] = owned.assessment_state["score_summary"]
        state.update(
            current_question_index=index + 1,
            current_question_attempts=0,
            last_review=feedback,
            review_question_id=str(body.question_id),
        )
    owned.assessment_state = snapshot(state)
    response = QuizSubmitResponse(
        item_points=points_for_score(outcome.first_score) if decision.close_question else None,
        **interaction(owned).model_dump(),
        score=score,
        is_correct=correct,
        feedback=feedback,
        cumulative_score=owned.final_score or 0,
    )
    receipt.response_payload = response.model_dump(mode="json")
    await session.flush()
    return response


async def apply_quiz_action(
    session: AsyncSession, student: User, sid: uuid.UUID, body: QuizActionRequest
) -> QuizInteractionView:
    from api.assessment_service import snapshot

    owned = await session.scalar(
        select(QuizSession)
        .where(QuizSession.id == sid, QuizSession.student_id == student.id)
        .with_for_update()
    )
    if not owned:
        raise HTTPException(404, "Sesi kuis tidak ditemukan.")
    await authorize(session, owned, student, versions=False)
    stamp = fingerprint(body, {"action_id"})
    receipt = await session.get(QuizActionReceipt, body.action_id)
    if receipt:
        if (
            receipt.quiz_session_id != sid
            or receipt.student_id != student.id
            or receipt.request_fingerprint != stamp
        ):
            raise HTTPException(409, "ID aksi sudah digunakan.")
        return QuizInteractionView.model_validate(receipt.response_payload)
    await authorize(session, owned, student)
    state = copy.deepcopy(owned.assessment_state or {})
    if owned.status != "in_progress":
        raise HTTPException(409, "Sesi tidak menerima aksi ini.")
    index = state.get("current_question_index", 0)
    questions = state["quiz_questions"]
    pending = state.get("question_state") == "review"
    qid = (
        state.get("review_question_id")
        if pending
        else questions[index]["question_id"]
        if index < len(questions)
        else None
    )
    if qid != str(body.question_id):
        raise HTTPException(409, "Soal sudah berganti.")
    if body.action == "hint" and (pending or state.get("assessment_kind") != "tutor"):
        raise HTTPException(409, "Petunjuk hanya tersedia untuk soal Tutor yang terbuka.")
    if not pending and state.get("assessment_kind") != "tutor":
        raise HTTPException(409, "Jawab soal sebelum melanjutkan.")
    await session.scalar(select(User.id).where(User.id == student.id).with_for_update())
    if body.action == "hint":
        from agents.tutoring_agent import generate_quiz_hint

        state["hint_text"] = await generate_quiz_hint(
            questions[index],
            student_answer="",
            language=state.get("detected_language", "id"),
            source_docs=state.get("quiz_source_docs", []),
        )
        state["hinted_questions"] = list({*state.get("hinted_questions", []), qid})
    else:
        if not pending:
            await finalize_question_outcome(session, owned, body.question_id)
            state["score_summary"] = (owned.assessment_state or {})["score_summary"]
            state["last_review"] = review(
                questions[index], english=state.get("detected_language") == "en"
            )
            index += 1
        state.update(
            current_question_index=index,
            current_question_attempts=0,
            hint_text=None,
            question_state="answering",
            review_question_id=None,
        )
        if index >= len(questions):
            owned.status, owned.ended_at = "completed", datetime.now(UTC)
            state["question_state"] = "complete"
    owned.assessment_state = snapshot(state)
    response = interaction(owned)
    session.add(
        QuizActionReceipt(
            id=body.action_id,
            quiz_session_id=sid,
            student_id=student.id,
            request_fingerprint=stamp,
            response_payload=response.model_dump(mode="json"),
        )
    )
    await session.flush()
    if owned.status == "completed":
        from api.progress_guidance_service import apply_plan_learning_event

        await apply_plan_learning_event(session, receipt_id=body.action_id, student_id=student.id)
    return response

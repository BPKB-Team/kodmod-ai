"""
KODMOD AI - Chat Turn Service
=============================

The shared middle of a conversation turn, so the WebSocket and the REST
fallback behave identically and only differ in how they deliver the answer.

Responsibilities:

* Open or resume a `LearningSession`, naming it after the student's opening
  question so the history sidebar is scannable.
* Assemble the graph's `KODMODState` for one turn.
* Record both sides of the turn in `interaction_logs`, which is what the
  teacher's transcript view reads.

The graph itself is invoked by the caller: the WebSocket streams events, the
REST route awaits a single result, and neither wants the other's plumbing.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import Any, cast

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database.models import LearningSession, QuizSession, User
from database.session import async_session
from graphs.state import KODMODState, build_learning_profile, initial_state

log = logging.getLogger(__name__)

TITLE_MAX_CHARS = 60


def derive_title(text: str) -> str:
    """Name a session after its opening question, trimmed at a word boundary."""
    cleaned = " ".join(text.split())
    if len(cleaned) <= TITLE_MAX_CHARS:
        return cleaned or "Sesi baru"
    head = cleaned[:TITLE_MAX_CHARS].rsplit(" ", 1)[0]
    return (head or cleaned[:TITLE_MAX_CHARS]) + "..."


async def resolve_chat_context(
    session: AsyncSession,
    *,
    student: User,
    session_id: uuid.UUID | None,
    class_id: uuid.UUID | None = None,
    material_id: uuid.UUID | None = None,
) -> dict | None:
    """Keep one context per owned conversation and recheck access every turn."""
    from api.material_service import resolve_tutoring_context

    if session_id is not None:
        existing = await session.scalar(
            select(LearningSession).where(
                LearningSession.id == session_id,
                LearningSession.student_id == student.id,
                LearningSession.ended_at.is_(None),
            )
        )
        if existing is not None:
            if existing.guided_state is not None:
                raise HTTPException(409, "Lanjutkan sesi ini melalui belajar terpandu.")
            if (class_id is not None and class_id != existing.class_id) or (
                material_id is not None and material_id != existing.material_id
            ):
                raise HTTPException(
                    409, "Mulai sesi baru untuk belajar dari kelas atau materi lain."
                )
            active_quizzes = (
                await session.scalars(
                    select(QuizSession).where(
                        QuizSession.student_id == student.id,
                        QuizSession.status == "in_progress",
                    )
                )
            ).all()
            if any(
                (quiz.assessment_state or {}).get("learning_session_id") == str(existing.id)
                for quiz in active_quizzes
            ):
                raise HTTPException(
                    409,
                    "Selesaikan kuis pada percakapan ini sebelum mengirim pertanyaan berikutnya.",
                )
            class_id, material_id = existing.class_id, existing.material_id
    return await resolve_tutoring_context(session, class_id, material_id, student)


def session_context(
    row: LearningSession, subject_name: str | None, material_title: str | None
) -> dict | None:
    """Metadata for the student's historical conversation, without document text."""
    if row.class_id is None:
        return None
    return {
        "class_id": str(row.class_id),
        "material_id": str(row.material_id) if row.material_id else None,
        "subject_name": subject_name,
        "material_title": material_title,
    }


async def open_session(
    *,
    student_id: uuid.UUID,
    session_id: uuid.UUID | None,
    subject_id: uuid.UUID | None,
    first_text: str,
    context: dict | None = None,
) -> uuid.UUID:
    """Resume the named session, or start one. Returns the id to use as thread_id.

    A `session_id` the student does not own is treated as absent rather than as
    an error: it starts a fresh session instead of leaking whether that id exists.
    """
    async with async_session() as session:
        if session_id is not None:
            existing = (
                await session.execute(
                    select(LearningSession).where(
                        LearningSession.id == session_id,
                        LearningSession.student_id == student_id,
                    )
                )
            ).scalar_one_or_none()
            if existing is not None and existing.ended_at is None:
                if subject_id is not None and existing.subject_id != subject_id:
                    existing.subject_id = subject_id
                    await session.commit()
                return existing.id

        row = LearningSession(
            # An ended session is intentionally never reopened.  Starting a
            # fresh row also keeps the transcript boundary visible to the
            # student and prevents later turns from being appended to a
            # closed learning session.
            id=uuid.uuid4(),
            student_id=student_id,
            subject_id=subject_id,
            class_id=uuid.UUID(context["class_id"]) if context else None,
            material_id=uuid.UUID(context["material_id"])
            if context and context.get("material_id")
            else None,
            title=derive_title(first_text),
            mode="tutoring",
        )
        session.add(row)
        await session.commit()
        return row.id


async def prepare_chat_turn(
    session: AsyncSession,
    *,
    student: User,
    text: str,
    session_id: uuid.UUID | None,
    subject_id: uuid.UUID | None = None,
    class_id: uuid.UUID | None = None,
    material_id: uuid.UUID | None = None,
) -> tuple[uuid.UUID, KODMODState, dict | None]:
    """Use the same owned conversation and validated context on every transport."""
    context = await resolve_chat_context(
        session,
        student=student,
        session_id=session_id,
        class_id=class_id,
        material_id=material_id,
    )
    selected_subject = None if context else subject_id
    owned_id = await open_session(
        student_id=student.id,
        session_id=session_id,
        subject_id=selected_subject,
        first_text=text,
        context=context,
    )
    state = await build_turn_state(
        student=student,
        session_id=owned_id,
        text=text,
        subject_id=selected_subject,
        context=context,
    )
    return owned_id, state, context


async def build_turn_state(
    *,
    student: User,
    session_id: uuid.UUID,
    text: str,
    subject_id: uuid.UUID | None,
    context: dict | None = None,
) -> KODMODState:
    """Current-turn input merged onto the conversation's saved checkpoint.

    Do not send empty history/quiz defaults: they would overwrite the pending
    question and tutor context every time a REST or WebSocket message arrives.
    """
    from analytics.student_model import StudentModel

    state = initial_state(
        session_id=str(session_id),
        student_id=str(student.id),
        user_input=text,
        subject_id=str(subject_id) if subject_id else None,
    )
    if subject_id is None:
        state.pop("subject_id", None)
    state["class_id"] = context["class_id"] if context else None
    state["material_id"] = context.get("material_id") if context else None
    if context:
        # Classroom subjects are labels, not canonical curriculum Subject IDs.
        state["subject_id"] = None
    for key in (
        "teacher_id",
        "current_topic",
        "current_concept_id",
        "current_difficulty",
        "tutoring_context",
        "quiz_session_id",
        "quiz_n_questions",
        "quiz_questions",
        "current_question_index",
        "current_question_attempts",
        "quiz_question",
        "quiz_attempts",
        "mastery_applied_attempts",
        "quiz_score",
        "cumulative_quiz_score",
        "misconceptions_detected",
        "analytics_summary",
        "recommendations",
    ):
        cast(dict[str, Any], state).pop(key, None)
    state["learning_profile"] = build_learning_profile(student)
    try:
        model = await StudentModel.load(str(student.id))
        state["mastery_scores"] = await model.mastery_scores()
        state["mastery_confidence"] = dict(model._confidence)
    except Exception:  # pragma: no cover - a cold mastery table must not block a turn
        log.warning("Could not load mastery for %s", student.id, exc_info=True)
    return state


_MODE_BY_INTENT = {
    "quiz": "quiz",
    "exercise_request": "quiz",
    "analytics": "analytics",
}


async def update_session_mode(session_id: uuid.UUID, intent: str | None) -> None:
    """Keep ``learning_sessions.mode`` in sync with the latest turn's intent.

    Never raises into the request path: a lost mode update must not break a
    turn, and callers already treat ``log_turn`` the same way.
    """
    mode = _MODE_BY_INTENT.get(intent or "", "tutoring")
    try:
        async with async_session() as session:
            row = (
                await session.execute(
                    select(LearningSession).where(LearningSession.id == session_id)
                )
            ).scalar_one_or_none()
            if row is not None and row.mode != mode:
                row.mode = mode
                await session.commit()
    except Exception:  # pragma: no cover - a lost mode update must not break a turn
        log.warning("Could not update mode for session %s", session_id, exc_info=True)


async def log_turn(
    session_id: uuid.UUID,
    *,
    role: str,
    text: str,
    intent: str | None = None,
    latency_ms: int | None = None,
    source_refs: list[dict] | None = None,
    quiz_session_id: uuid.UUID | None = None,
) -> None:
    """Append one turn to the transcript. Never raises into the request path."""
    from memory.long_term import log_interaction

    try:
        await log_interaction(
            session_id,
            role=role,
            text=text,
            intent=intent,
            latency_ms=latency_ms,
            metadata={
                **({"sources": source_refs} if source_refs else {}),
                **({"quiz_session_id": str(quiz_session_id)} if quiz_session_id else {}),
            }
            or None,
        )
    except Exception:  # pragma: no cover - a lost log line must not break the reply
        log.warning("Could not log %s turn for session %s", role, session_id, exc_info=True)


async def close_session(session_id: uuid.UUID, student_id: uuid.UUID) -> bool:
    """Mark a session ended. Returns False if it is not this student's session."""
    async with async_session() as session:
        row = (
            await session.execute(
                select(LearningSession).where(
                    LearningSession.id == session_id,
                    LearningSession.student_id == student_id,
                )
            )
        ).scalar_one_or_none()
        if row is None or row.ended_at is not None:
            return False
        row.ended_at = datetime.now(UTC)
        await session.commit()
        return True


def reply_text(final: dict) -> str:
    """The text to show the student: the accessibility pass, or the raw answer."""
    return final.get("accessible_response") or final.get("generated_response") or ""


def sources(final: dict) -> list[dict]:
    """Which curriculum chunks grounded this answer, for the sources disclosure."""
    seen: dict[tuple, dict] = {}
    for doc in final.get("retrieved_docs") or []:
        source = str(doc.get("source") or "").replace("\\", "/").rsplit("/", 1)[-1]
        key = (source, doc.get("class_id"), doc.get("material_id"))
        if source and key not in seen:
            seen[key] = {
                "source": source,
                "section_title": doc.get("section_title"),
                "score": round(float(doc.get("rerank_score") or doc.get("score") or 0.0), 3),
            }
            if doc.get("class_id"):
                seen[key].update(
                    {
                        "class_id": doc["class_id"],
                        "material_id": doc.get("material_id"),
                        "title": doc.get("material_title"),
                    }
                )
    return list(seen.values())

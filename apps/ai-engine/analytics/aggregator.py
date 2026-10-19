"""
KODMOD AI - Analytics Aggregator
================================

Computes the metrics that flow into:
- The Learning Analytics Agent (Cluster Analytics & Reporting)
- Teacher Dashboard
- Student Dashboard
- Recommendation Agent inputs

Two aggregators:

- `StudentAggregator`  -> per-student rollups
- `CohortAggregator`   -> rollups across every student (the teacher view)

There are no classrooms: a teacher sees every student.

Each returns a dict that is JSON-serialisable, suitable for both API
responses and storing as `analytics_reports.payload`.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, cast
from zoneinfo import ZoneInfo

from api.teacher_access import teacher_roster_query
from database.models import (
    AssignmentAttempt,
    Concept,
    InteractionLog,
    LearningSession,
    MasteryScore,
    Misconception,
    QuizAttempt,
    QuizQuestionOutcome,
    QuizSession,
    User,
)
from database.session import async_session
from memory.long_term import fetch_active_recommendations
from sqlalchemy import func, or_, select

from analytics.progress_projection import aware, official_practice_totals, public_progress
from analytics.student_model import mastery_at

logger = logging.getLogger(__name__)

WindowName = Literal["today", "week", "month", "all"]


def _window_start(window: WindowName, timezone: str = "UTC", *, now=None) -> datetime | None:
    now = now or datetime.now(UTC)
    zone = ZoneInfo(timezone)
    if window == "today":
        local = now.astimezone(zone)
        return datetime(local.year, local.month, local.day, tzinfo=zone).astimezone(UTC)
    if window == "week":
        return now - timedelta(days=7)
    if window == "month":
        return now - timedelta(days=30)
    return None  # "all"


def _duration_minutes(
    started_at: datetime | None,
    ended_at: datetime | None,
    *,
    last_activity_at: datetime | None = None,
    window_start: datetime | None = None,
) -> float:
    """Return evidenced session time, including open sessions through last activity."""
    if started_at is None:
        return 0.0
    started_at = aware(started_at)
    ended_at = aware(ended_at) if ended_at else None
    last_activity_at = aware(last_activity_at) if last_activity_at else None
    window_start = aware(window_start) if window_start else None
    end = ended_at or last_activity_at
    if end is None:
        return 0.0
    start = max(started_at, window_start) if window_start is not None else started_at
    return max(0.0, (end - start).total_seconds() / 60.0)


def _is_independent_assessment(row) -> bool:
    return (row.assessment_state or {}).get("assessment_kind", "assessment") != "tutor"


def _activity_total_minutes(
    *,
    learning_sessions: Sequence[Any],
    learning_activity: dict,
    quiz_sessions: Sequence[Any],
    quiz_activity: dict,
    window_start: datetime | None = None,
) -> float:
    """Count tutor sessions and independent assessments without counting tutor quizzes twice."""
    learning_minutes = sum(
        _duration_minutes(
            row.started_at,
            row.ended_at,
            last_activity_at=learning_activity.get(row.id),
            window_start=window_start,
        )
        for row in learning_sessions
    )
    assessment_minutes = sum(
        _duration_minutes(
            row.started_at,
            row.ended_at,
            last_activity_at=quiz_activity.get(row.id),
            window_start=window_start,
        )
        for row in quiz_sessions
        if _is_independent_assessment(row)
    )
    return learning_minutes + assessment_minutes


@dataclass
class StudentAggregator:
    async def summarise(
        self,
        *,
        student_id: uuid.UUID,
        window: WindowName = "week",
        include_recommendations: bool = True,
        timezone: str = "UTC",
    ) -> dict:
        start = _window_start(window, timezone)

        async with async_session() as session:
            student = await session.get(User, student_id)
            if student is None:
                return {"error": "student_not_found"}

            # ---- Sessions in window
            sess_q = select(LearningSession).where(LearningSession.student_id == student_id)
            if start:
                recent_interactions = (
                    select(InteractionLog.session_id)
                    .join(LearningSession, InteractionLog.session_id == LearningSession.id)
                    .where(
                        LearningSession.student_id == student_id,
                        InteractionLog.timestamp >= start,
                    )
                )
                sess_q = sess_q.where(
                    or_(
                        LearningSession.started_at >= start,
                        LearningSession.id.in_(recent_interactions),
                    )
                )
            sessions = (await session.execute(sess_q)).scalars().all()

            # ---- Quiz attempts in window
            attempts_q = (
                select(QuizAttempt)
                .join(QuizSession, QuizAttempt.quiz_session_id == QuizSession.id)
                .where(QuizSession.student_id == student_id)
            )
            if start:
                attempts_q = attempts_q.where(QuizAttempt.answered_at >= start)
            attempts = (await session.execute(attempts_q)).scalars().all()

            # Standalone assessments are learning activity too. Tutor mini-quizzes
            # are excluded below because their enclosing LearningSession already
            # measures the same time.
            quiz_session_q = select(QuizSession).where(QuizSession.student_id == student_id)
            if start:
                answered_session_ids = {attempt.quiz_session_id for attempt in attempts}
                quiz_session_q = quiz_session_q.where(
                    or_(
                        QuizSession.started_at >= start,
                        QuizSession.id.in_(answered_session_ids),
                        QuizSession.id.in_(
                            select(QuizQuestionOutcome.quiz_session_id).where(
                                QuizQuestionOutcome.closed_at >= start
                            )
                        ),
                    )
                )
            quiz_sessions = (await session.execute(quiz_session_q)).scalars().all()

            activity_q = (
                select(InteractionLog.session_id, func.max(InteractionLog.timestamp))
                .join(LearningSession, InteractionLog.session_id == LearningSession.id)
                .where(LearningSession.student_id == student_id)
                .group_by(InteractionLog.session_id)
            )
            if start:
                activity_q = activity_q.where(InteractionLog.timestamp >= start)
            learning_activity = dict((await session.execute(activity_q)).all())

            # Frozen formal grades use a separate attempt table. Count their
            # questions, not their percentage scores, so a one-question mini
            # quiz and a longer assignment have equal weight per answer.
            assignments_q = select(
                func.count(AssignmentAttempt.id),
                func.coalesce(func.sum(AssignmentAttempt.total_questions), 0),
                func.coalesce(func.sum(AssignmentAttempt.correct_count), 0),
                func.max(AssignmentAttempt.submitted_at),
            ).where(
                AssignmentAttempt.student_id == student_id,
                AssignmentAttempt.state == "submitted",
                AssignmentAttempt.submitted_at.is_not(None),
                AssignmentAttempt.score.is_not(None),
                AssignmentAttempt.correct_count.is_not(None),
                AssignmentAttempt.total_questions > 0,
            )
            if start:
                assignments_q = assignments_q.where(AssignmentAttempt.submitted_at >= start)
            assignment_count, assignment_answers, assignment_correct, assignment_last = (
                await session.execute(assignments_q)
            ).one()

            # ---- Mastery snapshot (full, not windowed - mastery is cumulative)
            mastery_rows = (
                await session.execute(
                    select(MasteryScore, Concept)
                    .join(Concept, MasteryScore.concept_id == Concept.id)
                    .where(MasteryScore.student_id == student_id)
                )
            ).all()

            # ---- Open misconceptions
            miscons = (
                await session.execute(
                    select(Misconception, Concept)
                    .join(Concept, Misconception.concept_id == Concept.id)
                    .where(
                        Misconception.student_id == student_id,
                        Misconception.resolved.is_(False),
                    )
                    .order_by(Misconception.detected_at.desc())
                    .limit(10)
                )
            ).all()

            # ---- Engagement counters
            interaction_count = (
                await session.execute(
                    select(func.count(InteractionLog.id))
                    .join(LearningSession, InteractionLog.session_id == LearningSession.id)
                    .where(
                        LearningSession.student_id == student_id,
                        *([InteractionLog.timestamp >= start] if start else []),
                    )
                )
            ).scalar_one()
            public, outcomes = await public_progress(session, student_id, start=start)
            latest_activity = [
                await session.scalar(
                    select(func.max(InteractionLog.timestamp))
                    .join(LearningSession, InteractionLog.session_id == LearningSession.id)
                    .where(LearningSession.student_id == student_id)
                ),
                await session.scalar(
                    select(func.max(QuizAttempt.answered_at))
                    .join(QuizSession, QuizAttempt.quiz_session_id == QuizSession.id)
                    .where(QuizSession.student_id == student_id)
                ),
                await session.scalar(
                    select(func.max(QuizQuestionOutcome.closed_at))
                    .join(QuizSession, QuizQuestionOutcome.quiz_session_id == QuizSession.id)
                    .where(QuizSession.student_id == student_id)
                ),
                await session.scalar(
                    select(func.max(AssignmentAttempt.submitted_at)).where(
                        AssignmentAttempt.student_id == student_id,
                        AssignmentAttempt.state == "submitted",
                    )
                ),
            ]

        # ---------- Compute rollups ----------
        independent_assessments = [row for row in quiz_sessions if _is_independent_assessment(row)]
        n_sessions = len(sessions) + len(independent_assessments)
        quiz_activity: dict[uuid.UUID, datetime | None] = {}
        for attempt in attempts:
            current = quiz_activity.get(attempt.quiz_session_id)
            if current is None or (attempt.answered_at and attempt.answered_at > current):
                quiz_activity[attempt.quiz_session_id] = attempt.answered_at
        for outcome in outcomes:
            current = quiz_activity.get(outcome.quiz_session_id)
            if current is None or aware(outcome.closed_at) > aware(current):
                quiz_activity[outcome.quiz_session_id] = outcome.closed_at
        total_minutes = _activity_total_minutes(
            learning_sessions=sessions,
            learning_activity=learning_activity,
            quiz_sessions=quiz_sessions,
            quiz_activity=quiz_activity,
            window_start=start,
        )

        formal_answers = int(assignment_answers or 0)
        formal_correct = int(assignment_correct or 0)
        n_attempts = len(attempts) + formal_answers
        official = official_practice_totals(quiz_sessions, attempts, outcomes)
        denominator = official["denominator"] + formal_answers
        n_correct = official["correct"] + formal_correct
        avg_score = (official["score_sum"] + formal_correct) / denominator if denominator else 0.0
        accuracy = (n_correct / denominator) if denominator else 0.0

        mastery_now = datetime.now(UTC)
        mastery: list[dict[str, Any]] = [
            {
                "concept_id": str(m.concept_id),
                "concept_name": c.name,
                "mastery": mastery_at(float(m.mastery), m.last_seen, now=mastery_now),
                "n_attempts": int(m.n_attempts),
            }
            for m, c in mastery_rows
        ]
        weak = sorted(mastery, key=lambda x: x["mastery"])[:5]
        strong = sorted(mastery, key=lambda x: x["mastery"], reverse=True)[:5]
        overall_mastery = sum(m["mastery"] for m in mastery) / len(mastery) if mastery else 0.0

        # Engagement index (heuristic): sessions/day * avg-session-minutes / 30
        days_in_window = max(1, (datetime.now(UTC) - start).days) if start else 30
        sessions_per_day = n_sessions / days_in_window
        engagement_index = min(1.0, sessions_per_day * (total_minutes / max(1, n_sessions)) / 30.0)

        out: dict = {
            "student_id": str(student_id),
            "student_name": student.full_name,
            "window": window,
            "n_sessions": n_sessions,
            "total_minutes": round(total_minutes, 1),
            "interaction_count": int(interaction_count),
            "n_quiz_attempts": n_attempts,
            "n_practice_answers": len(attempts),
            "n_assignment_answers": formal_answers,
            "n_assignment_submissions": int(assignment_count),
            "quiz_accuracy": round(accuracy, 3),
            "avg_quiz_score": round(avg_score, 3),
            "overall_mastery": round(overall_mastery, 3),
            "weak_concepts": weak,
            "strong_concepts": strong,
            "open_misconceptions": [
                {
                    "concept_name": c.name,
                    "description": mc.description,
                    "detected_at": mc.detected_at.isoformat(),
                }
                for mc, c in miscons
            ],
            "engagement_index": round(engagement_index, 3),
            "generated_at": datetime.now(UTC).isoformat(),
            **public,
            "n_official_questions": denominator,
            "n_questions_answered": official["n_questions_answered"] + formal_answers,
            "n_support_attempts": official["n_support_attempts"],
            "n_assisted_questions": official["n_assisted_questions"],
            "legacy_practice_attempts": official["legacy_attempts"],
            "window_start": start.isoformat() if start else None,
            "window_end": datetime.now(UTC).isoformat(),
            "timezone": timezone,
            "duration_kind": "session_elapsed",
            "mastery_scope": "visible_cumulative",
            "material_progress_scope": "current_versions",
            "last_activity_scope": "all",
            "last_activity_at": max(
                [
                    aware(t)
                    for t in [
                        *latest_activity,
                        *[
                            datetime.fromisoformat(m["last_activity_at"])
                            for m in public["learning_materials"]
                            if m["last_activity_at"]
                        ],
                    ]
                    if t
                ],
                default=None,
            ),
        }
        if out["last_activity_at"]:
            out["last_activity_at"] = out["last_activity_at"].isoformat()

        if include_recommendations:
            out["active_recommendations"] = await fetch_active_recommendations(student_id, limit=5)
        return out


@dataclass
class CohortAggregator:
    """Student rollups; teacher callers provide their classroom owner id."""

    async def summarise(
        self, *, window: WindowName = "week", teacher_id: uuid.UUID | None = None
    ) -> dict:
        async with async_session() as session:
            roster = list(
                (
                    await session.execute(
                        teacher_roster_query(teacher_id)
                        if teacher_id is not None
                        else select(User.id).where(User.role == "student", User.is_active.is_(True))
                    )
                )
                .scalars()
                .all()
            )

        # One round trip per student, run concurrently rather than in sequence.
        per_student = await asyncio.gather(
            *(
                StudentAggregator().summarise(
                    student_id=sid, window=window, include_recommendations=False
                )
                for sid in roster
            )
        )
        per_student = [s for s in per_student if "error" not in s]

        if not per_student:
            return {
                "window": window,
                "n_students": 0,
                "avg_mastery": 0.0,
                "avg_quiz_accuracy": 0.0,
                "avg_engagement_index": 0.0,
                "cohort_weak_concepts": [],
                "students": [],
                "generated_at": datetime.now(UTC).isoformat(),
            }

        n = len(per_student)
        avg_mastery = sum(s["overall_mastery"] for s in per_student) / n
        avg_accuracy = sum(s["quiz_accuracy"] for s in per_student) / n
        avg_engagement = sum(s["engagement_index"] for s in per_student) / n

        # Weakest concepts across the cohort.
        concept_to_scores: dict[str, list[float]] = {}
        for s in per_student:
            for w in s.get("weak_concepts", []):
                concept_to_scores.setdefault(w["concept_name"], []).append(w["mastery"])
        cohort_weak = sorted(
            (
                {"concept_name": k, "avg_mastery": sum(v) / len(v), "n_students": len(v)}
                for k, v in concept_to_scores.items()
            ),
            key=lambda x: cast(float, x["avg_mastery"]),
        )[:5]

        return {
            "window": window,
            "n_students": n,
            "avg_mastery": round(avg_mastery, 3),
            "avg_quiz_accuracy": round(avg_accuracy, 3),
            "avg_engagement_index": round(avg_engagement, 3),
            "cohort_weak_concepts": cohort_weak,
            "students": [
                {
                    "student_id": s["student_id"],
                    "student_name": s["student_name"],
                    "overall_mastery": s["overall_mastery"],
                    "quiz_accuracy": s["quiz_accuracy"],
                    "engagement_index": s["engagement_index"],
                    "n_sessions": s.get("n_sessions", 0),
                    "open_misconceptions": len(s.get("open_misconceptions", [])),
                }
                for s in per_student
            ],
            "generated_at": datetime.now(UTC).isoformat(),
        }

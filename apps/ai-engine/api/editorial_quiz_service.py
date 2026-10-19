"""Versioned manual assignments, separate from adaptive graph assessments.

Writers lock the draft (editorial) or assignment then attempt (student).
No mutation returns a successful response until its transaction commits.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime

from database.models import (
    AssignmentAnswer,
    AssignmentAttempt,
    Classroom,
    Concept,
    Enrollment,
    QuizAssignment,
    QuizDraft,
    QuizDraftQuestion,
    QuizDraftVersion,
    QuizReviewEvent,
    Subject,
    User,
)
from fastapi import HTTPException
from models.editorial_quiz import (
    AssignInput,
    AssignmentOut,
    AttemptOut,
    DraftInput,
    DraftOut,
    ResultOut,
    SaveAnswer,
    StaffQuestion,
    StudentQuestion,
    VersionOut,
)
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from api.assignment_mastery import apply_assignment_mastery

log = logging.getLogger(__name__)


def now() -> datetime:
    return datetime.now(UTC)


def utc(value: datetime | None) -> datetime | None:
    # SQLite fixtures omit tzinfo. PostgreSQL uses timestamptz.
    return value.replace(tzinfo=UTC) if value and value.tzinfo is None else value


def conflict(message="Data berubah. Muat ulang sebelum melanjutkan."):
    raise HTTPException(409, message)


async def commit(session: AsyncSession):
    try:
        await session.commit()
    except SQLAlchemyError:
        await session.rollback()
        log.exception("Editorial transaction failed")
        raise HTTPException(
            503, "Penyimpanan gagal. Coba lagi dengan permintaan yang sama."
        ) from None


async def validate_catalog(session: AsyncSession, body: DraftInput):
    if await session.get(Subject, body.subject_id) is None:
        raise HTTPException(422, "Mata pelajaran tidak ditemukan.")
    for concept_id in {q.concept_id for q in body.questions if q.concept_id}:
        concept = await session.get(Concept, concept_id)
        if concept is None or not concept.is_active or concept.subject_id != body.subject_id:
            raise HTTPException(422, "Konsep harus berasal dari mata pelajaran yang dipilih.")


async def lock_staff_actor(session: AsyncSession, actor: User) -> User:
    """Recheck capability after acquiring the draft lock, until commit."""
    current = await session.scalar(
        select(User)
        .where(User.id == actor.id)
        .execution_options(populate_existing=True)
        .with_for_update(read=True)
    )
    if current is None or not current.is_active or current.role not in {"teacher", "admin"}:
        raise HTTPException(
            403, "Akses review telah dicabut. Muat ulang atau hubungi administrator."
        )
    return current


async def draft_for(
    session: AsyncSession, draft_id: uuid.UUID, actor: User, *, owner=False, lock=False
):
    query = select(QuizDraft).where(QuizDraft.id == draft_id)
    if lock:
        query = query.with_for_update()
    draft = await session.scalar(query)
    if draft is None or (owner and draft.teacher_id != actor.id):
        raise HTTPException(404, "Kuis tidak ditemukan.")
    version = await session.scalar(
        select(QuizDraftVersion).where(
            QuizDraftVersion.draft_id == draft.id, QuizDraftVersion.version == draft.current_version
        )
    )
    if version is None:
        raise HTTPException(503, "Revisi kuis belum tersedia. Hubungi administrator.")
    reviewer = (
        actor.role == "teacher"
        and version.reviewer_id == actor.id
        and version.state in {"in_review", "approved", "rejected", "published"}
    )
    admin = actor.role == "admin" and version.state != "draft"
    if draft.teacher_id != actor.id and not (reviewer or admin):
        raise HTTPException(404, "Kuis tidak ditemukan.")
    return draft, version


async def questions(session: AsyncSession, version_id: uuid.UUID):
    return list(
        (
            await session.scalars(
                select(QuizDraftQuestion)
                .where(QuizDraftQuestion.version_id == version_id)
                .order_by(QuizDraftQuestion.order_index)
            )
        ).all()
    )


def question_out(question: QuizDraftQuestion, *, staff=False):
    safe = {
        "id": question.id,
        "order_index": question.order_index,
        "prompt": question.prompt,
        "narration": question.narration,
        "options": question.options,
        "concept_id": question.concept_id,
    }
    if staff:
        return StaffQuestion.model_validate(
            {
                **safe,
                "correct_option_id": question.correct_option_id,
                "explanation": question.explanation,
                "difficulty": question.difficulty,
            }
        )
    return StudentQuestion.model_validate(safe)


def event(session, version, actor, kind, note=""):
    session.add(
        QuizReviewEvent(
            version_id=version.id,
            actor_id=actor.id,
            kind=kind,
            note=note,
            reviewer_id=version.reviewer_id,
        )
    )


async def new_version(session: AsyncSession, draft: QuizDraft, body: DraftInput, actor: User):
    version = QuizDraftVersion(
        draft_id=draft.id,
        version=draft.current_version,
        subject_id=body.subject_id,
        title=body.title,
        description=body.description,
        release_policy=body.release_policy,
    )
    session.add(version)
    await session.flush()
    for question in body.questions:
        session.add(QuizDraftQuestion(version_id=version.id, **question.model_dump(mode="python")))
    event(session, version, actor, "revision_created")
    await session.flush()
    return version


async def assignment_out(session, assignment, version=None, classroom=None, attempt=None):
    version = version or await session.get(QuizDraftVersion, assignment.version_id)
    classroom = classroom or await session.get(Classroom, assignment.class_id)
    return AssignmentOut(
        score_summary=formal_points(attempt) if attempt else None,
        id=assignment.id,
        version_id=version.id,
        version=version.version,
        title=version.title,
        description=version.description,
        class_id=classroom.id,
        class_name=classroom.name,
        opens_at=utc(assignment.opens_at),
        due_at=utc(assignment.due_at),
        is_closed=assignment.is_closed,
        release_policy=version.release_policy,
        total_questions=len(await questions(session, version.id)),
        attempt_state=attempt.state if attempt else None,
        score=attempt.score if attempt else None,
    )


async def draft_out(session, draft, version, actor):
    events = (
        await session.scalars(
            select(QuizReviewEvent)
            .where(QuizReviewEvent.version_id == version.id)
            .order_by(QuizReviewEvent.created_at)
        )
    ).all()
    assignments = []
    # Review capability never grants class/learner data.
    if actor.id == draft.teacher_id:
        assigned = (
            await session.scalars(
                select(QuizAssignment)
                .join(QuizDraftVersion)
                .where(QuizDraftVersion.draft_id == draft.id)
                .order_by(QuizAssignment.created_at.desc())
                .limit(100)
            )
        ).all()
        assignments = [await assignment_out(session, row) for row in assigned]
    return DraftOut(
        id=draft.id,
        teacher_id=draft.teacher_id,
        current_version=draft.current_version,
        is_archived=draft.is_archived,
        version=VersionOut(
            id=version.id,
            version=version.version,
            subject_id=version.subject_id,
            title=version.title,
            description=version.description,
            state=version.state,
            reviewer_id=version.reviewer_id,
            review_revision=version.review_revision,
            release_policy=version.release_policy,
            questions=[question_out(q, staff=True) for q in await questions(session, version.id)],
        ),
        events=[
            {
                "kind": e.kind,
                "note": e.note,
                "actor_id": str(e.actor_id),
                "reviewer_id": str(e.reviewer_id) if e.reviewer_id else None,
                "created_at": utc(e.created_at).isoformat(),
            }
            for e in events
        ],
        assignments=assignments,
    )


def check_version(draft, version, action):
    if (
        draft.is_archived
        or version.id != action.version_id
        or version.review_revision != action.expected_review_revision
    ):
        conflict()


async def assign(session, draft, body: AssignInput, actor):
    version = await session.scalar(
        select(QuizDraftVersion).where(
            QuizDraftVersion.id == body.version_id, QuizDraftVersion.draft_id == draft.id
        )
    )
    if draft.is_archived or version is None or version.state != "published":
        conflict("Hanya versi terbit yang dapat ditugaskan.")
    classroom = await session.scalar(
        select(Classroom)
        .where(
            Classroom.id == body.class_id,
            Classroom.teacher_id == actor.id,
            Classroom.is_archived.is_(False),
        )
        .with_for_update(read=True)
    )
    if classroom is None:
        raise HTTPException(404, "Kelas aktif milik Anda tidak ditemukan.")
    if body.due_at and body.due_at <= now():
        raise HTTPException(422, "Batas pengumpulan harus berada di masa depan.")
    if version.release_policy == "after_due" and body.due_at is None:
        raise HTTPException(422, "Jadwal batas pengumpulan diperlukan untuk rilis pembahasan.")
    assignment = QuizAssignment(
        version_id=version.id,
        class_id=classroom.id,
        teacher_id=actor.id,
        opens_at=body.opens_at,
        due_at=body.due_at,
    )
    session.add(assignment)
    await session.flush()
    output = await assignment_out(session, assignment, version, classroom)
    await commit(session)
    return output


async def accessible_assignment(session, assignment_id, student, *, lock=False):
    query = select(QuizAssignment).where(QuizAssignment.id == assignment_id)
    if lock:
        query = query.with_for_update()
    assignment = await session.scalar(query)
    if assignment is None:
        raise HTTPException(404, "Tugas tidak ditemukan.")
    classroom = await session.scalar(
        select(Classroom)
        .where(Classroom.id == assignment.class_id, Classroom.is_archived.is_(False))
        .with_for_update(read=True)
    )
    enrolled = await session.scalar(
        select(Enrollment)
        .where(Enrollment.class_id == assignment.class_id, Enrollment.student_id == student.id)
        .with_for_update(read=True)
    )
    if classroom is None or enrolled is None:
        raise HTTPException(404, "Tugas tidak ditemukan atau akses kelas sudah berakhir.")
    return assignment


def ensure_open(assignment):
    at = now()
    if assignment.is_closed:
        conflict("Penugasan sudah ditutup.")
    if assignment.opens_at and utc(assignment.opens_at) > at:
        conflict("Penugasan belum dibuka.")
    if assignment.due_at and utc(assignment.due_at) <= at:
        conflict("Batas pengumpulan telah berlalu.")


async def attempt_for(session, assignment, student, *, lock=False):
    query = select(AssignmentAttempt).where(
        AssignmentAttempt.assignment_id == assignment.id, AssignmentAttempt.student_id == student.id
    )
    if lock:
        query = query.with_for_update()
    attempt = await session.scalar(query)
    if attempt is None:
        raise HTTPException(404, "Tugas belum dimulai.")
    return attempt


async def answers_for(session, attempt):
    return list(
        (
            await session.scalars(
                select(AssignmentAnswer).where(AssignmentAnswer.attempt_id == attempt.id)
            )
        ).all()
    )


async def attempt_out(session, assignment, attempt):
    return AttemptOut(
        id=attempt.id,
        assignment=await assignment_out(session, assignment, attempt=attempt),
        revision=attempt.revision,
        state=attempt.state,
        questions=[question_out(q) for q in await questions(session, assignment.version_id)],
        answers={str(a.question_id): a.option_id for a in await answers_for(session, attempt)},
    )


async def save_answer(session, assignment, attempt, question_id, body: SaveAnswer):
    ensure_open(assignment)
    if attempt.state != "in_progress" or attempt.revision != body.expected_revision:
        conflict()
    question = await session.scalar(
        select(QuizDraftQuestion).where(
            QuizDraftQuestion.id == question_id,
            QuizDraftQuestion.version_id == assignment.version_id,
        )
    )
    if question is None:
        raise HTTPException(404, "Soal tidak termasuk penugasan ini.")
    if body.option_id not in {o["id"] for o in question.options}:
        raise HTTPException(422, "Pilihan jawaban tidak valid.")
    answer = await session.scalar(
        select(AssignmentAnswer).where(
            AssignmentAnswer.attempt_id == attempt.id, AssignmentAnswer.question_id == question.id
        )
    )
    if answer is None:
        answer = AssignmentAnswer(
            attempt_id=attempt.id, question_id=question.id, option_id=body.option_id
        )
        session.add(answer)
    else:
        answer.option_id, answer.saved_at = body.option_id, now()
    attempt.revision += 1
    await session.flush()
    output = await attempt_out(session, assignment, attempt)
    await commit(session)
    return output


async def result_out(session, assignment, attempt):
    version = await session.get(QuizDraftVersion, assignment.version_id)
    release = version.release_policy == "after_submission" or (
        assignment.due_at is not None and utc(assignment.due_at) <= now()
    )
    review = []
    if release:
        answers = {a.question_id: a for a in await answers_for(session, attempt)}
        for q in await questions(session, version.id):
            answer = answers[q.id]
            review.append(
                {
                    "question_id": str(q.id),
                    "prompt": q.prompt,
                    "options": q.options,
                    "option_id": answer.option_id,
                    "correct_option_id": q.correct_option_id,
                    "is_correct": answer.is_correct,
                    "explanation": answer.feedback,
                }
            )
    return ResultOut(
        score_summary=formal_points(attempt),
        attempt_id=attempt.id,
        assignment_id=assignment.id,
        score=attempt.score,
        correct_count=attempt.correct_count,
        total_questions=attempt.total_questions,
        submitted_at=utc(attempt.submitted_at),
        feedback_released=release,
        review=review,
    )


def formal_points(attempt):
    if attempt.state != "submitted" or attempt.score is None or attempt.correct_count is None:
        return None
    from models.quiz import ScoreSummary

    return ScoreSummary.model_validate(
        {
            "points_earned": 100 * attempt.correct_count,
            "points_possible": 100 * attempt.total_questions,
            "points_per_question": 100,
            "answered_questions": attempt.total_questions,
            "total_questions": attempt.total_questions,
            "skipped_questions": 0,
            "assisted_questions": 0,
        }
    )


async def submit_attempt(session, assignment, attempt, expected_revision, submission_key):
    # A durable receipt is checked before a new-write schedule guard.
    if attempt.submission_key == submission_key:
        if attempt.submission_revision != expected_revision:
            conflict("Kunci pengiriman telah dipakai dengan data berbeda.")
        return ResultOut.model_validate(attempt.receipt)
    if attempt.state == "submitted":
        conflict("Jawaban sudah dikirim. Buka hasil untuk melihat nilai.")
    ensure_open(assignment)
    if attempt.revision != expected_revision:
        conflict()
    items = await questions(session, assignment.version_id)
    answers = {a.question_id: a for a in await answers_for(session, attempt)}
    if len(answers) != len(items):
        raise HTTPException(422, "Jawab semua soal sebelum mengirim.")
    correct = 0
    for q in items:
        answer = answers[q.id]
        answer.is_correct = answer.option_id == q.correct_option_id
        answer.feedback = q.explanation
        correct += int(answer.is_correct)
    await apply_assignment_mastery(session, assignment, attempt, items, answers)
    attempt.state, attempt.submitted_at = "submitted", now()
    attempt.correct_count, attempt.score = correct, round(correct / len(items) * 100, 2)
    attempt.submission_key, attempt.submission_revision = submission_key, expected_revision
    attempt.revision += 1
    output = await result_out(session, assignment, attempt)
    attempt.receipt = output.model_dump(mode="json")
    await commit(session)
    return output

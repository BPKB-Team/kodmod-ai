"""Manual teacher quizzes and class assignments with object-scoped access."""

from __future__ import annotations

import logging
import re
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api import editorial_quiz_service as service
from api.dependencies import db_session, require_staff, require_student, require_teacher
from api.learning_content import material_learning_units
from database.models import (
    AssignmentAttempt,
    Classroom,
    Enrollment,
    QuizAssignment,
    QuizDraft,
    QuizDraftVersion,
    User,
)
from models.editorial_quiz import (
    AssignInput,
    AssignmentOut,
    AttemptOut,
    DraftInput,
    DraftOut,
    Option,
    ProposalInput,
    QuestionInput,
    RejectDecision,
    ResultOut,
    ReviewDecision,
    ReviewerAction,
    SaveAnswer,
    SaveDraft,
    SubmitAttempt,
    VersionAction,
)

router = APIRouter(tags=["editorial-quizzes"])


@router.post("/teacher/quizzes/propose")
async def propose_quiz(
    body: ProposalInput,
    actor: User = Depends(require_teacher),
    session: AsyncSession = Depends(db_session),
):
    """Propose source grounded questions for teacher review before saving."""
    from agents.problem_generator import problem_generator_node
    from api.routes.classrooms import accessible
    from database.models import ClassMaterial
    from rag.source_bundle import MaterialScope, bundle_from_docs

    classroom = await accessible(session, body.class_id, actor, write=True)
    material = await session.get(ClassMaterial, body.material_id)
    if material is None or material.class_id != body.class_id:
        raise HTTPException(404, "Materi tidak ditemukan.")
    from api.material_concepts import current_concepts

    approved = await current_concepts(session, material, classroom)
    units = material_learning_units(material, require_content=True)
    count = min(6, len(units))
    indices = sorted({round(i * (len(units) - 1) / max(1, count - 1)) for i in range(count)})
    approved_ids = [str(item["id"]) for item in approved]
    docs = [
        {
            "id": units[i]["base_id"],
            "chunk_id": units[i]["base_id"],
            "evidence_id": units[i]["base_id"],
            "text": units[i]["text"],
            "material_title": material.title,
            "material_id": str(material.id),
            "class_id": str(material.class_id),
            "content_version": material.content_version,
            "mapping_version": material.mapping_version,
            "document_hash": units[i]["document_hash"],
            "block_ids": units[i]["block_ids"],
            "spans": units[i]["spans"],
            "approved_concept_ids": approved_ids,
            "section_title": units[i].get("title"),
            "source": material.source_filename or material.title,
        }
        for i in indices
    ]
    source_scope = MaterialScope(
        authorized_teacher_id=actor.id,
        class_id=material.class_id,
        material_id=material.id,
        content_version=material.content_version,
        mapping_version=material.mapping_version,
        subject_id=classroom.subject_id,
        language=body.language,
    )
    source_bundle = bundle_from_docs(material.title, source_scope, docs)
    try:
        result = await problem_generator_node(
            {
                "class_id": str(material.class_id),
                "material_id": str(material.id),
                "current_topic": material.title,
                "student_id": "",
                "quiz_mcq_only": True,
                "quiz_n_questions": body.n_questions,
                "current_difficulty": body.difficulty,
                "quiz_source_docs": docs,
                "quiz_source_bundle": source_bundle,
                "authorized_teacher_id": str(actor.id),
                "learning_profile": {"language": body.language},
                "assessment_managed": True,
                "approved_material_concepts": approved,
                "material_content_version": material.content_version,
                "material_mapping_version": material.mapping_version,
            }
        )
        questions = []
        for index, question in enumerate(result["quiz_questions"]):
            options = [
                {"id": chr(97 + i), "label": re.sub(r"^[A-Da-d][.):\s-]+", "", option).strip()}
                for i, option in enumerate(question["options"])
            ]
            answer = question["expected_answer"].strip().lower().rstrip(".")
            answer_id = (
                answer
                if answer in "abcd" and len(answer) == 1
                else next(
                    (
                        o["id"]
                        for i, o in enumerate(options)
                        if question["options"][i].lower() == answer
                    ),
                    "",
                )
            )
            questions.append(
                QuestionInput(
                    order_index=index + 1,
                    prompt=question["text"],
                    narration=question["text"],
                    options=[Option.model_validate(o) for o in options],
                    correct_option_id=answer_id,
                    explanation=question["explanation"],
                    difficulty=body.difficulty,
                    concept_id=uuid.UUID(question["concept_id"])
                    if question.get("concept_id")
                    else None,
                )
            )
    except Exception as error:
        from agents.question_quality import QuestionQualityError

        if isinstance(error, QuestionQualityError):
            raise HTTPException(
                409,
                {
                    "code": error.code,
                    "message": "Usulan soal belum lolos pemeriksaan sumber. Periksa isi materi yang disetujui atau buat soal secara manual.",
                },
            ) from None
        logging.getLogger(__name__).exception("Could not generate reviewed-material proposal")
        raise HTTPException(
            503, "Usulan soal belum dapat dibuat. Coba lagi atau tulis soal sendiri."
        ) from None
    return {
        "material_id": material.id,
        "material_version": material.content_version,
        "mapping_version": material.mapping_version,
        "subject_id": classroom.subject_id,
        "questions": questions,
        "review_required": True,
    }


@router.get("/teacher/quizzes")
async def list_quizzes(
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
    actor: User = Depends(require_teacher),
    session: AsyncSession = Depends(db_session),
):
    """List the teacher own versioned quiz drafts."""
    rows = (
        await session.execute(
            select(QuizDraft, QuizDraftVersion)
            .join(
                QuizDraftVersion,
                (QuizDraftVersion.draft_id == QuizDraft.id)
                & (QuizDraftVersion.version == QuizDraft.current_version),
            )
            .where(QuizDraft.teacher_id == actor.id)
            .order_by(QuizDraft.updated_at.desc())
            .offset(offset)
            .limit(limit)
        )
    ).all()
    return [
        {
            "id": d.id,
            "title": v.title,
            "description": v.description,
            "current_version": d.current_version,
            "state": v.state,
            "version_id": v.id,
            "review_revision": v.review_revision,
            "updated_at": d.updated_at,
            "is_archived": d.is_archived,
        }
        for d, v in rows
    ]


@router.post("/teacher/quizzes", status_code=201, response_model=DraftOut)
async def create_quiz(
    body: DraftInput,
    actor: User = Depends(require_teacher),
    session: AsyncSession = Depends(db_session),
):
    """Create an unpublished teacher quiz draft with validated questions."""
    await service.validate_catalog(session, body)
    draft = QuizDraft(
        teacher_id=actor.id,
        subject_id=body.subject_id,
        title=body.title,
        description=body.description,
    )
    session.add(draft)
    await session.flush()
    version = await service.new_version(session, draft, body, actor)
    output = await service.draft_out(session, draft, version, actor)
    await service.commit(session)
    return output


@router.get("/quiz-reviewers")
async def reviewers(
    actor: User = Depends(require_staff), session: AsyncSession = Depends(db_session)
):
    """List active independent teacher reviewers."""
    users = (
        await session.scalars(
            select(User)
            .where(User.role == "teacher", User.is_active.is_(True), User.id != actor.id)
            .order_by(User.full_name)
            .limit(100)
        )
    ).all()
    return [{"id": u.id, "full_name": u.full_name} for u in users]


@router.get("/quiz-reviews")
async def review_queue(
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
    actor: User = Depends(require_staff),
    session: AsyncSession = Depends(db_session),
):
    """List current quiz revisions awaiting the authenticated reviewer."""
    query = (
        select(QuizDraft, QuizDraftVersion, User.full_name)
        .join(
            QuizDraftVersion,
            (QuizDraftVersion.draft_id == QuizDraft.id)
            & (QuizDraftVersion.version == QuizDraft.current_version),
        )
        .join(User, User.id == QuizDraft.teacher_id)
        .where(
            QuizDraftVersion.state == "in_review",
            QuizDraft.is_archived.is_(False),
            QuizDraft.teacher_id != actor.id,
        )
    )
    if actor.role != "admin":
        query = query.where(QuizDraftVersion.reviewer_id == actor.id)
    rows = (
        await session.execute(query.order_by(QuizDraft.updated_at).offset(offset).limit(limit))
    ).all()
    return [
        {
            "id": d.id,
            "title": v.title,
            "current_version": v.version,
            "state": v.state,
            "owner_name": name,
            "version_id": v.id,
            "review_revision": v.review_revision,
        }
        for d, v, name in rows
    ]


@router.get("/teacher/quizzes/{draft_id}", response_model=DraftOut)
async def read_quiz(
    draft_id: uuid.UUID,
    actor: User = Depends(require_staff),
    session: AsyncSession = Depends(db_session),
):
    """Read an authorized quiz draft revision and review history."""
    draft, version = await service.draft_for(session, draft_id, actor)
    return await service.draft_out(session, draft, version, actor)


@router.patch("/teacher/quizzes/{draft_id}", response_model=DraftOut)
async def save_quiz(
    draft_id: uuid.UUID,
    body: SaveDraft,
    actor: User = Depends(require_teacher),
    session: AsyncSession = Depends(db_session),
):
    """Save a new immutable quiz revision with an optimistic version check."""
    draft, _ = await service.draft_for(session, draft_id, actor, owner=True, lock=True)
    if draft.is_archived or draft.current_version != body.expected_version:
        service.conflict()
    await service.validate_catalog(session, body)
    draft.current_version += 1
    draft.subject_id, draft.title, draft.description = body.subject_id, body.title, body.description
    draft.updated_at = service.now()
    version = await service.new_version(session, draft, body, actor)
    output = await service.draft_out(session, draft, version, actor)
    await service.commit(session)
    return output


@router.post("/teacher/quizzes/{draft_id}/reviewer", response_model=DraftOut)
async def nominate_reviewer(
    draft_id: uuid.UUID,
    body: ReviewerAction,
    actor: User = Depends(require_staff),
    session: AsyncSession = Depends(db_session),
):
    """Assign an active independent reviewer to the current quiz revision."""
    draft, version = await service.draft_for(session, draft_id, actor, lock=True)
    actor = await service.lock_staff_actor(session, actor)
    service.check_version(draft, version, body)
    owner_nomination = actor.id == draft.teacher_id and version.state == "draft"
    admin_reassignment = actor.role == "admin" and version.state == "in_review"
    if not (owner_nomination or admin_reassignment):
        raise HTTPException(
            403, "Reviewer hanya dapat diubah sebelum review, atau oleh admin saat review."
        )
    if body.reviewer_id:
        reviewer = await session.scalar(
            select(User).where(User.id == body.reviewer_id).with_for_update(read=True)
        )
        if (
            reviewer is None
            or reviewer.role != "teacher"
            or not reviewer.is_active
            or reviewer.id == draft.teacher_id
        ):
            raise HTTPException(422, "Pilih guru aktif lain sebagai reviewer.")
    version.reviewer_id = body.reviewer_id
    version.review_revision += 1
    service.event(
        session,
        version,
        actor,
        "reviewer_reassigned" if admin_reassignment else "reviewer_nominated",
    )
    await session.flush()
    output = await service.draft_out(session, draft, version, actor)
    await service.commit(session)
    return output


@router.post("/teacher/quizzes/{draft_id}/submit-review", response_model=DraftOut)
async def submit_review(
    draft_id: uuid.UUID,
    body: VersionAction,
    actor: User = Depends(require_teacher),
    session: AsyncSession = Depends(db_session),
):
    """Submit the current valid quiz revision for independent review."""
    draft, version = await service.draft_for(session, draft_id, actor, owner=True, lock=True)
    service.check_version(draft, version, body)
    if version.state != "draft":
        service.conflict("Revisi ini sudah diajukan. Buat revisi baru untuk mengubah isi.")
    if version.reviewer_id:
        reviewer = await session.scalar(
            select(User).where(User.id == version.reviewer_id).with_for_update(read=True)
        )
        if reviewer is None or not reviewer.is_active or reviewer.role != "teacher":
            raise HTTPException(
                422, "Reviewer tidak aktif. Pilih reviewer lain atau antrean admin."
            )
    version.state, version.review_revision = "in_review", version.review_revision + 1
    draft.updated_at = service.now()
    service.event(session, version, actor, "submitted")
    await session.flush()
    output = await service.draft_out(session, draft, version, actor)
    await service.commit(session)
    return output


async def decide(draft_id, body, actor, session, *, approved):
    draft, version = await service.draft_for(session, draft_id, actor, lock=True)
    actor = await service.lock_staff_actor(session, actor)
    service.check_version(draft, version, body)
    if actor.id == draft.teacher_id or not (
        actor.role == "admin" or version.reviewer_id == actor.id
    ):
        raise HTTPException(
            403,
            "Review memerlukan admin atau reviewer yang ditunjuk; pemilik tidak dapat menyetujui sendiri.",
        )
    if version.state != "in_review":
        service.conflict("Revisi ini tidak sedang menunggu review.")
    version.state, version.review_revision = (
        ("approved" if approved else "rejected"),
        version.review_revision + 1,
    )
    service.event(session, version, actor, "approved" if approved else "rejected", body.note)
    await session.flush()
    output = await service.draft_out(session, draft, version, actor)
    await service.commit(session)
    return output


@router.post("/teacher/quizzes/{draft_id}/approve", response_model=DraftOut)
async def approve(
    draft_id: uuid.UUID,
    body: ReviewDecision,
    actor: User = Depends(require_staff),
    session: AsyncSession = Depends(db_session),
):
    """Approve an assigned quiz revision with a review revision check."""
    return await decide(draft_id, body, actor, session, approved=True)


@router.post("/teacher/quizzes/{draft_id}/reject", response_model=DraftOut)
async def reject(
    draft_id: uuid.UUID,
    body: RejectDecision,
    actor: User = Depends(require_staff),
    session: AsyncSession = Depends(db_session),
):
    """Reject an assigned quiz revision with required feedback."""
    return await decide(draft_id, body, actor, session, approved=False)


@router.post("/teacher/quizzes/{draft_id}/publish", response_model=DraftOut)
async def publish(
    draft_id: uuid.UUID,
    body: VersionAction,
    actor: User = Depends(require_teacher),
    session: AsyncSession = Depends(db_session),
):
    """Publish the approved current quiz revision."""
    draft, version = await service.draft_for(session, draft_id, actor, owner=True, lock=True)
    service.check_version(draft, version, body)
    if version.state not in ("draft", "approved"):
        service.conflict("Kuis tidak dapat diterbitkan pada status ini.")
    version.state, version.published_at = "published", service.now()
    version.review_revision += 1
    service.event(session, version, actor, "published")
    await session.flush()
    output = await service.draft_out(session, draft, version, actor)
    await service.commit(session)
    return output


@router.post(
    "/teacher/quizzes/{draft_id}/assignments", status_code=201, response_model=AssignmentOut
)
async def create_assignment(
    draft_id: uuid.UUID,
    body: AssignInput,
    actor: User = Depends(require_teacher),
    session: AsyncSession = Depends(db_session),
):
    """Assign a published immutable quiz revision to an owned classroom."""
    draft, _ = await service.draft_for(session, draft_id, actor, owner=True, lock=True)
    return await service.assign(session, draft, body, actor)


async def teacher_assignment(session, assignment_id, actor, *, lock=False):
    query = select(QuizAssignment).where(
        QuizAssignment.id == assignment_id, QuizAssignment.teacher_id == actor.id
    )
    if lock:
        query = query.with_for_update()
    assignment = await session.scalar(query)
    classroom = (
        await session.scalar(
            select(Classroom)
            .where(
                Classroom.id == assignment.class_id,
                Classroom.teacher_id == actor.id,
                Classroom.is_archived.is_(False),
            )
            .with_for_update(read=True)
        )
        if assignment
        else None
    )
    if classroom is None:
        raise HTTPException(404, "Penugasan kelas aktif milik Anda tidak ditemukan.")
    return assignment


@router.post("/teacher/assignments/{assignment_id}/close", response_model=AssignmentOut)
async def close_assignment(
    assignment_id: uuid.UUID,
    actor: User = Depends(require_teacher),
    session: AsyncSession = Depends(db_session),
):
    """Close an owned assignment while retaining submitted results."""
    assignment = await teacher_assignment(session, assignment_id, actor, lock=True)
    assignment.is_closed = True
    output = await service.assignment_out(session, assignment)
    await service.commit(session)
    return output


@router.get("/teacher/assignments/{assignment_id}/results")
async def teacher_results(
    assignment_id: uuid.UUID,
    actor: User = Depends(require_teacher),
    session: AsyncSession = Depends(db_session),
):
    """Read classroom assignment completion and student results."""
    assignment = await teacher_assignment(session, assignment_id, actor)
    rows = (
        await session.execute(
            select(User, AssignmentAttempt)
            .join(Enrollment, Enrollment.student_id == User.id)
            .outerjoin(
                AssignmentAttempt,
                (AssignmentAttempt.student_id == User.id)
                & (AssignmentAttempt.assignment_id == assignment.id),
            )
            .where(
                Enrollment.class_id == assignment.class_id,
                User.is_active.is_(True),
                User.role == "student",
            )
            .order_by(User.full_name)
        )
    ).all()
    results = [
        {
            "student_id": u.id,
            "full_name": u.full_name,
            "state": a.state if a else "not_started",
            "score": a.score if a else None,
            "submitted_at": service.utc(a.submitted_at) if a else None,
        }
        for u, a in rows
    ]
    scores = [a.score for _, a in rows if a is not None and a.score is not None]
    return {
        "assignment": await service.assignment_out(session, assignment),
        "results": results,
        "enrolled_count": len(rows),
        "submitted_count": len(scores),
        "average_score": round(sum(scores) / len(scores), 2) if scores else None,
    }


@router.get("/student/assignments", response_model=list[AssignmentOut])
async def student_assignments(
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
    actor: User = Depends(require_student),
    session: AsyncSession = Depends(db_session),
):
    """List formal assignments available through current classroom enrollment."""
    rows = (
        await session.execute(
            select(QuizAssignment, QuizDraftVersion, Classroom, AssignmentAttempt)
            .join(QuizDraftVersion, QuizDraftVersion.id == QuizAssignment.version_id)
            .join(Classroom, Classroom.id == QuizAssignment.class_id)
            .join(Enrollment, Enrollment.class_id == Classroom.id)
            .outerjoin(
                AssignmentAttempt,
                (AssignmentAttempt.assignment_id == QuizAssignment.id)
                & (AssignmentAttempt.student_id == actor.id),
            )
            .where(Enrollment.student_id == actor.id, Classroom.is_archived.is_(False))
            .order_by(QuizAssignment.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
    ).all()
    return [await service.assignment_out(session, a, v, c, attempt) for a, v, c, attempt in rows]


@router.get("/student/assignments/{assignment_id}", response_model=AssignmentOut)
async def student_assignment(
    assignment_id: uuid.UUID,
    actor: User = Depends(require_student),
    session: AsyncSession = Depends(db_session),
):
    """Read an enrolled student assignment schedule and saved attempt state."""
    assignment = await service.accessible_assignment(session, assignment_id, actor)
    attempt = await session.scalar(
        select(AssignmentAttempt).where(
            AssignmentAttempt.assignment_id == assignment.id,
            AssignmentAttempt.student_id == actor.id,
        )
    )
    return await service.assignment_out(session, assignment, attempt=attempt)


@router.post("/student/assignments/{assignment_id}/start", response_model=AttemptOut)
async def start_assignment(
    assignment_id: uuid.UUID,
    response: Response,
    actor: User = Depends(require_student),
    session: AsyncSession = Depends(db_session),
):
    """Start or resume the student single durable assignment attempt."""
    assignment = await service.accessible_assignment(session, assignment_id, actor, lock=True)
    attempt = await session.scalar(
        select(AssignmentAttempt)
        .where(
            AssignmentAttempt.assignment_id == assignment.id,
            AssignmentAttempt.student_id == actor.id,
        )
        .with_for_update()
    )
    if attempt is None:
        service.ensure_open(assignment)
        attempt = AssignmentAttempt(
            assignment_id=assignment.id,
            student_id=actor.id,
            total_questions=len(await service.questions(session, assignment.version_id)),
        )
        session.add(attempt)
        await session.flush()
        response.status_code = 201
    else:
        if attempt.state == "in_progress":
            service.ensure_open(assignment)
        response.status_code = 200
    output = await service.attempt_out(session, assignment, attempt)
    await service.commit(session)
    return output


@router.get("/student/assignments/{assignment_id}/attempt", response_model=AttemptOut)
async def read_attempt(
    assignment_id: uuid.UUID,
    actor: User = Depends(require_student),
    session: AsyncSession = Depends(db_session),
):
    """Recover saved questions and answers without exposing answer keys."""
    assignment = await service.accessible_assignment(session, assignment_id, actor)
    attempt = await service.attempt_for(session, assignment, actor)
    # Saved progress remains readable after the deadline; new writes do not.
    return await service.attempt_out(session, assignment, attempt)


@router.put("/student/assignments/{assignment_id}/answers/{question_id}", response_model=AttemptOut)
async def save_answer(
    assignment_id: uuid.UUID,
    question_id: uuid.UUID,
    body: SaveAnswer,
    actor: User = Depends(require_student),
    session: AsyncSession = Depends(db_session),
):
    """Save an answer with idempotency and attempt revision checks."""
    assignment = await service.accessible_assignment(session, assignment_id, actor, lock=True)
    attempt = await service.attempt_for(session, assignment, actor, lock=True)
    return await service.save_answer(session, assignment, attempt, question_id, body)


@router.post("/student/assignments/{assignment_id}/submit", response_model=ResultOut)
async def submit_assignment(
    assignment_id: uuid.UUID,
    body: SubmitAttempt,
    idempotency_key: uuid.UUID = Header(alias="Idempotency-Key"),
    actor: User = Depends(require_student),
    session: AsyncSession = Depends(db_session),
):
    """Submit all answers atomically and record mastery evidence exactly once."""
    assignment = await service.accessible_assignment(session, assignment_id, actor, lock=True)
    attempt = await service.attempt_for(session, assignment, actor, lock=True)
    return await service.submit_attempt(
        session, assignment, attempt, body.expected_revision, idempotency_key
    )


@router.get("/student/assignments/{assignment_id}/result", response_model=ResultOut)
async def read_result(
    assignment_id: uuid.UUID,
    actor: User = Depends(require_student),
    session: AsyncSession = Depends(db_session),
):
    """Read owned results according to the quiz feedback release policy."""
    assignment = await service.accessible_assignment(session, assignment_id, actor)
    attempt = await service.attempt_for(session, assignment, actor)
    if attempt.state != "submitted":
        service.conflict("Hasil tersedia setelah jawaban dikirim.")
    return await service.result_out(session, assignment, attempt)

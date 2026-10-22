"""Persist an already-grounded batch without invoking a graph or model."""

from __future__ import annotations

import copy
import uuid
from typing import Literal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.material_service import resolve_tutoring_context
from database.models import ClassMaterial, Concept, LearningSession, QuizQuestion, QuizSession, User
from models.grounded_question import GroundedQuestion, GroundedQuestionBatch
from models.quiz import QuizStartResponse
from rag.source_bundle import MaterialScope, QuestionSourceBundle, material_evidence_matches


def grounded_batch_from_state(
    state: dict, scope: MaterialScope
) -> tuple[GroundedQuestionBatch, QuestionSourceBundle]:
    """Rehydrate the private batch and evidence bundle emitted by a graph node."""
    from rag.source_bundle import bundle_from_docs

    docs = state.get("quiz_source_docs") or state.get("retrieved_docs") or []
    bundle = bundle_from_docs(
        str(state.get("current_topic") or "latihan"), scope, [dict(row) for row in docs]
    )
    if not bundle.sources:
        raise HTTPException(409, "Sumber soal tidak tersedia. Buka ulang materi sebelum mencoba.")

    source_ids = [source.id for source in bundle.sources]
    candidates = []
    for row in state.get("quiz_questions") or []:
        refs = row.get("evidence_refs")
        if not refs:
            refs = [
                source_ids[index - 1]
                for index in row.get("source_indices") or []
                if type(index) is int and 1 <= index <= len(source_ids)
            ]
        try:
            candidates.append(
                GroundedQuestion.model_validate(
                    {
                        "text": row.get("text"),
                        "type": row.get("type", "spoken"),
                        "options": row.get("options") or [],
                        "expected_answer": row.get("expected_answer"),
                        "rubric": row.get("rubric") or {},
                        "explanation": row.get("explanation") or "",
                        "evidence_refs": refs or ["missing-evidence-reference"],
                        "objective": row.get("objective")
                        or f"Assess understanding of: {row.get('text', '')}",
                        "cognitive_level": row.get("cognitive_level") or "understanding",
                        "concept_id": row.get("concept_id") or "",
                        "difficulty": row.get("difficulty"),
                    }
                )
            )
        except Exception as error:
            raise HTTPException(
                409, "Soal kehilangan jejak sumber. Buat ulang dari materi yang tersedia."
            ) from error

    try:
        batch = GroundedQuestionBatch(
            questions=candidates,
            prompt_version=str(state.get("quiz_prompt_version") or ""),
            prompt_hash=str(state.get("quiz_prompt_hash") or ""),
            generation_calls=state.get("quiz_generation_calls", 1),
            verification_calls=state.get("quiz_verification_calls", 1),
        )
    except Exception as error:
        raise HTTPException(
            409, "Hasil generator belum memiliki jejak kualitas yang lengkap. Coba lagi."
        ) from error
    if any(not set(question.evidence_refs) <= set(source_ids) for question in batch.questions):
        raise HTTPException(409, "Kutipan soal tidak cocok dengan sumber yang tersedia.")
    return batch, bundle


async def persist_conversational_quiz(
    session: AsyncSession,
    student: User,
    state: dict,
    *,
    learning_session_id: uuid.UUID,
) -> QuizStartResponse | None:
    """Persist a quiz produced by the conversation graph under a canonical UUID."""
    from api.material_service import resolve_tutoring_context
    from rag.source_bundle import MaterialScope

    if state.get("assessment_managed") or not state.get("quiz_questions"):
        return None
    class_id = _optional_uuid(state.get("class_id"))
    material_id = _optional_uuid(state.get("material_id"))
    context = await resolve_tutoring_context(
        session, class_id, material_id, student, require_ready=True
    )
    material = await session.get(ClassMaterial, material_id) if material_id else None
    scope = MaterialScope(
        student_id=student.id,
        class_id=class_id,
        material_id=material_id,
        concept_id=_optional_uuid(state.get("current_concept_id")) if not context else None,
        content_version=material.content_version if material else None,
        mapping_version=material.mapping_version if material else None,
        subject_id=_optional_uuid(state.get("subject_id") or (context or {}).get("subject_id")),
        language=state.get("learning_profile", {}).get("language"),
    )
    batch, bundle = grounded_batch_from_state(state, scope)
    return await create_quiz_session_from_questions(
        session,
        student,
        batch,
        scope=scope,
        source_bundle=bundle,
        mode="tutor",
        base_state=state,
        learning_session_id=learning_session_id,
    )


async def create_quiz_session_from_questions(
    session: AsyncSession,
    student: User,
    batch: GroundedQuestionBatch,
    *,
    scope: MaterialScope,
    source_bundle: QuestionSourceBundle,
    mode: Literal["tutor", "assessment"],
    base_state: dict | None = None,
    learning_session_id: uuid.UUID | None = None,
) -> QuizStartResponse:
    """Validate source freshness, then persist a canonical quiz UUID and rows."""
    from api.assessment_service import as_uuid, question_out, snapshot
    from api.quiz_points import build_score_summary

    scope.validate()
    if scope.student_id != student.id or scope.authorized_teacher_id is not None:
        raise HTTPException(404, "Sesi belajar tidak ditemukan.")
    bundle_scope = source_bundle.scope
    if (
        not source_bundle.sources
        or bundle_scope.student_id != scope.student_id
        or bundle_scope.class_id != scope.class_id
        or bundle_scope.material_id != scope.material_id
        or bundle_scope.concept_id != scope.concept_id
        or (
            bundle_scope.content_version is not None
            and bundle_scope.content_version != scope.content_version
        )
        or (
            bundle_scope.mapping_version is not None
            and bundle_scope.mapping_version != scope.mapping_version
        )
    ):
        raise HTTPException(409, "Sumber soal tidak cocok dengan sesi belajar.")
    if not 1 <= len(batch.questions) <= 20:
        raise HTTPException(422, "Jumlah soal tidak valid.")
    source_ids = {source.id for source in source_bundle.sources}
    if any(not set(question.evidence_refs) <= source_ids for question in batch.questions):
        raise HTTPException(409, "Soal tidak memiliki evidence yang sesuai.")

    context = None
    material = None
    approved: list[dict] = []
    if scope.class_id is not None:
        if scope.material_id is None:
            raise HTTPException(409, "Pilih satu materi kelas sebelum membuat kuis.")
        material = await session.scalar(
            select(ClassMaterial).where(ClassMaterial.id == scope.material_id).with_for_update()
        )
        if material is None or material.class_id != scope.class_id:
            raise HTTPException(404, "Kelas atau materi tidak ditemukan.")
        context = await resolve_tutoring_context(
            session, scope.class_id, scope.material_id, student, require_ready=True
        )
        if (
            material.content_version != scope.content_version
            or material.mapping_version != scope.mapping_version
        ):
            raise HTTPException(409, "Materi berubah saat kuis disiapkan. Buka ulang materi.")
        approved = context.get("approved_material_concepts", []) if context else []
        approved_ids = {str(item["id"]) for item in approved}
        if any(not material_evidence_matches(source, scope) for source in source_bundle.sources):
            raise HTTPException(
                409,
                {
                    "code": "source_index_outdated",
                    "message": "Indeks materi perlu diproses ulang oleh guru sebelum membuat soal.",
                },
            )
    else:
        approved_ids = set()

    if learning_session_id is not None:
        learning_session = await session.scalar(
            select(LearningSession).where(
                LearningSession.id == learning_session_id,
                LearningSession.student_id == student.id,
                LearningSession.ended_at.is_(None),
            )
        )
        if learning_session is None:
            raise HTTPException(404, "Percakapan belajar tidak ditemukan.")

    sid = uuid.uuid4()
    questions: list[dict] = []
    for candidate in batch.questions:
        row = candidate.model_dump(mode="json")
        row["question_id"] = str(uuid.uuid4())
        row["source_indices"] = [
            index + 1
            for index, source in enumerate(source_bundle.sources)
            if source.id in candidate.evidence_refs
        ]
        cid = as_uuid(candidate.concept_id)
        if scope.material_id is not None:
            row["concept_id"] = str(cid) if cid is not None and str(cid) in approved_ids else ""
        else:
            concept = await session.get(Concept, cid) if cid is not None else None
            row["concept_id"] = str(cid) if concept is not None else ""
        questions.append(row)

    approved_primary = next((item["id"] for item in approved if item.get("is_primary")), None)
    state = copy.deepcopy(base_state or {})
    state.update(
        quiz_session_id=str(sid),
        quiz_n_questions=len(questions),
        quiz_questions=questions,
        quiz_question=questions[0],
        quiz_attempts=[],
        current_question_index=0,
        current_question_attempts=0,
        mastery_applied_attempts=0,
        quiz_score=0.0,
        cumulative_quiz_score=0.0,
        student_id=str(student.id),
        session_id=str(learning_session_id) if learning_session_id else state.get("session_id", ""),
        learning_session_id=str(learning_session_id) if learning_session_id else "",
        class_id=str(material.class_id) if material else None,
        material_id=str(material.id) if material else None,
        material_version=material.content_version if material else None,
        material_mapping_version=material.mapping_version if material else None,
        subject_id=context.get("subject_id") if context else str(scope.subject_id or "") or None,
        current_concept_id=str(scope.concept_id or approved_primary or ""),
        current_topic=context.get("material_title") if context else state.get("current_topic", ""),
        assessment_managed=True,
        assessment_kind=mode,
        quiz_policy_version=2,
        question_state="answering",
        last_review=None,
        review_question_id=None,
        hint_text=None,
        hinted_questions=[],
        first_answer_assisted={},
        quiz_prompt_version=batch.prompt_version,
        quiz_prompt_hash=batch.prompt_hash,
        quiz_generation_calls=batch.generation_calls,
        quiz_verification_calls=batch.verification_calls,
        quiz_source_docs=[
            {
                "id": source.chunk_id,
                "chunk_id": source.chunk_id,
                "evidence_id": source.id,
                "text": source.text,
                "material_id": str(source.material_id) if source.material_id else None,
                "source": source.source,
                "section_title": source.section_title,
                "content_version": source.content_version,
                "mapping_version": source.mapping_version,
                "document_hash": source.document_hash,
                "block_ids": list(source.block_ids),
                "spans": list(source.spans),
                "approved_concept_ids": list(source.approved_concept_ids),
            }
            for source in source_bundle.sources
        ],
        approved_material_concepts=approved,
    )
    state["score_summary"] = build_score_summary([], total_questions=len(questions)).model_dump()
    quiz = QuizSession(
        id=sid,
        student_id=student.id,
        concept_id=scope.concept_id,
        total_questions=len(questions),
        status="in_progress",
        assessment_state=snapshot(state),
    )
    session.add(quiz)
    await session.flush()
    for index, question in enumerate(questions):
        session.add(
            QuizQuestion(
                id=uuid.UUID(question["question_id"]),
                quiz_session_id=sid,
                order_index=index,
                question=question["text"],
                question_type=question["type"],
                options=question["options"],
                correct_answer=question["expected_answer"],
                concept_id=as_uuid(question.get("concept_id")),
                difficulty=question.get("difficulty") or "medium",
            )
        )
    await session.flush()
    first = question_out(questions[0], 0)
    return QuizStartResponse(
        quiz_session_id=sid,
        first_question=first,
        total_questions=len(questions),
        policy_version=2,
        score_presentation="session_total",
        score_summary=state["score_summary"],
        current_question=first,
        available_actions=["answer", "hint", "advance"] if mode == "tutor" else ["answer"],
    )


def _optional_uuid(value):
    if value is None or value == "":
        return None
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        return None

"""
KODMOD AI - Academic Cascade Deletion Helpers
=============================================

Functions to perform comprehensive, clean cascade deletion for Classrooms
and Subjects, ensuring no orphaned records or RESTRICT foreign-key violations
occur (including editorial assignments, attempts, answers, mastery events,
materials, concepts, documents, and disk assets).
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from api.material_assets import asset_root
from api.utils.uploads import delete_upload
from database.models import (
    AssignmentAnswer,
    AssignmentAttempt,
    AssignmentMasteryEvent,
    ClassActivity,
    ClassMaterial,
    Classroom,
    Concept,
    CurriculumChunk,
    Document,
    Enrollment,
    LearningSession,
    MaterialAsset,
    MaterialConcept,
    MaterialImport,
    QuizAssignment,
    QuizDraft,
    QuizDraftQuestion,
    QuizDraftVersion,
    QuizQuestion,
    QuizReviewEvent,
    QuizSession,
    Subject,
)

log = logging.getLogger(__name__)


async def cascade_delete_classroom(session: AsyncSession, classroom: Classroom) -> dict[str, Any]:
    """Permanently delete a Classroom and all its nested descendants.

    Descendants cleaned in order:
    1. Editorial Quiz Assignments -> Attempts -> Answers -> Mastery Events.
    2. Physical disk files from MaterialImport and MaterialAsset.
    3. Nullify LearningSession references.
    4. Classroom row delete (database cascades Enrollments, ClassActivity,
       ClassMaterial, MaterialRevision, MaterialLearningProgress, MaterialProgress,
       MaterialConcept, MaterialAsset, MaterialImport, DocumentChunk).
    """
    class_id = classroom.id
    class_name = classroom.name

    # 1. Clean up editorial assignments and their attempts/answers/mastery events
    assignment_ids = list(
        (
            await session.execute(
                select(QuizAssignment.id).where(QuizAssignment.class_id == class_id)
            )
        )
        .scalars()
        .all()
    )

    if assignment_ids:
        attempt_ids = list(
            (
                await session.execute(
                    select(AssignmentAttempt.id).where(
                        AssignmentAttempt.assignment_id.in_(assignment_ids)
                    )
                )
            )
            .scalars()
            .all()
        )
        if attempt_ids:
            answer_ids = list(
                (
                    await session.execute(
                        select(AssignmentAnswer.id).where(
                            AssignmentAnswer.attempt_id.in_(attempt_ids)
                        )
                    )
                )
                .scalars()
                .all()
            )
            if answer_ids:
                await session.execute(
                    delete(AssignmentMasteryEvent).where(
                        AssignmentMasteryEvent.answer_id.in_(answer_ids)
                    )
                )
                await session.execute(
                    delete(AssignmentAnswer).where(AssignmentAnswer.attempt_id.in_(attempt_ids))
                )
            await session.execute(
                delete(AssignmentAttempt).where(
                    AssignmentAttempt.assignment_id.in_(assignment_ids)
                )
            )
        await session.execute(
            delete(QuizAssignment).where(QuizAssignment.class_id == class_id)
        )

    # 2. Collect disk files before database cascade removes rows
    import_paths = list(
        (
            await session.execute(
                select(MaterialImport.stored_path).where(MaterialImport.class_id == class_id)
            )
        )
        .scalars()
        .all()
    )

    assets = list(
        (
            await session.execute(
                select(MaterialAsset.storage_key).where(MaterialAsset.class_id == class_id)
            )
        )
        .scalars()
        .all()
    )
    root = asset_root()
    asset_file_paths = [(root / key).resolve() for key in assets if key]

    # 3. Explicitly decouple learning sessions
    await session.execute(
        update(LearningSession)
        .where(LearningSession.class_id == class_id)
        .values(class_id=None, material_id=None)
    )

    # 4. Delete the Classroom row
    await session.delete(classroom)
    await session.flush()

    # 5. Remove disk files
    for path in import_paths:
        delete_upload(path)
    for p in asset_file_paths:
        try:
            p.unlink(missing_ok=True)
        except OSError:
            pass

    log.info("Cascade deleted classroom '%s' (%s)", class_name, class_id)
    return {
        "class_id": str(class_id),
        "name": class_name,
        "assignments_cleared": len(assignment_ids),
        "imports_cleared": len(import_paths),
        "assets_cleared": len(asset_file_paths),
    }


async def cascade_delete_subject(session: AsyncSession, subject: Subject) -> dict[str, Any]:
    """Permanently delete a Subject and all related classrooms, concepts,
    curriculum documents, and editorial quiz drafts.
    """
    subject_id = subject.id
    subject_name = subject.name

    # 1. Cascade delete all classrooms under this subject
    classrooms = list(
        (
            await session.execute(
                select(Classroom).where(
                    (Classroom.subject_id == subject_id)
                    | (func.lower(Classroom.subject) == func.lower(subject_name))
                )
            )
        )
        .scalars()
        .all()
    )
    for room in classrooms:
        await cascade_delete_classroom(session, room)

    # 2. Editorial quiz drafts and versions linked to this subject
    draft_ids = list(
        (
            await session.execute(
                select(QuizDraft.id).where(QuizDraft.subject_id == subject_id)
            )
        )
        .scalars()
        .all()
    )
    version_ids = list(
        (
            await session.execute(
                select(QuizDraftVersion.id).where(
                    (QuizDraftVersion.subject_id == subject_id)
                    | (QuizDraftVersion.draft_id.in_(draft_ids) if draft_ids else False)
                )
            )
        )
        .scalars()
        .all()
    )

    if version_ids:
        # Clear any dangling assignments pointing to these versions
        extra_assign_ids = list(
            (
                await session.execute(
                    select(QuizAssignment.id).where(QuizAssignment.version_id.in_(version_ids))
                )
            )
            .scalars()
            .all()
        )
        if extra_assign_ids:
            att_ids = list(
                (
                    await session.execute(
                        select(AssignmentAttempt.id).where(
                            AssignmentAttempt.assignment_id.in_(extra_assign_ids)
                        )
                    )
                )
                .scalars()
                .all()
            )
            if att_ids:
                ans_ids = list(
                    (
                        await session.execute(
                            select(AssignmentAnswer.id).where(
                                AssignmentAnswer.attempt_id.in_(att_ids)
                            )
                        )
                    )
                    .scalars()
                    .all()
                )
                if ans_ids:
                    await session.execute(
                        delete(AssignmentMasteryEvent).where(
                            AssignmentMasteryEvent.answer_id.in_(ans_ids)
                        )
                    )
                    await session.execute(
                        delete(AssignmentAnswer).where(AssignmentAnswer.attempt_id.in_(att_ids))
                    )
                await session.execute(
                    delete(AssignmentAttempt).where(
                        AssignmentAttempt.assignment_id.in_(extra_assign_ids)
                    )
                )
            await session.execute(
                delete(QuizAssignment).where(QuizAssignment.id.in_(extra_assign_ids))
            )

        await session.execute(
            delete(QuizDraftQuestion).where(QuizDraftQuestion.version_id.in_(version_ids))
        )
        await session.execute(
            delete(QuizReviewEvent).where(QuizReviewEvent.version_id.in_(version_ids))
        )
        await session.execute(
            delete(QuizDraftVersion).where(QuizDraftVersion.id.in_(version_ids))
        )

    if draft_ids:
        await session.execute(delete(QuizDraft).where(QuizDraft.id.in_(draft_ids)))

    # 3. Concepts under this subject
    concept_ids = list(
        (
            await session.execute(
                select(Concept.id).where(Concept.subject_id == subject_id)
            )
        )
        .scalars()
        .all()
    )

    if concept_ids:
        # Clear RESTRICT dependencies pointing to Concept
        await session.execute(
            delete(MaterialConcept).where(MaterialConcept.concept_id.in_(concept_ids))
        )
        await session.execute(
            delete(AssignmentMasteryEvent).where(
                AssignmentMasteryEvent.concept_id.in_(concept_ids)
            )
        )
        # Nullify non-cascade foreign keys pointing to Concept
        await session.execute(
            update(QuizDraftQuestion)
            .where(QuizDraftQuestion.concept_id.in_(concept_ids))
            .values(concept_id=None)
        )
        await session.execute(
            update(QuizQuestion)
            .where(QuizQuestion.concept_id.in_(concept_ids))
            .values(concept_id=None)
        )
        await session.execute(
            update(QuizSession)
            .where(QuizSession.concept_id.in_(concept_ids))
            .values(concept_id=None)
        )
        # Delete Concept rows (DB cascades Lessons, Exercises, MasteryScore, Misconceptions)
        await session.execute(delete(Concept).where(Concept.id.in_(concept_ids)))

    # 4. Curriculum Documents
    docs = list(
        (
            await session.execute(
                select(Document).where(Document.subject_id == subject_id)
            )
        )
        .scalars()
        .all()
    )
    doc_paths = [d.stored_path for d in docs]
    for d in docs:
        await session.delete(d)

    # 5. Nullify LearningSession subject reference
    await session.execute(
        update(LearningSession)
        .where(LearningSession.subject_id == subject_id)
        .values(subject_id=None)
    )

    # 6. Delete Subject itself
    await session.delete(subject)
    await session.flush()

    # 7. Remove physical documents from disk
    for path in doc_paths:
        delete_upload(path)

    log.info(
        "Cascade deleted subject '%s' (%s) with %d classes and %d concepts",
        subject_name,
        subject_id,
        len(classrooms),
        len(concept_ids),
    )
    return {
        "subject_id": str(subject_id),
        "name": subject_name,
        "classes_cleared": len(classrooms),
        "drafts_cleared": len(draft_ids),
        "concepts_cleared": len(concept_ids),
        "documents_cleared": len(docs),
    }

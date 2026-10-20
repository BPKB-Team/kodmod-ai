"""Public evidence projections. Never derive guidance from a mixed mastery snapshot."""

import hashlib
import json
from datetime import UTC, datetime

from sqlalchemy import or_, select

from analytics.student_model import LEARNING_RATE, mastery_at
from api.learning_progress import canonical_manifest, learning_progress_out
from database.models import (
    AssessmentSubmission,
    AssignmentAnswer,
    AssignmentAttempt,
    AssignmentMasteryEvent,
    ClassMaterial,
    Classroom,
    Concept,
    Enrollment,
    MasteryEvent,
    MaterialConcept,
    MaterialLearningProgress,
    QuizAssignment,
    QuizDraftVersion,
    QuizQuestionOutcome,
    QuizSession,
)


def aware(value):
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def official_practice_totals(sessions, attempts, outcomes):
    versions = {
        row.id: (row.assessment_state or {}).get("quiz_policy_version", 1) for row in sessions
    }
    legacy = [a for a in attempts if versions.get(a.quiz_session_id, 1) == 1]
    v2_attempts = len(attempts) - len(legacy)
    v2_questions = {
        getattr(a, "quiz_question_id", str(a.quiz_session_id))
        for a in attempts
        if versions.get(a.quiz_session_id, 1) == 2
    }
    return {
        "score_sum": sum(a.score for a in legacy) + sum(o.first_score for o in outcomes),
        "denominator": len(legacy) + len(outcomes),
        "correct": sum(a.is_correct for a in legacy) + sum(o.first_score >= 0.6 for o in outcomes),
        "n_support_attempts": max(0, v2_attempts - len(v2_questions)),
        "n_assisted_questions": sum(o.assisted for o in outcomes),
        "n_questions_answered": len(legacy) + sum(o.status == "answered" for o in outcomes),
        "legacy_attempts": len(legacy),
    }


def visible_concept_projection(events, *, now=None):
    # Filter before sorting, hashes, counts, labels or Planner input.
    visible = sorted(
        [e for e in events if e.get("visible", True) and not e.get("assisted", False)],
        key=lambda e: (aware(e["at"]), e["id"]),
    )
    now = now or datetime.now(UTC)
    grouped = {}
    for event in visible:
        cid = str(event["concept_id"])
        row = grouped.setdefault(
            cid,
            {
                "concept_id": cid,
                "concept_name": event["concept_name"],
                "mastery": 0.5,
                "last_seen": None,
                "questions": set(),
                "sessions": set(),
                "history": [],
            },
        )
        previous = (
            mastery_at(row["mastery"], row["last_seen"], now=aware(event["at"]))
            if row["last_seen"]
            else row["mastery"]
        )
        row["mastery"] = previous + (event["score"] - previous) * LEARNING_RATE * event.get(
            "confidence", 1
        )
        row["last_seen"] = aware(event["at"])
        row["questions"].add(str(event["question_id"]))
        row["sessions"].add(str(event["session_id"]))
        row["history"].append(
            {"date": row["last_seen"].date().isoformat(), "mastery": round(row["mastery"], 3)}
        )
    concepts = []
    for row in grouped.values():
        days = {h["date"]: h for h in row["history"]}
        sufficient = len(row["questions"]) >= 3 and len(row["sessions"]) >= 2
        current = round(mastery_at(row["mastery"], row["last_seen"], now=now), 3)
        concepts.append(
            {
                "concept_id": row["concept_id"],
                "concept_name": row["concept_name"],
                "mastery": current,
                "n_attempts": len(row["questions"]),
                "evidence_count": len(row["questions"]),
                "session_count": len(row["sessions"]),
                "enough_evidence": sufficient,
                "label": "strong"
                if sufficient and current >= 0.8
                else "needs_practice"
                if sufficient and current <= 0.6
                else "collect_evidence",
                "history": list(days.values())[-14:] if len(days) >= 2 else [],
                "last_seen": row["last_seen"].isoformat(),
            }
        )
    safe_hash = hashlib.sha256(
        json.dumps(
            [{**e, "at": aware(e["at"]).isoformat()} for e in visible], sort_keys=True
        ).encode()
    ).hexdigest()
    return {
        "mastery_available": bool(concepts),
        "overall_mastery": round(sum(c["mastery"] for c in concepts) / len(concepts), 3)
        if concepts
        else 0,
        "concept_evidence": concepts,
        "assessed_concepts": len(concepts),
        "visible_evidence_hash": safe_hash,
        "weak_concepts": sorted(
            [c for c in concepts if c["label"] == "needs_practice"], key=lambda c: c["mastery"]
        )[:5],
        "strong_concepts": sorted(
            [c for c in concepts if c["label"] == "strong"], key=lambda c: -c["mastery"]
        )[:5],
    }


async def public_progress(session, student_id, *, start=None, include_events=False):
    now = datetime.now(UTC)
    materials = (
        await session.execute(
            select(ClassMaterial, Classroom)
            .join(Classroom, ClassMaterial.class_id == Classroom.id)
            .join(
                Enrollment,
                (Enrollment.class_id == Classroom.id) & (Enrollment.student_id == student_id),
            )
            .where(Classroom.is_archived.is_(False), ClassMaterial.published.is_(True))
        )
    ).all()
    allowed = {str(m.id) for m, _ in materials}
    mappings = (
        (
            await session.execute(
                select(MaterialConcept, Concept)
                .join(Concept)
                .where(
                    MaterialConcept.material_id.in_([m.id for m, _ in materials]),
                    Concept.is_active.is_(True),
                )
            )
        ).all()
        if materials
        else []
    )
    progress = (
        await session.scalars(
            select(MaterialLearningProgress).where(
                MaterialLearningProgress.student_id == student_id
            )
        )
    ).all()
    by_key = {(p.material_id, p.content_version, p.unit_manifest_hash): p for p in progress}
    mapped_ids, material_rows = set(), []
    for material, room in materials:
        ids = [
            str(c.id)
            for mapping, c in mappings
            if mapping.material_id == material.id
            and mapping.content_version == material.content_version
            and mapping.mapping_version == material.mapping_version
            and c.subject_id == room.subject_id
        ]
        mapped_ids.update(ids)
        if not material.content.strip():
            continue
        manifest = canonical_manifest(material)
        row = by_key.get((material.id, material.content_version, manifest.unit_manifest_hash))
        material_rows.append(
            {
                "id": str(material.id),
                "class_id": str(room.id),
                "title": material.title,
                "concept_ids": ids,
                **learning_progress_out(
                    row,
                    content_version=material.content_version,
                    unit_manifest_hash=manifest.unit_manifest_hash,
                    total_units=len(manifest.units),
                ),
            }
        )
    events = []
    practice = (
        await session.execute(
            select(MasteryEvent, Concept, AssessmentSubmission, QuizSession)
            .join(Concept, MasteryEvent.concept_id == Concept.id)
            .join(AssessmentSubmission, MasteryEvent.submission_id == AssessmentSubmission.id)
            .join(QuizSession, AssessmentSubmission.quiz_session_id == QuizSession.id)
            .where(MasteryEvent.student_id == student_id, Concept.is_active.is_(True))
        )
    ).all()
    for event, concept, receipt, quiz in practice:
        source = event.source_snapshot or {}
        if source.get("material_id") and str(source["material_id"]) not in allowed:
            continue
        events.append(
            {
                "id": str(event.id),
                "concept_id": str(concept.id),
                "concept_name": concept.name,
                "score": event.score,
                "confidence": event.confidence,
                "session_id": str(quiz.id),
                "question_id": str(receipt.question_id),
                "at": event.created_at,
            }
        )
    # SQL release check is identical to result_out; aggregate grades are separate.
    formal = (
        await session.execute(
            select(AssignmentMasteryEvent, Concept, AssignmentAnswer, AssignmentAttempt)
            .join(Concept, AssignmentMasteryEvent.concept_id == Concept.id)
            .join(AssignmentAnswer, AssignmentMasteryEvent.answer_id == AssignmentAnswer.id)
            .join(AssignmentAttempt, AssignmentAnswer.attempt_id == AssignmentAttempt.id)
            .join(QuizAssignment, AssignmentAttempt.assignment_id == QuizAssignment.id)
            .join(QuizDraftVersion, QuizAssignment.version_id == QuizDraftVersion.id)
            .join(Classroom, QuizAssignment.class_id == Classroom.id)
            .join(
                Enrollment,
                (Enrollment.class_id == Classroom.id) & (Enrollment.student_id == student_id),
            )
            .where(
                AssignmentMasteryEvent.student_id == student_id,
                Concept.is_active.is_(True),
                Classroom.is_archived.is_(False),
                or_(
                    QuizDraftVersion.release_policy == "after_submission",
                    QuizAssignment.due_at <= now,
                ),
            )
        )
    ).all()
    for event, concept, answer, attempt in formal:
        events.append(
            {
                "id": str(event.id),
                "concept_id": str(concept.id),
                "concept_name": concept.name,
                "score": event.score,
                "confidence": 1,
                "session_id": str(attempt.id),
                "question_id": str(answer.question_id),
                "at": event.created_at,
            }
        )
    outcomes_q = (
        select(QuizQuestionOutcome)
        .join(QuizSession, QuizQuestionOutcome.quiz_session_id == QuizSession.id)
        .where(QuizSession.student_id == student_id)
    )
    if start:
        outcomes_q = outcomes_q.where(QuizQuestionOutcome.closed_at >= start)
    outcomes = (await session.scalars(outcomes_q)).all()
    return {
        **({"_visible_events": events} if include_events else {}),
        **visible_concept_projection(events, now=now),
        "mapped_concepts": len(mapped_ids),
        "unmapped_materials": sum(not m["concept_ids"] for m in material_rows),
        "learning_materials": material_rows,
        "materials_started": sum(m["status"] != "not_started" for m in material_rows),
        "materials_completed": sum(m["status"] == "completed" for m in material_rows),
        "completed_units": sum(m["completed_units"] for m in material_rows),
        "total_units": sum(m["total_units"] for m in material_rows),
    }, outcomes

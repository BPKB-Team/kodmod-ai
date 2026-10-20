"""
KODMOD AI - Quiz Agent (and Mini-Quiz)
=======================================

Implements two related but distinct nodes:

1. `quiz_node` - full quiz session driver from the **Quiz/Assessment cluster**.
   Asks the next question in `state["quiz_questions"]`, manages pacing,
   handles repeat / clarify side-requests.

2. `mini_quiz_node` - the lightweight quick-check inside the **Practices &
   Tutoring cluster** (the "Mini quiz" box in the Practices diagram).
   Generates a single on-the-fly check question after a tutoring explanation.

Both are designed for spoken delivery: questions are phrased to be
unambiguous when heard once, and never reference visuals.
"""

from __future__ import annotations

import logging
import time
from typing import Any
from uuid import uuid4

from graphs.state import KODMODState, QuizQuestion
from tools.llm_client import get_quiz_llm, language_instruction

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# 1. FULL QUIZ NODE
# ---------------------------------------------------------------------------

ASK_PROMPT = """\
You are the Quiz Host for KODMOD AI. The student is visually impaired and
will most likely hear this question read aloud.

Rules for spoken questions:
- One sentence stem, then options (if MCQ) prefixed by 'A,', 'B,', 'C,', 'D,'.
- No visual references.
- Numbers spoken in words for amounts under 20.
- For 'spoken' / 'explain' / 'reasoning' question types, do NOT list options -
  just ask the question and a brief framing like "explain in your own words".
- Always end with a clear closing prompt like "What's your answer?" or
  "Take your time."

Output ONLY the question text to be spoken. No prefixes, no JSON.
"""


async def quiz_node(state: KODMODState) -> dict[str, Any]:
    """Ask the next question in the quiz session."""
    questions = state.get("quiz_questions", [])
    idx = state.get("current_question_index", 0)
    english = state.get("learning_profile", {}).get("language") == "en"

    if not questions or idx >= len(questions):
        log.info("Quiz session has no more questions")
        return {
            "generated_response": (
                "Great! This quiz is complete. Let's review the results together."
                if english
                else "Bagus! Kuis ini sudah selesai. Mari kita lihat hasilnya bersama."
            ),
            "next_action": "analyze_quiz",
            "last_node": "quiz_ask",
        }

    q: QuizQuestion = questions[idx]
    question_number = idx + 1
    total = len(questions)

    # Render the question through the LLM so options/phrasing are spoken-friendly
    raw_q = q.get("text", "")
    options = q.get("options", []) or []
    qtype = q.get("type", "spoken")

    user_block = (
        f"Question {question_number} of {total}.\n"
        f"Type: {qtype}\n"
        f"Stem: {raw_q}\n"
        f"Options: {options if options else 'none'}"
    )

    llm = get_quiz_llm()
    response = await llm.ainvoke(
        [
            {
                "role": "system",
                "content": ASK_PROMPT
                + language_instruction(state.get("learning_profile", {}).get("language")),
            },
            {"role": "user", "content": user_block},
        ]
    )
    spoken_question = response.content if hasattr(response, "content") else str(response)

    # Prepend a tiny intro for the FIRST question of the session; for later
    # questions, carry the previous answer's feedback forward so the student
    # hears it before the next question, instead of losing it.
    if idx == 0:
        intro = (
            f"Let's begin the quiz. There are {total} questions. First question: "
            if english
            else f"Baik, kita mulai kuis. Ada {total} soal. Soal pertama: "
        )
        spoken_question = intro + spoken_question
    else:
        feedback = (state.get("generated_response") or "").strip()
        if feedback:
            transition = "Next question:" if english else "Soal berikutnya:"
            spoken_question = f"{feedback} {transition} {spoken_question}"

    log.info(
        "Asking question %d/%d (concept=%s, difficulty=%s)",
        question_number,
        total,
        q.get("concept_id"),
        q.get("difficulty"),
    )

    return {
        "quiz_question": q,
        "generated_response": spoken_question,
        "next_action": "speak",
        "last_node": "quiz_ask",
    }


# ---------------------------------------------------------------------------
# 2. MINI-QUIZ NODE  (inside Practices & Tutoring cluster)
# ---------------------------------------------------------------------------


async def mini_quiz_node(state: KODMODState) -> dict[str, Any]:
    """Create one source-grounded check, leaving persistence to the API boundary."""
    from agents.problem_generator import generate_grounded_questions
    from agents.question_quality import QuestionQualityError
    from rag.source_bundle import MaterialScope, QuestionSourceBundle, bundle_from_docs

    classroom_scope = bool(state.get("class_id") or state.get("material_id"))
    concept_id = "" if classroom_scope else state.get("current_concept_id", "")
    docs = state.get("quiz_source_docs") or state.get("retrieved_docs") or []
    topic = (state.get("current_topic") or "").strip()
    if not topic:
        topic = next(
            (
                str(doc.get("material_title") or "").strip()
                for doc in docs
                if doc.get("material_title")
            ),
            "materi kelas" if classroom_scope else str(concept_id or "materi"),
        )
    scope = MaterialScope(
        student_id=_optional_uuid(state.get("student_id")),
        class_id=_optional_uuid(state.get("class_id")),
        material_id=_optional_uuid(state.get("material_id")),
        concept_id=_optional_uuid(concept_id),
        subject_id=_optional_uuid(state.get("subject_id")),
        content_version=state.get("material_content_version") or state.get("material_version"),
        mapping_version=state.get("material_mapping_version"),
        language=state.get("learning_profile", {}).get("language"),
    )
    source_bundle = state.get("quiz_source_bundle")
    if not isinstance(source_bundle, QuestionSourceBundle):
        source_bundle = bundle_from_docs(topic, scope, [dict(doc) for doc in docs])
    quality_started = time.perf_counter()
    try:
        batch = await generate_grounded_questions(
            source_bundle,
            count=1,
            difficulty=state.get("current_difficulty", "medium"),
            language=state.get("learning_profile", {}).get("language") or "id",
            topic=topic,
            concept_id=concept_id,
            mastery=state.get("mastery_scores", {}),
            approved_concepts=state.get("approved_material_concepts", []),
        )
    except QuestionQualityError as error:
        from tools.learning_trace import LearningTraceEvent, record_learning_trace

        await record_learning_trace(
            LearningTraceEvent(
                student_id=_optional_uuid(state.get("student_id")),
                stage="verification" if error.code == "source_quality_failed" else "generation",
                node="mini_quiz",
                source_ids=[source.id for source in source_bundle.sources[:32]],
                quality_reasons=[error.code],
                latency_ms=min(180_000, round((time.perf_counter() - quality_started) * 1000)),
            )
        )
        log.info("Mini-quiz abstained: %s", error.code)
        message = (
            "I could not make a reliable check from the approved material."
            if state.get("learning_profile", {}).get("language") == "en"
            else "Materi yang tersedia belum cukup untuk membuat soal latihan yang tepercaya."
        )
        return {
            "quiz_questions": [],
            "quiz_question": {},
            "quiz_session_id": "",
            "quiz_quality_error_code": error.code,
            "generated_response": message,
            "next_action": "speak",
            "last_node": "mini_quiz",
        }

    from tools.learning_trace import record_grounded_batch

    await record_grounded_batch(
        node="mini_quiz",
        student_id=_optional_uuid(state.get("student_id")),
        source_ids=[source.id for source in source_bundle.sources],
        prompt_version=batch.prompt_version,
        generation_calls=batch.generation_calls,
        verification_calls=batch.verification_calls,
        latency_ms=round((time.perf_counter() - quality_started) * 1000),
    )

    candidate = batch.questions[0]
    source_rows = [
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
    ]
    question: QuizQuestion = {
        "question_id": str(uuid4()),
        "text": candidate.text,
        "type": candidate.type,
        "options": candidate.options,
        "expected_answer": candidate.expected_answer,
        "rubric": candidate.rubric,
        "concept_id": candidate.concept_id if not classroom_scope else "",
        "difficulty": candidate.difficulty or state.get("current_difficulty", "medium"),
        "evidence_refs": candidate.evidence_refs,
        "source_indices": [
            index + 1
            for index, source in enumerate(source_bundle.sources)
            if source.id in candidate.evidence_refs
        ],
        "objective": candidate.objective,
        "cognitive_level": candidate.cognitive_level,
        "explanation": candidate.explanation,
    }
    check_label = (
        "Quick understanding check:"
        if state.get("learning_profile", {}).get("language") == "en"
        else "Cek pemahaman cepat:"
    )
    explanation = (state.get("generated_response") or "").strip()
    question_text = candidate.text.strip()
    if candidate.options:
        question_text = f"{question_text} {' '.join(candidate.options)}"
    delivered = "\n\n".join(
        part for part in (explanation, f"{check_label} {question_text}") if part
    )
    return {
        "quiz_question": question,
        "quiz_questions": [question],
        "quiz_source_docs": source_rows,
        "current_question_index": 0,
        "current_question_attempts": 0,
        "quiz_attempts": [],
        "mastery_applied_attempts": 0,
        "student_answer": "",
        "cumulative_quiz_score": 0.0,
        # This transient ID lets the graph recognize the next turn as the
        # mini-quiz answer. The API replaces it with a canonical persisted ID.
        "quiz_session_id": f"mini-{uuid4().hex[:10]}",
        "assessment_managed": False,
        "assessment_kind": "tutor",
        "quiz_policy_version": 2,
        "question_state": "answering",
        "quiz_prompt_version": batch.prompt_version,
        "quiz_prompt_hash": batch.prompt_hash,
        "quiz_generation_calls": batch.generation_calls,
        "quiz_verification_calls": batch.verification_calls,
        "generated_response": delivered,
        "next_action": "speak",
        "last_node": "mini_quiz",
    }


def _optional_uuid(value):
    import uuid

    if not value:
        return None
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        return None

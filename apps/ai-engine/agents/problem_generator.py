"""
KODMOD AI - Problem Generator Agent
====================================

Top of the **Quiz/Assessment cluster** (and also fed by the **Content & Exercise
Management cluster**, see Image 4). Produces a list of `QuizQuestion`s
calibrated to the student's mastery profile.

Inputs from state
-----------------
* `current_concept_id` - what we're quizzing on
* `current_difficulty` - coarse difficulty knob
* `mastery_scores`     - per-concept history; used to pick neighboring concepts
                         to weave in (spiral curriculum)
* `learning_profile`   - language, pace preference

The agent uses the Content cluster's RAG to ground each question in real
curriculum material so we never hallucinate facts.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from hashlib import sha256
from pathlib import Path
from typing import Any, Literal, cast
from uuid import UUID, uuid4

from pydantic import BaseModel, Field, StrictInt

from agents.question_quality import (
    QuestionQualityError,
    check_batch_quality,
    verify_question_batch,
)
from analytics.student_model import StudentModel
from graphs.state import DifficultyLevel, KODMODState, QuizQuestion
from models.grounded_question import GroundedQuestion, GroundedQuestionBatch
from rag.source_bundle import (
    MaterialScope,
    QuestionSourceBundle,
    bundle_from_docs,
)
from tools.llm_client import get_quiz_llm, language_instruction
from tools.rag_tool import RAGTool

log = logging.getLogger(__name__)


QUIZ_PROMPT_PATH = Path(__file__).resolve().parents[1] / "prompts" / "quiz_generator.md"
MAX_GENERATION_CALLS = 3
GENERATION_TIMEOUT_SECONDS = 15


async def problem_generator_node(state: KODMODState) -> dict[str, Any]:
    requested_topic = (state.get("current_topic") or "").strip()
    classroom_scope = bool(state.get("class_id") or state.get("material_id"))
    subject_id = state.get("subject_id")
    # Only the server supplies reviewed classroom mappings. Never infer them
    # from the student's previous topic, global mastery or similar names.
    approved = state.get("approved_material_concepts", []) if classroom_scope else []
    allowed_concepts = {item["id"] for item in approved}
    mastery = state.get("mastery_scores", {})
    concept_id = ""
    if classroom_scope and approved:
        requested_concept = state.get("current_concept_id") or ""
        if requested_concept in allowed_concepts:
            concept_id = requested_concept
        else:
            candidates = [item for item in approved if item.get("primary")] or approved
            concept_id = min(
                candidates, key=lambda item: (mastery.get(item["id"], 0.5), item["id"])
            )["id"]
    elif not classroom_scope:
        concept_id = state.get("current_concept_id") or ""
        if not concept_id and requested_topic:
            concept_id = await _resolve_concept_id(requested_topic, subject_id) or ""
        if not concept_id:
            concept_id = _infer_concept(state)
    # Human-readable topic for the LLM. `concept_id` is often a UUID or "general",
    # which tells the model nothing - prefer an explicit topic label.
    topic = requested_topic or ("materi kelas" if classroom_scope else concept_id)
    difficulty: DifficultyLevel = state.get("current_difficulty", "medium")
    mastery_confidence = state.get("mastery_confidence", {})
    requested_n = int(state.get("quiz_n_questions") or 0)
    n_questions = requested_n if requested_n >= 1 else _decide_n_questions(state)

    # ---- Predict how the student would do on this concept right now, and
    # nudge difficulty toward the productive-struggle zone instead of the
    # coarse static default. See StudentModel.predict_correct_probability.
    # mastery_confidence travels alongside mastery_scores in state (see
    # graphs/state.py) so a concept touched once doesn't get treated as
    # confidently as one backed by many attempts.
    predicted_success = StudentModel(
        student_id=str(state.get("student_id", "")),
        _scores=dict(mastery),
        _confidence=dict(mastery_confidence),
    ).predict_correct_probability([concept_id] if concept_id else [])
    difficulty = _adjust_difficulty(difficulty, predicted_success)

    # ---- Pull curriculum context from the Content cluster (RAG) ---------
    # Scope by subject_id even when concept_id can't be resolved, so retrieval
    # never falls back to an unfiltered search over the whole curriculum table.
    filters: dict[str, Any] = {}
    if concept_id and not classroom_scope:
        filters["concept_id"] = concept_id
    if subject_id:
        filters["subject_id"] = subject_id
    if classroom_scope:
        filters.update(
            class_id=state.get("class_id"),
            material_id=state.get("material_id"),
            student_id=state.get("student_id"),
        )
        if not state.get("material_id") and concept_id:
            try:
                filters["concept_id"] = UUID(str(concept_id))
            except (ValueError, TypeError, AttributeError):
                pass
    docs: list[dict] = state.get("quiz_source_docs") or [
        dict(doc)
        for doc in await RAGTool().retrieve(
            query=f"{topic} learning material questions",
            k=6,
            filters=filters or None,
        )
    ]
    docs = [doc for doc in docs if str(doc.get("text", "")).strip()][:6]
    if not docs:
        raise ValueError("No approved source available for quiz generation")
    if classroom_scope and not requested_topic:
        topic = next(
            (str(doc["material_title"]).strip() for doc in docs if doc.get("material_title")),
            topic,
        )
    scope = _scope_from_state(state)
    bundle = state.get("quiz_source_bundle")
    if bundle is None:
        bundle = bundle_from_docs(topic, scope, docs)
    if not isinstance(bundle, QuestionSourceBundle):
        raise ValueError("Invalid source bundle for quiz generation")
    if not bundle.sources:
        raise ValueError("No approved source available for quiz generation")

    quality_started = time.perf_counter()
    try:
        batch = await generate_grounded_questions(
            bundle,
            count=n_questions,
            difficulty=difficulty,
            language=state.get("learning_profile", {}).get("language") or "id",
            only_mcq=bool(state.get("quiz_mcq_only")),
            topic=topic,
            concept_id=concept_id,
            mastery=mastery,
            predicted_success=predicted_success,
            approved_concepts=approved,
        )
    except QuestionQualityError as error:
        from tools.learning_trace import LearningTraceEvent, record_learning_trace

        await record_learning_trace(
            LearningTraceEvent(
                student_id=_optional_uuid(state.get("student_id")),
                stage="verification" if error.code == "source_quality_failed" else "generation",
                node="problem_generator",
                source_ids=[source.id for source in bundle.sources[:32]],
                quality_reasons=[error.code],
                latency_ms=min(180_000, round((time.perf_counter() - quality_started) * 1000)),
            )
        )
        raise
    from tools.learning_trace import record_grounded_batch

    await record_grounded_batch(
        node="problem_generator",
        student_id=_optional_uuid(state.get("student_id")),
        source_ids=[source.id for source in bundle.sources],
        prompt_version=batch.prompt_version,
        generation_calls=batch.generation_calls,
        verification_calls=batch.verification_calls,
        latency_ms=round((time.perf_counter() - quality_started) * 1000),
    )
    generated = batch.questions
    if (
        classroom_scope
        and approved
        and any(q.concept_id and q.concept_id not in allowed_concepts for q in generated)
    ):
        from tools.learning_trace import LearningTraceEvent, record_learning_trace

        await record_learning_trace(
            LearningTraceEvent(
                student_id=_optional_uuid(state.get("student_id")),
                stage="verification",
                node="problem_generator",
                source_ids=[source.id for source in bundle.sources[:32]],
                quality_reasons=["unapproved_concept"],
            )
        )
        raise QuestionQualityError("source_quality_failed", "Generated concept was not approved.")
    questions: list[QuizQuestion] = [
        QuizQuestion(
            question_id=str(uuid4()),
            text=q.text,
            type=q.type,
            options=q.options,
            expected_answer=q.expected_answer,
            rubric=q.rubric,
            concept_id=(q.concept_id if approved else "") if classroom_scope else concept_id,
            difficulty=cast(DifficultyLevel, q.difficulty or difficulty),
            source_indices=[
                index + 1
                for index, source in enumerate(bundle.sources)
                if source.id in q.evidence_refs
            ],
            explanation=q.explanation,
            evidence_refs=q.evidence_refs,
            objective=q.objective,
            cognitive_level=q.cognitive_level,
        )
        for q in generated
    ]
    log.info("Problem generator produced %d questions on concept=%s", len(questions), concept_id)

    quiz_session_id = f"quiz-{uuid4().hex[:10]}"
    return {
        "quiz_session_id": quiz_session_id,
        "quiz_questions": questions,
        "retrieved_docs": docs,
        "quiz_prompt_version": batch.prompt_version,
        "quiz_prompt_hash": batch.prompt_hash,
        "quiz_generation_calls": batch.generation_calls,
        "quiz_verification_calls": batch.verification_calls,
        "current_question_index": 0,
        "quiz_question": questions[0],
        "quiz_attempts": [],
        "mastery_applied_attempts": 0,
        "cumulative_quiz_score": 0.0,
        "next_action": "ask_question",
        "last_node": "problem_generator",
    }


async def generate_grounded_questions(
    bundle: QuestionSourceBundle,
    *,
    count: int,
    difficulty: str,
    language: str,
    only_mcq: bool = False,
    topic: str | None = None,
    concept_id: str = "",
    mastery: dict[str, float] | None = None,
    predicted_success: float | None = None,
    approved_concepts: list[dict] | None = None,
) -> GroundedQuestionBatch:
    """Generate, deterministically validate, and semantically verify a bounded batch."""
    if not 1 <= count <= 20:
        raise ValueError("Question count must be between one and twenty.")
    if not bundle.sources or not any(_source_has_content(item.text) for item in bundle.sources):
        raise QuestionQualityError(
            "insufficient_learning_content", "No substantive approved learning source is available."
        )

    prompt_version, prompt_hash, prompt_text = load_quiz_prompt()
    approved_ids = sorted(
        {
            str(concept_id)
            for source in bundle.sources
            for concept_id in source.approved_concept_ids
            if concept_id
        }
    )
    if approved_concepts:
        approved_ids = sorted(
            set(approved_ids)
            | {str(item.get("id")) for item in approved_concepts if item.get("id")}
        )
    context = {
        "request": {
            "topic": topic or bundle.query,
            "concept_id": concept_id,
            "approved_concepts": approved_concepts or approved_ids,
            "difficulty": difficulty,
            "mastery": mastery or {},
            "predicted_success_probability": round(predicted_success, 2)
            if predicted_success is not None
            else None,
            "language": language,
            "count": count,
            "mcq_only": only_mcq,
        },
        "sources": [
            {
                "evidence_id": source.id,
                "section_title": source.section_title,
                "source": source.source,
                "excerpt": source.text[:4000],
            }
            for source in bundle.sources[:6]
        ],
    }
    base_user_message = json.dumps(context, ensure_ascii=False, separators=(",", ":"))
    system_prompt = prompt_text
    if only_mcq:
        system_prompt += (
            "\nThis is a teacher review draft: every candidate must be MCQ with four choices, "
            "a correct answer letter, and a source-based explanation."
        )
    messages = [
        {"role": "system", "content": system_prompt + "\n\n" + language_instruction(language)},
        {"role": "user", "content": base_user_message},
    ]
    llm = get_quiz_llm()
    generation_calls = 0
    verification_calls = 0
    repair_reasons: list[dict[str, Any]] = []

    for _attempt in range(MAX_GENERATION_CALLS):
        generation_calls += 1
        try:
            current_messages = list(messages)
            if repair_reasons:
                current_messages.append(
                    {
                        "role": "user",
                        "content": json.dumps(
                            {"repair_reason_codes": repair_reasons},
                            ensure_ascii=False,
                            separators=(",", ":"),
                        ),
                    }
                )
            response = await asyncio.wait_for(
                llm.ainvoke(current_messages), timeout=GENERATION_TIMEOUT_SECONDS
            )
            raw = response.content if hasattr(response, "content") else str(response)
            candidates = _parse_grounded_candidates(raw, bundle, count)
            if only_mcq and any(
                candidate.type != "mcq" or not candidate.explanation.strip()
                for candidate in candidates
            ):
                repair_reasons = [
                    {"index": index, "reasons": ["unsupported_answer"]}
                    for index, candidate in enumerate(candidates)
                    if candidate.type != "mcq" or not candidate.explanation.strip()
                ]
                continue

            local = check_batch_quality(candidates, bundle)
            for index, candidate in enumerate(candidates):
                if (
                    candidate.concept_id
                    and approved_ids
                    and candidate.concept_id not in approved_ids
                ):
                    from models.grounded_question import QuestionQualityReason

                    local[index] = _decision_with_reason(
                        local[index], QuestionQualityReason.UNSUPPORTED_ANSWER
                    )
            if any(not decision.accepted for decision in local):
                repair_reasons = _rejection_summary(local)
                continue

            verification_calls += 1
            semantic = await verify_question_batch(candidates, bundle)
            if any(not decision.accepted for decision in semantic):
                repair_reasons = _rejection_summary(semantic)
                continue
            return GroundedQuestionBatch(
                questions=candidates,
                prompt_version=prompt_version,
                prompt_hash=prompt_hash,
                generation_calls=generation_calls,
                verification_calls=verification_calls,
            )
        except QuestionQualityError:
            raise
        except Exception as error:
            log.warning("Quiz candidate rejected (%s)", type(error).__name__)
            repair_reasons = [{"index": -1, "reasons": ["unsupported_answer"]}]

    raise QuestionQualityError(
        "source_quality_failed", "Quiz generation failed the source-quality contract."
    )


def load_quiz_prompt() -> tuple[str, str, str]:
    """Load the active prompt from disk and return its version and SHA-256."""
    content = QUIZ_PROMPT_PATH.read_text(encoding="utf-8")
    match = re.search(r"^<!--\s*prompt-version:\s*([a-zA-Z0-9._-]+)\s*-->\s*$", content, re.M)
    if match is None:
        raise ValueError("Quiz generator prompt must declare a prompt-version.")
    return match.group(1), sha256(content.encode("utf-8")).hexdigest(), content


def _parse_grounded_candidates(
    raw: str, bundle: QuestionSourceBundle, count: int
) -> list[GroundedQuestion]:
    cleaned = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    payload = json.loads(cleaned)
    if not isinstance(payload, dict) or not isinstance(payload.get("questions"), list):
        raise ValueError("Provider must return a question object with a questions list.")
    rows = payload["questions"]
    if len(rows) != count:
        raise ValueError("Provider returned a question count different from the request.")
    source_ids = [source.id for source in bundle.sources]
    result = []
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("Question candidate must be a JSON object.")
        value = dict(row)
        value["text"] = value.get("text") or value.get("question")
        value["type"] = value.get("type") or value.get("question_type") or "spoken"
        value["expected_answer"] = value.get("expected_answer") or value.get("correct_answer")
        refs = value.get("evidence_refs")
        if refs is None:
            indices = value.pop("source_indices", [])
            refs = [
                source_ids[index - 1]
                if type(index) is int and 1 <= index <= len(source_ids)
                else f"unknown-evidence-{index}"
                for index in indices
            ]
        value["evidence_refs"] = refs or ["missing-evidence-reference"]
        value["objective"] = value.get("objective") or f"Assess understanding of: {value['text']}"
        value["cognitive_level"] = value.get("cognitive_level") or _cognitive_for_type(
            value["type"]
        )
        value["concept_id"] = value.get("concept_id") or ""
        # Ignore IDs from old prompt formats; they are not question evidence.
        value.pop("id", None)
        result.append(GroundedQuestion.model_validate(value))
    return result


def _cognitive_for_type(question_type: str) -> str:
    return {
        "mcq": "recall",
        "spoken": "recall",
        "explain": "understanding",
        "step_by_step": "application",
        "reasoning": "reasoning",
    }.get(question_type, "recall")


def _scope_from_state(state: KODMODState) -> MaterialScope:
    return MaterialScope(
        student_id=_optional_uuid(state.get("student_id")),
        authorized_teacher_id=_optional_uuid(state.get("authorized_teacher_id")),
        class_id=_optional_uuid(state.get("class_id")),
        material_id=_optional_uuid(state.get("material_id")),
        concept_id=_optional_uuid(state.get("current_concept_id")),
        subject_id=_optional_uuid(state.get("subject_id")),
        content_version=state.get("material_content_version") or state.get("material_version"),
        mapping_version=state.get("material_mapping_version"),
        language=state.get("learning_profile", {}).get("language"),
    )


def _optional_uuid(value: Any) -> UUID | None:
    if value is None or value == "":
        return None
    try:
        return UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        return None


def _source_has_content(text: str) -> bool:
    from agents.question_quality import _MATH_SOURCE
    from api.learning_content import is_learning_text

    return is_learning_text(text) or bool(_MATH_SOURCE.search(text))


def _decision_with_reason(decision, reason):
    from models.grounded_question import QuestionQualityDecision

    reasons = list(dict.fromkeys([*decision.reasons, reason]))
    return QuestionQualityDecision(accepted=False, reasons=reasons)


def _rejection_summary(decisions) -> list[dict[str, Any]]:
    return [
        {"index": index, "reasons": [reason.value for reason in decision.reasons]}
        for index, decision in enumerate(decisions)
        if not decision.accepted
    ]


async def generate_questions_for_student(
    *,
    student_id: Any,
    concept_id: Any | None = None,
    n: int = 5,
    difficulty_hint: str | None = None,
    topic_hint: str | None = None,
) -> list[dict[str, Any]]:
    """
    Adapter used by ``POST /exercise/generate`` and ``tools/quiz_generator_tool`` -
    wraps :func:`problem_generator_node` and returns plain dicts
    (``ExerciseGenerateResponse.exercises`` is ``list[dict]``).
    """
    state: KODMODState = {
        "student_id": str(student_id),
        "current_concept_id": str(concept_id) if concept_id else "",
        "current_topic": topic_hint or "",
        "current_difficulty": cast(DifficultyLevel, difficulty_hint or "medium"),
        "mastery_scores": {},
        "quiz_n_questions": n,
    }
    result = await problem_generator_node(state)
    return [dict(q) for q in result.get("quiz_questions", [])][:n]


# ---------------------------------------------------------------------------
# Heuristics
# ---------------------------------------------------------------------------


class GeneratedQuestion(BaseModel):
    concept_id: str = ""
    text: str = Field(min_length=1, max_length=4000)
    type: Literal["mcq", "spoken", "explain", "reasoning", "step_by_step"] = "spoken"
    options: list[str] = Field(default_factory=list)
    expected_answer: str = Field(min_length=1, max_length=4000)
    rubric: dict = Field(default_factory=dict)
    explanation: str = Field(default="", max_length=4000)
    source_indices: list[StrictInt] = Field(default_factory=list)
    difficulty: Literal["beginner", "easy", "medium", "hard", "expert"] | None = None


def validate_generated_questions(raw, count, source_count, *, require_sources=True, only_mcq=False):
    cleaned = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    payload = json.loads(cleaned)
    if not isinstance(payload, dict) or not isinstance(payload.get("questions"), list):
        raise ValueError("Expected a question set")
    if len(payload["questions"]) != count:
        raise ValueError("Question count does not match request")
    result, seen = [], set()
    for value in payload["questions"]:
        q = GeneratedQuestion.model_validate(value)
        q.text, q.expected_answer = q.text.strip(), q.expected_answer.strip()
        identity = " ".join(q.text.casefold().split())
        if not identity or identity in seen or not q.expected_answer:
            raise ValueError("Empty or duplicate question/answer")
        if q.expected_answer.casefold() in {
            "(open-ended)",
            "open-ended",
            "...",
            "tbd",
            "placeholder",
            "n/a",
        }:
            raise ValueError("Placeholder answer is not gradable")
        if require_sources and not q.source_indices:
            raise ValueError("Missing source attribution")
        if any(type(i) is not int or not 1 <= i <= source_count for i in q.source_indices):
            raise ValueError("Unknown source")
        if q.type == "mcq":
            options = [option.strip() for option in q.options]
            if len(options) != 4 or len(set(options)) != 4 or any(not o for o in options):
                raise ValueError("MCQ requires four different choices")
            allowed = {"a", "b", "c", "d"} | {o.casefold() for o in options}
            if q.expected_answer.casefold().rstrip(".") not in allowed:
                raise ValueError("MCQ answer does not identify a choice")
        elif q.options:
            raise ValueError("Only MCQ has options")
        if only_mcq and (q.type != "mcq" or not q.explanation.strip()):
            raise ValueError("Teacher draft requires MCQ with explanation")
        seen.add(identity)
        result.append(q)
    return result


_DIFFICULTY_LADDER: list[DifficultyLevel] = ["beginner", "easy", "medium", "hard", "expert"]


def _adjust_difficulty(current: DifficultyLevel, predicted_success: float) -> DifficultyLevel:
    """Step difficulty up or down from `predicted_success` (see
    StudentModel.predict_correct_probability), keeping questions in the
    productive-struggle zone instead of handing out ones already predicted
    trivial or hopeless at the student's current mastery.

    One rung per turn, not a jump straight to the extreme - a single quiz
    round shouldn't swing a "beginner" question to "expert" off one signal.
    """
    idx = _DIFFICULTY_LADDER.index(current) if current in _DIFFICULTY_LADDER else 2
    if predicted_success >= 0.85:
        idx = min(idx + 1, len(_DIFFICULTY_LADDER) - 1)
    elif predicted_success <= 0.35:
        idx = max(idx - 1, 0)
    return _DIFFICULTY_LADDER[idx]


def _decide_n_questions(state: KODMODState) -> int:
    """Use student profile + emotional state to pick quiz length."""
    emotion = state.get("emotional_state", "neutral")
    if emotion in ("fatigued", "frustrated"):
        return 3
    if emotion == "motivated":
        return 7
    return 5


async def _resolve_concept_id(topic: str, subject_id: str | None) -> str | None:
    """Match a spoken topic (e.g. "pecahan") to a real `concepts` row.

    Free text from the student is not a concept_id, so without this the RAG
    filter below silently drops (`_coerce_uuid` rejects non-UUIDs) and
    retrieval becomes unfiltered. Best-effort: any DB hiccup just falls
    through to `_infer_concept`.
    """
    import uuid

    from sqlalchemy import select

    from database.models import Concept
    from database.session import async_session

    try:
        sid: uuid.UUID | None = None
        if subject_id:
            try:
                sid = uuid.UUID(str(subject_id))
            except (ValueError, TypeError):
                sid = None
        async with async_session() as session:
            stmt = select(Concept.id).where(Concept.name.ilike(f"%{topic}%"))
            if sid is not None:
                stmt = stmt.where(Concept.subject_id == sid)
            match = (await session.execute(stmt.limit(1))).scalar_one_or_none()
            return str(match) if match else None
    except Exception:  # pragma: no cover - a lookup miss must not block a quiz
        log.warning("Concept lookup failed for topic=%r", topic, exc_info=True)
        return None


def _infer_concept(state: KODMODState) -> str:
    """If no concept_id is set, pick the weakest mastered concept."""
    scores = state.get("mastery_scores", {})
    if not scores:
        return "general"
    return min(scores.items(), key=lambda kv: kv[1])[0]

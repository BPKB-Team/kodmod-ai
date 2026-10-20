"""Mini-quiz attribution and persistence boundaries for classroom tutoring."""

import uuid
from unittest.mock import AsyncMock

import pytest

from agents import quiz_agent
from analytics import student_model
from models.grounded_question import GroundedQuestion, GroundedQuestionBatch

pytestmark = [pytest.mark.unit]


@pytest.mark.parametrize("requested_topic", ["", "Pecahan senilai"])
async def test_classroom_mini_quiz_uses_selected_material_evidence_without_stale_concept(
    monkeypatch, requested_topic
):
    stale_concept = str(uuid.uuid4())
    class_id, material_id, student_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    source = {
        "chunk_id": "fraction-block-1",
        "evidence_id": "fraction-evidence-1",
        "text": "Pecahan senilai mempunyai nilai yang sama. Satu per dua setara dua per empat.",
        "source": "pecahan.pdf",
        "material_title": "Pecahan senilai",
        "class_id": str(class_id),
        "material_id": str(material_id),
        "content_version": 1,
        "mapping_version": 0,
        "document_hash": "f" * 64,
        "block_ids": ["block-1"],
        "spans": [{"block_id": "block-1", "page": 2}],
    }
    captured = {}

    async def generate(bundle, **kwargs):
        captured["bundle"] = bundle
        captured.update(kwargs)
        return GroundedQuestionBatch(
            questions=[
                GroundedQuestion(
                    text="Pecahan apa yang senilai dengan satu per dua?",
                    type="spoken",
                    expected_answer="Dua per empat.",
                    evidence_refs=[bundle.sources[0].id],
                    objective="Mengidentifikasi pecahan yang senilai.",
                    cognitive_level="understanding",
                    concept_id=kwargs["concept_id"],
                    difficulty="easy",
                )
            ],
            prompt_version="grounded-question-v1",
            prompt_hash="a" * 64,
            generation_calls=1,
            verification_calls=1,
        )

    monkeypatch.setattr("agents.problem_generator.generate_grounded_questions", generate)
    result = await quiz_agent.mini_quiz_node(
        {
            "student_id": str(student_id),
            "class_id": str(class_id),
            "material_id": str(material_id),
            "material_version": 1,
            "material_mapping_version": 0,
            "current_topic": requested_topic,
            "current_concept_id": stale_concept,
            "generated_response": "Tutor explanation must not become quiz evidence.",
            "retrieved_docs": [source],
        }
    )

    assert result["quiz_question"]["concept_id"] == ""
    assert result["quiz_questions"][0]["concept_id"] == ""
    assert captured["topic"] == "Pecahan senilai"
    assert captured["concept_id"] == ""
    assert stale_concept not in repr(captured["bundle"].scope)
    assert "Tutor explanation must not become quiz evidence." not in repr(captured["bundle"])
    assert captured["bundle"].sources[0].id == "fraction-evidence-1"


@pytest.mark.parametrize("assessment_managed", [False, True])
async def test_mini_quiz_answer_routes_without_storing_ephemeral_session(
    monkeypatch, assessment_managed
):
    from graphs.main_graph import route_after_intent

    source = {
        "chunk_id": "fraction-block-1",
        "evidence_id": "fraction-evidence-1",
        "text": "Pecahan senilai mempunyai nilai yang sama. Satu per dua setara dua per empat.",
        "document_hash": "f" * 64,
        "block_ids": ["block-1"],
        "spans": [{"block_id": "block-1", "page": 2}],
    }
    store = AsyncMock()

    async def generate(bundle, **kwargs):
        return GroundedQuestionBatch(
            questions=[
                GroundedQuestion(
                    text="Apa arti pecahan senilai?",
                    type="spoken",
                    expected_answer="Pecahan dengan nilai sama.",
                    evidence_refs=[bundle.sources[0].id],
                    objective="Menjelaskan kesetaraan nilai pecahan.",
                    cognitive_level="understanding",
                    concept_id=kwargs["concept_id"],
                    difficulty="easy",
                )
            ],
            prompt_version="grounded-question-v1",
            prompt_hash="a" * 64,
            generation_calls=1,
            verification_calls=1,
        )

    monkeypatch.setattr("agents.problem_generator.generate_grounded_questions", generate)
    monkeypatch.setattr("memory.short_term.store_quiz_session", store)
    monkeypatch.setattr("tools.learning_trace.record_grounded_batch", AsyncMock())
    result = await quiz_agent.mini_quiz_node(
        {
            "session_id": "session-1",
            "student_id": str(uuid.uuid4()),
            "current_concept_id": str(uuid.uuid4()),
            "assessment_managed": assessment_managed,
            "retrieved_docs": [source],
        }
    )

    answer_turn = {**result, "intent": "quiz", "student_answer": "Pecahan senilai"}
    assert route_after_intent(answer_turn) == "scoring"
    assert result["quiz_prompt_version"] == "grounded-question-v1"
    store.assert_not_awaited()


async def test_standalone_mini_quiz_keeps_its_selected_concept(monkeypatch):
    concept_id = str(uuid.uuid4())
    source = {
        "chunk_id": "fraction-block-1",
        "evidence_id": "fraction-evidence-1",
        "text": "Pecahan senilai mempunyai nilai yang sama. Satu per dua setara dua per empat.",
    }
    captured = {}

    async def generate(bundle, **kwargs):
        captured["concept_id"] = kwargs["concept_id"]
        return GroundedQuestionBatch(
            questions=[
                GroundedQuestion(
                    text="Apa arti pecahan senilai?",
                    type="spoken",
                    expected_answer="Pecahan dengan nilai sama.",
                    evidence_refs=[bundle.sources[0].id],
                    objective="Menjelaskan kesetaraan nilai pecahan.",
                    cognitive_level="understanding",
                    concept_id=kwargs["concept_id"],
                    difficulty="easy",
                )
            ],
            prompt_version="grounded-question-v1",
            prompt_hash="a" * 64,
            generation_calls=1,
            verification_calls=1,
        )

    monkeypatch.setattr("agents.problem_generator.generate_grounded_questions", generate)
    result = await quiz_agent.mini_quiz_node(
        {
            "student_id": str(uuid.uuid4()),
            "current_concept_id": concept_id,
            "retrieved_docs": [source],
        }
    )

    assert result["quiz_question"]["concept_id"] == concept_id
    assert captured["concept_id"] == concept_id


@pytest.mark.parametrize("managed", [False, True])
@pytest.mark.parametrize("scope", ["class", "material", "selected_material"])
async def test_old_scoped_mini_quiz_uuid_never_updates_global_mastery(monkeypatch, managed, scope):
    existing_concept, stale_concept = str(uuid.uuid4()), str(uuid.uuid4())
    student_id = str(uuid.uuid4())
    model = student_model.StudentModel(
        student_id,
        _scores={existing_concept: 0.7},
        _confidence={existing_concept: 0.8},
        _attempts={existing_concept: 4},
    )
    load, persist, store, clear = (
        AsyncMock(return_value=model),
        AsyncMock(),
        AsyncMock(),
        AsyncMock(),
    )
    monkeypatch.setattr(student_model.StudentModel, "load", load)
    monkeypatch.setattr(student_model.StudentModel, "persist", persist)
    monkeypatch.setattr("memory.short_term.store_quiz_session", store)
    monkeypatch.setattr("memory.short_term.clear_quiz_session", clear)
    result = await student_model.update_student_model_node(
        {
            "student_id": student_id,
            "session_id": "old-mini-quiz",
            "assessment_managed": managed,
            "class_id": None if scope == "material" else str(uuid.uuid4()),
            "material_id": None if scope == "class" else str(uuid.uuid4()),
            "mastery_scores": {existing_concept: 0.7},
            "mastery_confidence": {existing_concept: 0.8},
            "quiz_questions": [{"question_id": "old-q", "concept_id": stale_concept}],
            "quiz_attempts": [{"question_id": "old-q", "score": 1.0, "confidence": 0.9}],
            "current_question_index": 0,
        }
    )
    assert result["mastery_scores"] == {existing_concept: 0.7}
    assert result["mastery_confidence"] == {existing_concept: 0.8}
    assert model._attempts == {existing_concept: 4}
    assert result["mastery_applied_attempts"] == 1
    assert result["current_question_index"] == 1
    persist.assert_not_called()
    store.assert_not_called()
    if managed:
        load.assert_not_called()
        clear.assert_not_called()
    else:
        clear.assert_awaited_once_with("old-mini-quiz")

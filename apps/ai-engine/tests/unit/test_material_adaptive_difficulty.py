"""Approved material concepts guide adaptation without replacing attribution."""

import json
import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from agents import problem_generator
from database import models as db
from tests.assessment_test import assessment_http as assessment_http

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]

PRIMARY = "11111111-1111-4111-8111-111111111111"
SECONDARY = "22222222-2222-4222-8222-222222222222"
UNAPPROVED = "33333333-3333-4333-8333-333333333333"
SOURCE = {
    "chunk_id": "adaptive-pecahan-source",
    "text": "Setengah adalah satu dari dua bagian sama besar. Seperempat adalah satu dari empat bagian sama besar.",
}


def material_state(**changes):
    return {
        "class_id": str(uuid.uuid4()),
        "material_id": str(uuid.uuid4()),
        "student_id": str(uuid.uuid4()),
        "approved_material_concepts": [{"id": PRIMARY, "name": "Pecahan", "primary": True}],
        "current_topic": "Materi pecahan",
        "current_difficulty": "medium",
        "quiz_n_questions": 1,
        "quiz_source_docs": [SOURCE],
        "assessment_managed": True,
        "mastery_confidence": {PRIMARY: 1.0, SECONDARY: 1.0, UNAPPROVED: 1.0},
        **changes,
    }


def generation(monkeypatch, concept_ids=(PRIMARY,)):
    prompts = []

    class LLM:
        async def ainvoke(self, messages):
            prompts.append(json.loads(messages[1]["content"]))
            return SimpleNamespace(
                content=json.dumps(
                    {
                        "questions": [
                            {
                                "text": f"Apa arti pecahan nomor {index + 1}?",
                                "type": "spoken",
                                "expected_answer": "Satu bagian dari beberapa bagian sama besar",
                                "source_indices": [1],
                                "concept_id": concept,
                            }
                            for index, concept in enumerate(concept_ids)
                        ]
                    }
                )
            )

    monkeypatch.setattr(problem_generator, "get_quiz_llm", LLM)
    return prompts


@pytest.mark.parametrize(
    ("score", "difficulty", "probability"),
    [(0.1, "easy", "0.02"), (0.9, "hard", "0.98"), (0.5, "medium", "0.50")],
)
async def test_material_difficulty_uses_current_primary_mastery(
    monkeypatch, score, difficulty, probability
):
    prompts = generation(monkeypatch)
    result = await problem_generator.problem_generator_node(
        material_state(mastery_scores={PRIMARY: score})
    )
    assert result["quiz_questions"][0]["difficulty"] == difficulty
    assert prompts[0]["request"]["predicted_success_probability"] == float(probability)
    assert prompts[0]["request"]["concept_id"] == PRIMARY


@pytest.mark.parametrize("explicit", [True, False])
async def test_requested_approved_target_precedes_primary_without_multiplying_concepts(
    monkeypatch, explicit
):
    target = SECONDARY if explicit else PRIMARY
    prompts = generation(monkeypatch, (target,))
    result = await problem_generator.problem_generator_node(
        material_state(
            approved_material_concepts=[
                {"id": PRIMARY, "primary": True},
                {"id": SECONDARY, "primary": False},
            ],
            current_concept_id=SECONDARY if explicit else "",
            mastery_scores={PRIMARY: 0.9, SECONDARY: 0.1},
        )
    )
    assert result["quiz_questions"][0]["difficulty"] == ("easy" if explicit else "hard")
    assert prompts[0]["request"]["concept_id"] == target


async def test_no_primary_targets_weakest_approved_concept(monkeypatch):
    prompts = generation(monkeypatch, (SECONDARY,))
    result = await problem_generator.problem_generator_node(
        material_state(
            approved_material_concepts=[{"id": PRIMARY}, {"id": SECONDARY}],
            mastery_scores={PRIMARY: 0.9, SECONDARY: 0.1, UNAPPROVED: 0.0},
        )
    )
    assert result["quiz_questions"][0]["difficulty"] == "easy"
    assert prompts[0]["request"]["concept_id"] == SECONDARY


async def test_stale_unapproved_target_never_drives_material_difficulty(monkeypatch):
    prompts = generation(monkeypatch)
    result = await problem_generator.problem_generator_node(
        material_state(
            current_concept_id=UNAPPROVED, mastery_scores={PRIMARY: 0.9, UNAPPROVED: 0.0}
        )
    )
    assert result["quiz_questions"][0]["difficulty"] == "hard"
    assert prompts[0]["request"]["concept_id"] == PRIMARY


async def test_unmapped_material_has_neutral_difficulty_and_no_fabricated_attribution(monkeypatch):
    prompts = generation(monkeypatch, ("",))
    result = await problem_generator.problem_generator_node(
        material_state(
            approved_material_concepts=[],
            current_concept_id=UNAPPROVED,
            mastery_scores={UNAPPROVED: 0.9},
        )
    )
    assert result["quiz_questions"][0]["difficulty"] == "medium"
    assert result["quiz_questions"][0]["concept_id"] == ""
    assert prompts[0]["request"]["concept_id"] == ""


async def test_adaptation_keeps_each_question_actual_approved_concept(monkeypatch):
    generation(monkeypatch, (PRIMARY, SECONDARY))
    result = await problem_generator.problem_generator_node(
        material_state(
            quiz_n_questions=2,
            approved_material_concepts=[{"id": PRIMARY, "primary": True}, {"id": SECONDARY}],
            mastery_scores={PRIMARY: 0.9, SECONDARY: 0.1},
        )
    )
    assert [q["concept_id"] for q in result["quiz_questions"]] == [PRIMARY, SECONDARY]


async def test_material_adaptation_keeps_retrieval_scoped_to_student_class_material(monkeypatch):
    generation(monkeypatch)
    state = material_state(quiz_source_docs=[], mastery_scores={PRIMARY: 0.9})

    async def retrieve(_self, query, k=None, filters=None):
        allowed = {key: state[key] for key in ("class_id", "material_id", "student_id")}
        # Classroom chunks do not require a single canonical Concept column.
        return [SOURCE] if filters == allowed else []

    monkeypatch.setattr(problem_generator.RAGTool, "retrieve", retrieve)
    result = await problem_generator.problem_generator_node(state)
    assert result["quiz_questions"][0]["difficulty"] == "hard"


async def test_material_http_adapts_to_reviewed_primary_and_rejects_mixed_scope(
    assessment_http, monkeypatch
):
    client, factory, controls, graph, primary, _ = assessment_http
    async with factory.kw["bind"].begin() as connection:
        await connection.run_sync(lambda c: db.MaterialConcept.__table__.create(c))
    async with factory() as session:
        teacher = db.User(
            username="adaptive-teacher", full_name="Guru", password_hash="fixture", role="teacher"
        )
        session.add(teacher)
        await session.flush()
        secondary = db.Concept(
            subject_id=primary.subject_id, name="Perbandingan", slug="adaptive-secondary"
        )
        unapproved = db.Concept(
            subject_id=primary.subject_id, name="Lain", slug="adaptive-unapproved"
        )
        room = db.Classroom(
            teacher_id=teacher.id, name="Kelas", subject="Matematika", subject_id=primary.subject_id
        )
        session.add_all([secondary, unapproved, room])
        await session.flush()
        material = db.ClassMaterial(
            class_id=room.id,
            title="Pecahan dan perbandingan",
            content=SOURCE["text"],
            published=True,
            rag_status="ready",
            indexed_version=1,
            n_chunks=1,
            mapping_version=1,
            indexed_mapping_version=1,
        )
        session.add(material)
        await session.flush()
        session.add(db.Enrollment(class_id=room.id, student_id=controls["actor"].id))
        session.add_all(
            [
                db.MaterialConcept(
                    material_id=material.id,
                    content_version=1,
                    mapping_version=1,
                    concept_id=c.id,
                    approved_by=teacher.id,
                    is_primary=c.id == primary.id,
                )
                for c in (primary, secondary)
            ]
        )
        mastery = await session.scalar(select(db.MasteryScore))
        mastery.mastery, mastery.confidence = 0.9, 1.0
        await session.commit()

    generation(monkeypatch, (str(primary.id),))

    async def generate(state, config=None):
        # Exercise real selection, probability, quality checks and attribution;
        # replace only the external LLM and the graph transport at this boundary.
        generated = await problem_generator.problem_generator_node(
            state | {"quiz_source_docs": [SOURCE]}
        )
        return state | generated

    monkeypatch.setattr(graph, "ainvoke", generate)
    body = {
        "class_id": str(room.id),
        "material_id": str(material.id),
        "n_questions": 1,
    }
    response = await client.post("/quiz/start", json=body)
    assert response.status_code == 200, response.text
    assert response.json()["first_question"]["difficulty"] == "hard"
    async with factory() as session:
        saved = await session.scalar(select(db.QuizSession))
        assert saved.assessment_state["quiz_questions"][0]["concept_id"] == str(primary.id)
    rejected = await client.post("/quiz/start", json=body | {"concept_id": str(unapproved.id)})
    assert rejected.status_code == 422
    async with factory() as session:
        assert len((await session.scalars(select(db.QuizSession))).all()) == 1

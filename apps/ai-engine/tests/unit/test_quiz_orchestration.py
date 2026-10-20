"""Grounded question persistence shared by REST and conversational Tutor flows."""

from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from database import models
from rag.source_bundle import MaterialScope, bundle_from_docs

pytestmark = pytest.mark.unit
pytest_plugins = (
    "tests.assessment_test",
    "tests.unit.test_chat_context",
    "tests.unit.test_guided_learning",
)


def grounded_question(evidence_id: str, *, concept_id: str = "") -> dict:
    return {
        "question_id": str(uuid.uuid4()),
        "text": "Pecahan apa yang senilai dengan satu per dua?",
        "type": "spoken",
        "options": [],
        "expected_answer": "Dua per empat.",
        "rubric": {"key_points": ["nilainya sama"]},
        "explanation": "Kalikan pembilang dan penyebut dengan bilangan yang sama.",
        "evidence_refs": [evidence_id],
        "objective": "Mengidentifikasi pecahan yang senilai.",
        "cognitive_level": "understanding",
        "concept_id": concept_id,
        "difficulty": "easy",
    }


def grounded_batch(evidence_id: str, *, concept_id: str = ""):
    from models.grounded_question import GroundedQuestion, GroundedQuestionBatch

    question = grounded_question(evidence_id, concept_id=concept_id)
    question.pop("question_id")
    return GroundedQuestionBatch(
        questions=[GroundedQuestion.model_validate(question)],
        prompt_version="grounded-question-v1",
        prompt_hash="a" * 64,
        generation_calls=1,
        verification_calls=1,
    )


def chat_source(workspace) -> dict:
    return {
        "chunk_id": "fraction-block-1",
        "evidence_id": "fraction-evidence-1",
        "text": "Pecahan senilai mempunyai nilai yang sama. Satu per dua setara dua per empat.",
        "source": "pecahan.pdf",
        "material_title": "Pecahan",
        "class_id": str(workspace.classroom.id),
        "material_id": str(workspace.material.id),
        "content_version": workspace.material.content_version,
        "mapping_version": workspace.material.mapping_version,
        "document_hash": "f" * 64,
        "block_ids": ["block-1"],
        "spans": [{"block_id": "block-1", "page": 2}],
    }


def conversational_final(state: dict, source: dict) -> dict:
    question = grounded_question(source["evidence_id"])
    return {
        **state,
        "accessible_response": "Penjelasan dari materi.",
        "intent": "tutoring",
        "next_action": "speak",
        "current_topic": "Pecahan senilai",
        "quiz_questions": [question],
        "retrieved_docs": [source],
        "quiz_prompt_version": "grounded-question-v1",
        "quiz_prompt_hash": "a" * 64,
        "quiz_generation_calls": 1,
        "quiz_verification_calls": 1,
    }


class ConversationalGraph:
    def __init__(self, source):
        self.source = source
        self.cleared = None
        self.calls = 0

    async def ainvoke(self, state, config=None):
        self.calls += 1
        return conversational_final(state, self.source)

    async def aupdate_state(self, config, update):
        self.cleared = update


async def test_factory_persists_one_canonical_session_without_calling_graph_or_model(
    assessment_http,
):
    from api.quiz_session_factory import create_quiz_session_from_questions

    _, factory, controls, graph, concept, _ = assessment_http
    student = controls["actor"]
    scope = MaterialScope(student_id=student.id, concept_id=concept.id)
    source_bundle = bundle_from_docs(
        "Pecahan senilai",
        scope,
        [
            {
                "chunk_id": "fraction-chunk",
                "evidence_id": "fraction-evidence",
                "text": "Pecahan senilai mempunyai nilai yang sama.",
            }
        ],
    )
    batch = grounded_batch("fraction-evidence", concept_id=str(concept.id))

    async with factory() as session:
        response = await create_quiz_session_from_questions(
            session,
            student,
            batch,
            scope=scope,
            source_bundle=source_bundle,
            mode="assessment",
        )
        await session.commit()

    assert response.quiz_session_id.version == 4
    assert response.policy_version == 2
    assert "expected_answer" not in response.model_dump_json()
    assert "rubric" not in response.model_dump_json()
    assert graph.calls == 0
    async with factory() as session:
        quiz = await session.get(models.QuizSession, response.quiz_session_id)
        assert quiz is not None
        assert quiz.assessment_state["quiz_prompt_version"] == "grounded-question-v1"
        assert quiz.assessment_state["quiz_questions"][0]["evidence_refs"] == ["fraction-evidence"]
        assert await session.scalar(select(func.count()).select_from(models.QuizQuestion)) == 1


async def test_factory_rejects_stale_material_before_persisting(learning_http):
    from api.quiz_session_factory import create_quiz_session_from_questions

    _, factory, controls, material, _, _ = learning_http
    student = controls["actor"]
    scope = MaterialScope(
        student_id=student.id,
        class_id=material.class_id,
        material_id=material.id,
        content_version=material.content_version,
        mapping_version=material.mapping_version,
    )
    source_bundle = bundle_from_docs(
        "Pecahan senilai",
        scope,
        [
            {
                "chunk_id": "fraction-chunk",
                "evidence_id": "fraction-evidence",
                "text": "Pecahan senilai mempunyai nilai yang sama.",
                "material_id": str(material.id),
                "content_version": material.content_version,
                "mapping_version": material.mapping_version,
                "document_hash": "f" * 64,
                "block_ids": ["block-1"],
                "spans": [{"block_id": "block-1", "page": 2}],
            }
        ],
    )
    async with factory() as session:
        row = await session.get(models.ClassMaterial, material.id)
        row.content_version += 1
        await session.commit()

    async with factory() as session:
        with pytest.raises(HTTPException) as caught:
            await create_quiz_session_from_questions(
                session,
                student,
                grounded_batch("fraction-evidence"),
                scope=scope,
                source_bundle=source_bundle,
                mode="tutor",
            )
        assert getattr(caught.value, "status_code", None) == 409
        await session.rollback()
        assert await session.scalar(select(func.count()).select_from(models.QuizSession)) == 0


async def test_http_conversational_quiz_returns_recoverable_canonical_session(scoped_chat):
    workspace = scoped_chat
    source = chat_source(workspace)
    graph = ConversationalGraph(source)
    workspace.app.state.graph = graph
    response = await workspace.client.post(
        "/chat/message",
        json={
            "text": "Jelaskan materi ini",
            "class_id": str(workspace.classroom.id),
            "material_id": str(workspace.material.id),
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    canonical_id = uuid.UUID(payload["quiz_session_id"])
    assert canonical_id.version == 4
    assert "jawaban benar" in payload["text"].lower() or "siap dijawab" in payload["text"].lower()
    assert "expected_answer" not in response.text and "rubric" not in response.text
    assert graph.cleared["quiz_questions"] == []
    async with workspace.sessions() as session:
        quiz = await session.get(models.QuizSession, canonical_id)
        assert quiz.assessment_state["learning_session_id"] == payload["session_id"]
        question_count = await session.scalar(select(func.count()).select_from(models.QuizQuestion))
        assert question_count == 1
    detail = await workspace.client.get(f"/chat/sessions/{payload['session_id']}")
    assert detail.json()["turns"][-1]["quiz_session_id"] == str(canonical_id)


async def test_websocket_conversational_quiz_uses_same_persisted_factory(scoped_chat, monkeypatch):
    from api.websockets import chat_stream

    workspace = scoped_chat
    source = chat_source(workspace)
    graph = ConversationalGraph(source)
    workspace.app.state.graph = graph
    monkeypatch.setattr(chat_stream, "async_session", workspace.isolated_session)

    async def stream(_, state, config):
        yield {
            "event": "on_chain_end",
            "name": "LangGraph",
            "data": {"output": conversational_final(state, source)},
        }

    monkeypatch.setattr(chat_stream, "run_turn", stream)
    frames = []

    class Socket:
        app = workspace.app

        async def send_json(self, frame):
            frames.append(frame)

    await chat_stream._run_one_turn(
        Socket(),
        workspace.student,
        text="Jelaskan materi ini",
        session_id=None,
        subject_id=None,
        class_id=workspace.classroom.id,
        material_id=workspace.material.id,
    )

    final = next(frame for frame in frames if frame["type"] == "final")
    canonical_id = uuid.UUID(final["quiz_session_id"])
    assert canonical_id.version == 4
    assert "expected_answer" not in str(frames) and "rubric" not in str(frames)
    assert graph.cleared["quiz_questions"] == []
    async with workspace.sessions() as session:
        quiz = await session.get(models.QuizSession, canonical_id)
        assert quiz.assessment_state["learning_session_id"] == final["session_id"]

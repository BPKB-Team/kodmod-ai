"""Offline boundaries for scoped retrieval and source disclosure."""

import json
import uuid
from types import SimpleNamespace

import pytest

from agents import problem_generator
from tools import rag_tool

pytestmark = pytest.mark.unit


async def test_lost_class_scope_never_falls_back_to_general_tutoring(monkeypatch):
    from fastapi import HTTPException

    from rag import retriever

    async def embed(texts):
        return [[0.1]]

    async def empty(*args, **kwargs):
        return []

    monkeypatch.setattr("rag.retrieval_service.embed_text", embed)
    monkeypatch.setattr("rag.retrieval_service.pgvector_store.query", empty)
    with pytest.raises(HTTPException) as unavailable:
        await retriever.retrieve(
            "Jelaskan",
            class_id=uuid.uuid4(),
            student_id=uuid.uuid4(),
            concept_id=uuid.uuid4(),
        )
    assert unavailable.value.status_code == 409


async def test_malformed_class_scope_is_denied_before_shared_retrieval(monkeypatch):
    from fastapi import HTTPException

    from rag import retriever

    async def shared(*args, **kwargs):
        return [{"text": "Shared knowledge"}]

    monkeypatch.setattr(retriever, "retrieve", shared)
    with pytest.raises(HTTPException):
        await retriever.rag_retrieval_node(
            {"user_input": "Jelaskan", "class_id": "not-a-uuid", "student_id": str(uuid.uuid4())}
        )


async def test_rag_tool_keeps_material_identity_for_source_disclosure(monkeypatch):
    from types import SimpleNamespace

    async def search(request):
        return SimpleNamespace(
            documents=[
                {
                    "id": "chunk-1",
                    "text": "Pecahan senilai",
                    "source": "buku.pdf",
                    "score": 0.9,
                    "class_id": "class-1",
                    "material_id": "material-1",
                    "material_title": "Pecahan",
                    "concept_id": "concept-1",
                    "concept_ids": ["concept-1"],
                    "block_ids": ["paragraph-7"],
                    "spans": [{"block_id": "paragraph-7", "page": 11}],
                    "content_version": 3,
                    "mapping_version": 2,
                    "document_hash": "a" * 64,
                    "approved_concept_ids": ["concept-1"],
                }
            ]
        )

    monkeypatch.setattr(rag_tool, "retrieve_sources", search)
    tool = rag_tool.RAGTool()
    docs = await tool.retrieve("Pecahan")
    assert docs[0].get("material_id") == "material-1"
    assert docs[0].get("class_id") == "class-1"
    assert docs[0].get("material_title") == "Pecahan"
    assert docs[0].get("concept_id") == "concept-1"
    assert docs[0].get("block_ids") == ["paragraph-7"]
    assert docs[0].get("spans") == [{"block_id": "paragraph-7", "page": 11}]
    assert docs[0].get("content_version") == 3
    assert docs[0].get("mapping_version") == 2
    assert docs[0].get("document_hash") == "a" * 64
    assert docs[0].get("approved_concept_ids") == ["concept-1"]


async def test_quiz_questions_use_selected_class_material_instead_of_shared_knowledge(monkeypatch):
    cid, mid, sid = (str(uuid.uuid4()) for _ in range(3))

    async def retrieve(self, query, k, filters):
        authorized = (
            filters.get("class_id") == cid
            and filters.get("material_id") == mid
            and filters.get("student_id") == sid
        )
        return [{"text": "Bahan kelas yang dipilih" if authorized else "Kurikulum umum"}]

    class ContextLLM:
        async def ainvoke(self, messages):
            grounded = "Bahan kelas yang dipilih" in messages[-1]["content"]
            return SimpleNamespace(
                content='{"questions":[{"text":"'
                + ("Latihan materi pilihan" if grounded else "Latihan umum")
                + '","expected_answer":"A","source_indices":[1]}]}'
            )

    monkeypatch.setattr(problem_generator.RAGTool, "retrieve", retrieve)
    monkeypatch.setattr(problem_generator, "get_quiz_llm", lambda: ContextLLM())
    result = await problem_generator.problem_generator_node(
        {
            "student_id": sid,
            "class_id": cid,
            "material_id": mid,
            "current_concept_id": "general",
            "quiz_n_questions": 1,
        }
    )
    assert result["quiz_questions"][0]["text"] == "Latihan materi pilihan"


@pytest.mark.parametrize("existing_concept", ["", "stale"])
@pytest.mark.parametrize("requested_topic", ["", "Pecahan senilai"])
@pytest.mark.parametrize("generated_count", [0, 1, 2])
@pytest.mark.parametrize("scope", ["class", "material", "selected_material"])
async def test_unmapped_classroom_quiz_never_attributes_an_unrelated_concept(
    monkeypatch, existing_concept, requested_topic, generated_count, scope
):
    cid, mid, sid, unrelated_concept = (str(uuid.uuid4()) for _ in range(4))
    concept_lookups = []

    async def resolve_global_concept(topic, subject_id):
        concept_lookups.append("resolve")
        return unrelated_concept

    def infer_global_concept(state):
        concept_lookups.append("infer")
        return unrelated_concept

    async def retrieve(self, query, k, filters):
        assert "concept_id" not in filters
        assert filters["student_id"] == sid
        assert filters["class_id"] == (None if scope == "material" else cid)
        assert filters["material_id"] == (None if scope == "class" else mid)
        return [
            {
                "text": "Satu per dua sama dengan dua per empat.",
                "source": "pecahan.pdf",
                "class_id": cid,
                "material_id": mid,
                "material_title": "Pecahan senilai",
                "concept_id": unrelated_concept,
                "concept_ids": [unrelated_concept],
            }
        ]

    class ContextLLM:
        async def ainvoke(self, messages):
            prompt = messages[-1]["content"]
            grounded = "<topic>Pecahan senilai</topic>" in prompt
            return SimpleNamespace(
                content=json.dumps(
                    {
                        "questions": [
                            {
                                "text": f"Latihan pecahan senilai {number}"
                                if grounded
                                else "Topik keliru",
                                "type": "spoken",
                                "expected_answer": "Dua per empat",
                                "concept_id": unrelated_concept,
                                "source_indices": [1],
                            }
                            for number in range(generated_count)
                        ]
                    }
                )
            )

    monkeypatch.setattr(problem_generator, "_resolve_concept_id", resolve_global_concept)
    monkeypatch.setattr(problem_generator, "_infer_concept", infer_global_concept)
    monkeypatch.setattr(problem_generator.RAGTool, "retrieve", retrieve)
    monkeypatch.setattr(problem_generator, "get_quiz_llm", lambda: ContextLLM())
    state = {
        "student_id": sid,
        "class_id": None if scope == "material" else cid,
        "material_id": None if scope == "class" else mid,
        "current_topic": requested_topic,
        "current_concept_id": unrelated_concept if existing_concept else "",
        "mastery_scores": {unrelated_concept: 0.1},
        "mastery_confidence": {unrelated_concept: 1.0},
        "quiz_n_questions": 2,
    }
    if generated_count != 2:
        with pytest.raises(ValueError, match="quality contract"):
            await problem_generator.problem_generator_node(state)
        assert concept_lookups == []
        return
    result = await problem_generator.problem_generator_node(state)
    questions = result["quiz_questions"]
    assert concept_lookups == []
    assert len(questions) == 2
    assert all(question["concept_id"] == "" for question in questions)
    if generated_count:
        assert questions[0]["text"] == "Latihan pecahan senilai 0"
    assert "pecahan senilai" in questions[-1]["text"].lower()
    assert unrelated_concept not in questions[-1]["text"]


async def test_standalone_subject_quiz_keeps_its_resolved_concept(monkeypatch):
    subject_id, concept_id, student_id = (str(uuid.uuid4()) for _ in range(3))

    async def resolve_concept(topic, selected_subject):
        return concept_id if topic == "Pecahan" and selected_subject == subject_id else ""

    async def retrieve(self, query, k, filters):
        scoped = filters == {"subject_id": subject_id, "concept_id": concept_id}
        return [{"text": "Pecahan dari mapel pilihan" if scoped else "Mapel keliru"}]

    class SubjectLLM:
        async def ainvoke(self, messages):
            grounded = "Pecahan dari mapel pilihan" in messages[-1]["content"]
            return SimpleNamespace(
                content=json.dumps(
                    {
                        "questions": [
                            {
                                "text": "Latihan mapel pilihan" if grounded else "Latihan keliru",
                                "type": "spoken",
                                "expected_answer": "Satu per dua",
                            }
                        ]
                    }
                )
            )

    monkeypatch.setattr(problem_generator, "_resolve_concept_id", resolve_concept)
    monkeypatch.setattr(problem_generator.RAGTool, "retrieve", retrieve)
    monkeypatch.setattr(problem_generator, "get_quiz_llm", lambda: SubjectLLM())
    result = await problem_generator.problem_generator_node(
        {
            "student_id": student_id,
            "subject_id": subject_id,
            "current_topic": "Pecahan",
            "quiz_n_questions": 1,
        }
    )
    question = result["quiz_questions"][0]
    assert question["concept_id"] == concept_id
    assert question["text"] == "Latihan mapel pilihan"


@pytest.mark.parametrize("assessment_managed", [False, True])
async def test_managed_quiz_generation_leaves_session_persistence_to_assessment(
    monkeypatch, assessment_managed
):
    stored_sessions = []

    async def store_quiz_session(session_id, payload):
        stored_sessions.append((session_id, payload))

    async def retrieve(self, query, k, filters):
        return [{"text": "Pecahan senilai"}]

    class QuizLLM:
        async def ainvoke(self, messages):
            return SimpleNamespace(
                content='{"questions":[{"text":"Jelaskan pecahan senilai","expected_answer":"A"}]}'
            )

    monkeypatch.setattr("memory.short_term.store_quiz_session", store_quiz_session)
    monkeypatch.setattr(problem_generator.RAGTool, "retrieve", retrieve)
    monkeypatch.setattr(problem_generator, "get_quiz_llm", lambda: QuizLLM())
    result = await problem_generator.problem_generator_node(
        {
            "student_id": str(uuid.uuid4()),
            "session_id": "session-1",
            "current_concept_id": str(uuid.uuid4()),
            "quiz_n_questions": 1,
            "assessment_managed": assessment_managed,
        }
    )

    if assessment_managed:
        assert stored_sessions == []
    else:
        assert len(stored_sessions) == 1
        assert stored_sessions[0][0] == "session-1"
        assert stored_sessions[0][1]["quiz_session_id"] == result["quiz_session_id"]
        assert stored_sessions[0][1]["quiz_questions"] == result["quiz_questions"]

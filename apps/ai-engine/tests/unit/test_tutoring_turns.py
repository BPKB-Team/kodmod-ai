"""Conversation regressions: ask a mini-quiz before grading an answer."""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from langgraph.checkpoint.memory import InMemorySaver

from analytics.student_model import StudentModel, update_student_model_node
from graphs.main_graph import build_kodmod_graph
from graphs.state import initial_state

pytestmark = pytest.mark.unit


@pytest.fixture
def offline_learning(monkeypatch):
    """Replace provider/storage boundaries; retain real nodes, graph and mastery math."""
    import agents.analytics_agent as analytics
    import memory.short_term as short_term
    import rag.retriever as retriever

    models: dict[str, StudentModel] = {}
    sessions: dict[str, dict] = {}

    async def load_model(student_id):
        return models.setdefault(str(student_id), StudentModel(student_id=str(student_id)))

    async def persist_model(self):
        return None

    async def fetch_quiz(session_id):
        return sessions.get(session_id)

    async def store_quiz(session_id, data):
        sessions[session_id] = data

    async def clear_quiz(session_id):
        sessions.pop(session_id, None)

    async def retrieve_result(query, **kwargs):
        from rag.retrieval_service import RetrievalResult, RetrievalTrace, scope_from_filters
        from rag.source_bundle import bundle_from_docs

        docs = [
            {
                "chunk_id": "tutor-turn-pecahan",
                "text": "Pecahan adalah bagian dari keseluruhan. Satu per dua ditambah satu per dua adalah satu.",
                "source": "pecahan.pdf",
            }
        ]
        scope = scope_from_filters(kwargs)
        return RetrievalResult(
            documents=docs,
            bundle=bundle_from_docs(query, scope, docs),
            trace=RetrievalTrace(1, 1, 1, None, "pgvector", 0),
        )

    async def summarise(self, **kwargs):
        return {"overall_mastery": 0.6, "n_sessions": 1, "weak_concepts": []}

    async def save_report(**kwargs):
        return None

    monkeypatch.setattr(StudentModel, "load", staticmethod(load_model))
    monkeypatch.setattr(StudentModel, "persist", persist_model)
    monkeypatch.setattr(short_term, "fetch_quiz_session", fetch_quiz)
    monkeypatch.setattr(short_term, "store_quiz_session", store_quiz)
    monkeypatch.setattr(short_term, "clear_quiz_session", clear_quiz)
    monkeypatch.setattr(retriever, "retrieve_result", retrieve_result)
    monkeypatch.setattr(analytics.StudentAggregator, "summarise", summarise)
    monkeypatch.setattr(analytics, "save_analytics_report", save_report)
    return models, sessions


async def test_tutor_delivers_explanation_and_question_without_grading(offline_learning):
    graph = await build_kodmod_graph(checkpointer=InMemorySaver())
    state = initial_state(str(uuid.uuid4()), str(uuid.uuid4()), "Jelaskan pecahan")
    state["current_concept_id"] = str(uuid.uuid4())

    final = await graph.ainvoke(state, {"configurable": {"thread_id": state["session_id"]}})

    assert final["quiz_attempts"] == []
    assert final["current_question_attempts"] == 0
    assert "Pecahan adalah" in final["accessible_response"]
    assert "Cek pemahaman" in final["accessible_response"]
    assert "hasil satu per dua" in final["accessible_response"]
    assert final["quiz_question"]["expected_answer"] == "A"


async def test_pending_mini_quiz_scores_the_next_turn_only(offline_learning):
    graph = await build_kodmod_graph(checkpointer=InMemorySaver())
    state = initial_state(str(uuid.uuid4()), str(uuid.uuid4()), "Jelaskan pecahan")
    state["current_concept_id"] = str(uuid.uuid4())
    config = {"configurable": {"thread_id": state["session_id"]}}
    first = await graph.ainvoke(state, config)
    assert first["quiz_attempts"] == []

    final = await graph.ainvoke({"user_input": "A", "student_answer": ""}, config)

    assert len(final["quiz_attempts"]) == 1
    assert final["quiz_attempts"][0]["student_answer"] == "A"
    assert final["quiz_attempts"][0]["score"] == 1.0
    assert final["current_question_index"] == 1
    assert final["mastery_applied_attempts"] == 1


async def test_mastery_applies_only_new_attempts_when_quiz_advances(offline_learning):
    models, _ = offline_learning
    student_id = str(uuid.uuid4())
    concept_id = str(uuid.uuid4())
    questions = [
        {"question_id": "q1", "concept_id": concept_id},
        {"question_id": "q2", "concept_id": concept_id},
    ]
    state = {
        "student_id": student_id,
        "quiz_questions": questions,
        "quiz_attempts": [{"question_id": "q1", "score": 1.0}],
        "current_question_index": 0,
    }
    state.update(await update_student_model_node(state))
    state["quiz_attempts"].append({"question_id": "q2", "score": 0.0})
    final = await update_student_model_node(state)

    assert models[student_id]._attempts[concept_id] == 2
    assert final["mastery_applied_attempts"] == 2


async def test_rest_turn_state_preserves_pending_question_and_tutor_history(offline_learning):
    from api.chat_service import build_turn_state

    graph = await build_kodmod_graph(checkpointer=InMemorySaver())
    session_id, student_id = uuid.uuid4(), uuid.uuid4()
    state = initial_state(str(session_id), str(student_id), "Jelaskan pecahan")
    state["current_concept_id"] = str(uuid.uuid4())
    config = {"configurable": {"thread_id": str(session_id)}}
    first = await graph.ainvoke(state, config)
    student = SimpleNamespace(id=student_id, preferred_language="id", accessibility_profile="blind")

    next_turn = await build_turn_state(
        student=student, session_id=session_id, text="A", subject_id=None
    )
    final = await graph.ainvoke(next_turn, config)

    assert len(final["quiz_attempts"]) == 1
    assert final["quiz_attempts"][0]["student_answer"] == "A"
    assert final["tutoring_context"] == first["tutoring_context"]
    assert final["current_concept_id"] == state["current_concept_id"]


async def test_pending_mini_quiz_resumes_from_graph_checkpoint(offline_learning):
    from api.chat_service import build_turn_state

    graph = await build_kodmod_graph(checkpointer=InMemorySaver())
    session_id, student_id = uuid.uuid4(), uuid.uuid4()
    state = initial_state(str(session_id), str(student_id), "Jelaskan pecahan")
    state["current_concept_id"] = str(uuid.uuid4())
    config = {"configurable": {"thread_id": str(session_id)}}
    await graph.ainvoke(state, config)
    student = SimpleNamespace(id=student_id, preferred_language="id", accessibility_profile="blind")
    next_turn = await build_turn_state(
        student=student, session_id=session_id, text="A", subject_id=None
    )

    final = await graph.ainvoke(next_turn, config)

    assert len(final.get("quiz_attempts", [])) == 1
    assert final["quiz_attempts"][0]["student_answer"] == "A"


async def test_completed_quiz_does_not_block_a_new_tutoring_check(offline_learning):
    from api.chat_service import build_turn_state

    graph = await build_kodmod_graph(checkpointer=InMemorySaver())
    session_id, student_id = uuid.uuid4(), uuid.uuid4()
    state = initial_state(str(session_id), str(student_id), "Jelaskan pecahan")
    state["current_concept_id"] = str(uuid.uuid4())
    config = {"configurable": {"thread_id": str(session_id)}}
    first = await graph.ainvoke(state, config)
    await graph.ainvoke({"user_input": "A", "student_answer": ""}, config)
    student = SimpleNamespace(id=student_id, preferred_language="id", accessibility_profile="blind")
    next_turn = await build_turn_state(
        student=student, session_id=session_id, text="Jelaskan pecahan sekali lagi", subject_id=None
    )

    final = await graph.ainvoke(next_turn, config)

    assert final["quiz_attempts"] == []
    assert final["quiz_session_id"] != first["quiz_session_id"]
    assert final["current_question_index"] == 0


async def test_omitted_subject_does_not_unfilter_a_resumed_conversation(offline_learning):
    from api.chat_service import build_turn_state

    graph = await build_kodmod_graph(checkpointer=InMemorySaver())
    session_id, student_id, subject_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    state = initial_state(str(session_id), str(student_id), "Jelaskan pecahan", str(subject_id))
    config = {"configurable": {"thread_id": str(session_id)}}
    await graph.ainvoke(state, config)
    student = SimpleNamespace(id=student_id, preferred_language="id", accessibility_profile="blind")
    next_turn = await build_turn_state(
        student=student, session_id=session_id, text="Contohnya bagaimana?", subject_id=None
    )

    final = await graph.ainvoke(next_turn, config)

    assert final["subject_id"] == str(subject_id)


async def test_selected_material_can_ask_a_mini_quiz_without_inventing_a_concept(offline_learning):
    graph = await build_kodmod_graph(checkpointer=InMemorySaver())
    state = initial_state(str(uuid.uuid4()), str(uuid.uuid4()), "Jelaskan materi ini")
    state["material_id"] = str(uuid.uuid4())
    state["class_id"] = str(uuid.uuid4())
    config = {"configurable": {"thread_id": state["session_id"]}}

    first = await graph.ainvoke(state, config)

    assert first.get("quiz_session_id", "").startswith("mini-")
    assert not first["quiz_question"].get("concept_id")
    final = await graph.ainvoke({"user_input": "A", "student_answer": ""}, config)
    assert final["quiz_attempts"][0]["score"] == 1.0
    assert final["mastery_scores"] == {}


async def test_unmapped_concept_never_becomes_a_persistent_mastery_key(offline_learning):
    models, _ = offline_learning
    student_id = str(uuid.uuid4())
    state = {
        "student_id": student_id,
        "quiz_questions": [{"question_id": "q1", "concept_id": "general"}],
        "quiz_attempts": [{"question_id": "q1", "score": 1.0}],
        "current_question_index": 0,
    }

    final = await update_student_model_node(state)

    assert models[student_id]._scores == {}
    assert final["mastery_applied_attempts"] == 1

"""Mode policies protect progression and prevent answer leakage during help."""

from types import SimpleNamespace

import pytest

from graphs.main_graph import route_after_scoring


def test_assessment_wrong_enters_review():
    from api.quiz_policy import QuizPolicy, decide_transition

    decision = decide_transition(
        QuizPolicy(version=2, mode="assessment"),
        correct=False,
        action="answer",
        question_closed=False,
    )
    assert decision.close_question
    assert decision.question_state == "review"
    assert decision.available_actions == ["advance"]
    assert (
        route_after_scoring(
            {
                "quiz_policy_version": 2,
                "assessment_kind": "assessment",
                "quiz_score": 0,
                "current_question_attempts": 1,
            }
        )
        == "update_student_model"
    )


def test_tutor_wrong_keeps_advance_available():
    from api.quiz_policy import QuizPolicy, decide_transition

    decision = decide_transition(
        QuizPolicy(version=2, mode="tutor"), correct=False, action="answer", question_closed=False
    )
    assert not decision.close_question
    assert decision.question_state == "answering"
    assert decision.available_actions == ["answer", "hint", "advance"]


def test_tutor_can_advance_without_answer_and_never_hits_forced_retry_limit():
    from api.quiz_policy import QuizPolicy, decide_transition

    decision = decide_transition(
        QuizPolicy(version=2, mode="tutor"), correct=False, action="advance", question_closed=False
    )
    assert decision.close_question
    assert (
        route_after_scoring(
            {
                "quiz_policy_version": 2,
                "assessment_kind": "tutor",
                "quiz_score": 0,
                "current_question_attempts": 20,
            }
        )
        == "tutoring"
    )


def test_v1_session_keeps_legacy_policy():
    assert (
        route_after_scoring(
            {"assessment_kind": "assessment", "quiz_score": 0, "current_question_attempts": 1}
        )
        == "tutoring"
    )


@pytest.mark.parametrize(
    ("answer", "leaking"),
    [
        ("Ceres", "Jawabannya adalah Ceres."),
        ("42", "Hitunglah hasil akhirnya, yaitu 42."),
        ("B", "Pilih opsi B."),
    ],
)
async def test_tutor_hint_omits_canonical_answer(monkeypatch, answer, leaking):
    from agents import tutoring_agent

    class HintModel:
        async def ainvoke(self, messages):
            return SimpleNamespace(content=leaking)

    monkeypatch.setattr(tutoring_agent, "get_tutor_llm", lambda: HintModel())
    result = await tutoring_agent.generate_quiz_hint(
        {
            "text": "Selesaikan pertanyaan ini",
            "expected_answer": answer,
            "type": "mcq" if answer == "B" else "spoken",
            "options": ["A. satu", "B. dua", "C. tiga", "D. empat"],
        },
        student_answer="Belum tahu",
        language="id",
        source_docs=[],
    )
    assert result != leaking
    assert answer.casefold() not in result.casefold().split()
    assert result.strip()


async def test_tutor_wrong_feedback_never_returns_grader_answer():
    from agents.scoring_agent import _emit

    result = await _emit(
        {
            "assessment_managed": True,
            "quiz_policy_version": 2,
            "assessment_kind": "tutor",
            "quiz_attempts": [],
            "learning_profile": {"language": "id"},
        },
        {
            "question_id": "q",
            "student_answer": "Belum tahu",
            "score": 0,
            "is_correct": False,
            "confidence": 1,
            "feedback": "Jawabannya Ceres.",
        },
    )
    assert "Ceres" not in result["generated_response"]
    assert "Ceres" not in result["quiz_attempts"][0]["feedback"]

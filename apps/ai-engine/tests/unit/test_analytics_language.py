"""Localized deterministic analytics must work without an LLM call."""

import pytest

from analytics.insights import (
    generate_cohort_alerts,
    generate_insights,
    generate_student_spoken_summary,
    generate_teacher_summary,
)

pytestmark = pytest.mark.unit


@pytest.mark.parametrize(
    "window,phrase",
    [("today", "today"), ("week", "past 7 days"), ("month", "past 30 days"), ("all", "so far")],
)
def test_student_spoken_summary_uses_selected_language_and_window(window, phrase):
    result = generate_student_spoken_summary(
        {"student_name": "Budi", "n_sessions": 2, "window": window, "quiz_accuracy": 0.8},
        language="en",
    )
    assert "Hello Budi" in result
    assert "80 percent" in result
    assert phrase in result.lower()
    assert "persen" not in result


def test_formal_answers_are_described_even_without_a_tutor_session():
    result = generate_student_spoken_summary(
        {"student_name": "Budi", "n_sessions": 0, "n_quiz_attempts": 1, "quiz_accuracy": 1},
        language="id",
    )
    assert "100 persen" in result
    assert "belum belajar sama sekali" not in result


def test_spoken_summary_does_not_call_unmapped_concepts_zero_mastery():
    result = generate_student_spoken_summary(
        {
            "student_name": "Budi",
            "n_sessions": 1,
            "n_quiz_attempts": 2,
            "quiz_accuracy": 0.5,
            "overall_mastery": 0.0,
            "weak_concepts": [],
            "strong_concepts": [],
        },
        language="id",
    )

    assert "penguasaan rata-rata 0 persen" not in result
    assert "dikaitkan dengan konsep" in result


def test_zero_grade_is_spoken_as_a_result_and_not_an_empty_history():
    result = generate_student_spoken_summary(
        {"n_sessions": 0, "n_quiz_attempts": 2, "quiz_accuracy": 0}, language="en"
    )
    assert "accuracy is 0 percent" in result
    assert "no learning activity" not in result


async def test_agent_managed_assessment_notice_uses_english():
    from agents.analytics_agent import analytics_node

    result = await analytics_node(
        {"assessment_managed": True, "language": "en", "cumulative_quiz_score": 1}
    )
    assert result["generated_response"] == "Practice complete. Your score is 100 percent."


def test_english_teacher_insights_and_cohort_alerts():
    result = generate_teacher_summary(
        {"student_name": "Budi", "n_quiz_attempts": 3, "quiz_accuracy": 0.3, "window": "all"},
        language="en",
    )
    assert "quiz accuracy 30%" in result["headline"]
    assert result["alerts"][0]["title"] == "Budi: low accuracy"
    alerts = generate_cohort_alerts(
        {
            "cohort_weak_concepts": [
                {"concept_name": "Fractions", "avg_mastery": 0.4, "n_students": 2}
            ]
        },
        language="en",
    )
    assert alerts[0]["title"] == "Needs practice: Fractions"


@pytest.mark.parametrize("audience", ["student", "teacher"])
async def test_no_llm_and_failed_polish_keep_the_selected_language(monkeypatch, audience):
    def unavailable():
        raise RuntimeError("offline")

    monkeypatch.setattr("analytics.insights.get_recommendation_llm", unavailable)
    data = {"student_name": "Budi", "n_sessions": 2, "quiz_accuracy": 0.8, "window": "month"}
    deterministic = await generate_insights(data, audience=audience, language="en")
    fallback = await generate_insights(data, audience=audience, language="en", use_llm=True)
    assert fallback == deterministic
    assert "past 30 days" in fallback["spoken"]

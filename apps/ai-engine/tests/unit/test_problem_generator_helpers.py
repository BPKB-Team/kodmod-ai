"""KM-UNIT-050..055 — pure problem-generator heuristics (agents/problem_generator.py).

Oracle: the functions + the QuizQuestion TypedDict in graphs/state.py.
Spec: docs/testplan/01-unit.md §4.
"""

from __future__ import annotations

import pytest

from agents.problem_generator import (
    _adjust_difficulty,
    _decide_n_questions,
    _fallback_question,
    _infer_concept,
)

pytestmark = pytest.mark.unit


@pytest.mark.parametrize("emotion", ["fatigued", "frustrated"])
def test_decide_n_questions_short_when_low_energy(emotion: str) -> None:  # KM-UNIT-050
    assert _decide_n_questions({"emotional_state": emotion}) == 3


def test_decide_n_questions_long_when_motivated() -> None:  # KM-UNIT-051
    assert _decide_n_questions({"emotional_state": "motivated"}) == 7


@pytest.mark.parametrize("state", [{"emotional_state": "neutral"}, {}])
def test_decide_n_questions_default(state: dict) -> None:  # KM-UNIT-052
    assert _decide_n_questions(state) == 5


def test_infer_concept_picks_weakest() -> None:  # KM-UNIT-053
    assert _infer_concept({"mastery_scores": {"a": 0.9, "b": 0.2}}) == "b"


def test_infer_concept_empty_falls_back_to_general() -> None:  # KM-UNIT-054
    assert _infer_concept({"mastery_scores": {}}) == "general"
    assert _infer_concept({}) == "general"


def test_fallback_question_is_valid_quiz_question() -> None:  # KM-UNIT-055
    q = _fallback_question("pecahan", "easy")
    for key in ("question_id", "text", "type", "concept_id", "difficulty"):
        assert key in q
    assert q["concept_id"] == "pecahan"
    assert q["difficulty"] == "easy"
    assert q["type"] == "explain"
    assert q["question_id"]


# --------------------------------------------------------------------------- #
# _adjust_difficulty() — steps difficulty from predicted success probability
# (StudentModel.predict_correct_probability). Spec: docs/testplan/01-unit.md §4.
# --------------------------------------------------------------------------- #


def test_adjust_difficulty_steps_up_when_predicted_easy() -> None:  # KM-UNIT-056
    assert _adjust_difficulty("medium", 0.9) == "hard"


def test_adjust_difficulty_steps_down_when_predicted_hard() -> None:  # KM-UNIT-057
    assert _adjust_difficulty("medium", 0.1) == "easy"


def test_adjust_difficulty_unchanged_in_productive_zone() -> None:  # KM-UNIT-058
    assert _adjust_difficulty("medium", 0.6) == "medium"


def test_adjust_difficulty_never_exceeds_expert() -> None:  # KM-UNIT-059
    assert _adjust_difficulty("expert", 0.99) == "expert"


def test_adjust_difficulty_never_drops_below_beginner() -> None:  # KM-UNIT-060
    assert _adjust_difficulty("beginner", 0.01) == "beginner"


def test_adjust_difficulty_moves_one_rung_at_a_time() -> None:  # KM-UNIT-061
    # A single strong signal shouldn't jump beginner straight to expert.
    assert _adjust_difficulty("beginner", 0.99) == "easy"

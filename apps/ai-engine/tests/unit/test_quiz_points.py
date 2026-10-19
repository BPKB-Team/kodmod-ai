from types import SimpleNamespace as Outcome

import pytest


def test_points_round_each_question_half_up_before_summing():
    from api.quiz_points import build_score_summary, points_for_score

    assert points_for_score(0.145) == 15
    summary = build_score_summary(
        [Outcome(first_score=x, status="answered", assisted=False) for x in [1, 1, 0]],
        total_questions=3,
    )
    assert (summary.points_earned, summary.points_possible) == (200, 300)
    assert (
        build_score_summary(
            [Outcome(first_score=0.145, status="answered", assisted=False)] * 2, total_questions=2
        ).points_earned
        == 30
    )


@pytest.mark.parametrize("invalid", [float("nan"), float("inf"), -0.1, 1.01])
def test_invalid_scores_are_not_points(invalid):
    from api.quiz_points import points_for_score

    with pytest.raises(ValueError):
        points_for_score(invalid)


def test_skips_assisted_and_session_narration():
    from api.quiz_points import build_score_summary, session_result_text

    summary = build_score_summary(
        [
            Outcome(first_score=0, status="skipped", assisted=False),
            Outcome(first_score=1, status="answered", assisted=True),
        ],
        total_questions=3,
    )
    assert summary.skipped_questions == 1 and summary.assisted_questions == 1
    assert summary.answered_questions == 1
    assert summary.points_earned == 100 and summary.points_possible == 300
    assert "100" in session_result_text(summary, language="id")
    assert "%" not in session_result_text(summary, language="id")
    assert "percent" not in session_result_text(summary, language="en")


async def test_formal_points_preserve_teacher_item_release():
    import uuid
    from datetime import UTC, datetime, timedelta
    from unittest.mock import AsyncMock

    from api.editorial_quiz_service import result_out

    assignment = Outcome(
        id=uuid.uuid4(), version_id=uuid.uuid4(), due_at=datetime.now(UTC) + timedelta(days=1)
    )
    attempt = Outcome(
        id=uuid.uuid4(),
        state="submitted",
        score=50,
        correct_count=1,
        total_questions=2,
        submitted_at=datetime.now(UTC),
    )
    db = Outcome(get=AsyncMock(return_value=Outcome(release_policy="after_due")))
    result = await result_out(db, assignment, attempt)
    assert result.score_summary.points_earned == 100
    assert result.score_summary.points_possible == 200
    assert not result.feedback_released and result.review == []

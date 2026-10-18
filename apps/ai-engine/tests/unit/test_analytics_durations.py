"""Unit coverage for the activity windows used in student study-time totals."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from analytics.aggregator import (
    _activity_total_minutes,
    _duration_minutes,
    _is_independent_assessment,
)

pytestmark = pytest.mark.unit


def test_open_learning_session_uses_its_last_interaction():
    start = datetime(2026, 10, 17, 8, tzinfo=UTC)
    last_interaction = start + timedelta(minutes=12, seconds=30)

    assert _duration_minutes(start, None, last_activity_at=last_interaction) == pytest.approx(12.5)


def test_session_without_a_recorded_end_or_activity_does_not_invent_time():
    start = datetime(2026, 10, 17, 8, tzinfo=UTC)

    assert _duration_minutes(start, None) == 0
    assert _duration_minutes(start, start - timedelta(minutes=1)) == 0


def test_total_includes_standalone_assessment_but_avoids_double_counting_tutor_quiz():
    start = datetime(2026, 10, 17, 8, tzinfo=UTC)
    learning = SimpleNamespace(id="lesson", started_at=start, ended_at=None)
    assessment = SimpleNamespace(
        id="assessment",
        started_at=start,
        ended_at=None,
        assessment_state={"assessment_kind": "assessment"},
    )
    tutor_quiz = SimpleNamespace(
        id="tutor-quiz",
        started_at=start,
        ended_at=start + timedelta(minutes=5),
        assessment_state={"assessment_kind": "tutor"},
    )

    total = _activity_total_minutes(
        learning_sessions=[learning],
        learning_activity={"lesson": start + timedelta(minutes=10)},
        quiz_sessions=[assessment, tutor_quiz],
        quiz_activity={"assessment": start + timedelta(minutes=8)},
    )

    assert total == pytest.approx(18)
    assert _is_independent_assessment(assessment)
    assert not _is_independent_assessment(tutor_quiz)

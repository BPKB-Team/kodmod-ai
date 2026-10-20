"""Learning traces are bounded metadata and cannot block the learner flow."""

import uuid
from contextlib import asynccontextmanager

import pytest
from pydantic import ValidationError

from tools import learning_trace


class Session:
    def __init__(self):
        self.events = []

    def add(self, event):
        self.events.append(event)


@pytest.fixture
def trace_session(monkeypatch):
    session = Session()

    @asynccontextmanager
    async def open_session():
        yield session

    monkeypatch.setattr(learning_trace, "async_session", open_session)
    return session


async def test_trace_records_only_allowlisted_metadata_under_current_request(
    trace_session, monkeypatch
):
    request_id = uuid.uuid4()
    from tools import provider_usage

    with provider_usage.usage_context(request_id=request_id, actor_id=uuid.uuid4()):
        recorded = await learning_trace.record_learning_trace(
            learning_trace.LearningTraceEvent(
                stage="verification",
                node="problem_generator",
                student_id=uuid.uuid4(),
                quiz_session_id=uuid.uuid4(),
                policy_version=2,
                prompt_version="grounded-question-v1",
                source_ids=["chunk-a", "chunk-b"],
                quality_reasons=["semantic_reject"],
                model_call_count=1,
                latency_ms=120,
            )
        )

    assert recorded is True
    event = trace_session.events[0]
    assert event.category == "learning"
    assert event.action == "learning.verification"
    assert event.details["request_id"] == str(request_id)
    assert event.details["source_ids"] == ["chunk-a", "chunk-b"]
    assert "student_id" not in event.details
    assert "quiz_session_id" not in event.details
    assert not any(key in event.details for key in ("prompt", "answer", "answer_key", "text"))


async def test_trace_caps_events_per_request(trace_session, monkeypatch):
    request_id = uuid.uuid4()
    from tools import provider_usage

    with provider_usage.usage_context(request_id=request_id):
        results = [
            await learning_trace.record_learning_trace(
                learning_trace.LearningTraceEvent(stage="session", node="quiz")
            )
            for _ in range(learning_trace.MAX_EVENTS_PER_REQUEST + 1)
        ]

    assert results == [True] * learning_trace.MAX_EVENTS_PER_REQUEST + [False]
    assert len(trace_session.events) == learning_trace.MAX_EVENTS_PER_REQUEST


async def test_trace_counter_discards_previous_request_state(trace_session):
    from tools import provider_usage

    first_request = uuid.uuid4()
    second_request = uuid.uuid4()
    with provider_usage.usage_context(request_id=first_request):
        for _ in range(learning_trace.MAX_EVENTS_PER_REQUEST):
            assert await learning_trace.record_learning_trace(
                learning_trace.LearningTraceEvent(stage="session", node="quiz")
            )
    with provider_usage.usage_context(request_id=second_request):
        assert await learning_trace.record_learning_trace(
            learning_trace.LearningTraceEvent(stage="session", node="quiz")
        )

    assert len(trace_session.events) == learning_trace.MAX_EVENTS_PER_REQUEST + 1


def test_trace_schema_rejects_raw_prompt_or_answer_fields():
    with pytest.raises(ValidationError):
        learning_trace.LearningTraceEvent(
            stage="generation", node="problem_generator", prompt="private prompt"
        )


async def test_trace_storage_failure_is_best_effort(monkeypatch):
    @asynccontextmanager
    async def unavailable():
        raise RuntimeError("database offline")
        yield

    monkeypatch.setattr(learning_trace, "async_session", unavailable)
    recorded = await learning_trace.record_learning_trace(
        learning_trace.LearningTraceEvent(stage="advance", node="quiz_action")
    )
    assert recorded is False

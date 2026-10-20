"""Best-effort, metadata-only diagnostics for learning and assessment flows."""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from contextvars import ContextVar
from decimal import Decimal
from typing import Literal

from prometheus_client import Counter
from pydantic import BaseModel, ConfigDict, Field

from api.audit_service import record_audit
from database.session import async_session
from tools.provider_usage import current_usage_context

log = logging.getLogger(__name__)
MAX_TRACE_BYTES = 16 * 1024
MAX_EVENTS_PER_REQUEST = 12
_event_count: ContextVar[tuple[str, int] | None] = ContextVar(
    "learning_trace_event_counts", default=None
)
learning_trace_dropped = Counter(
    "kodmod_learning_trace_dropped_total", "Learning diagnostic events dropped"
)


class LearningTraceEvent(BaseModel):
    """Allowlisted trace facts. Extra fields such as prompts and answers are rejected."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    request_id: uuid.UUID | None = None
    correlation_id: uuid.UUID | None = None
    actor_id: uuid.UUID | None = None
    actor_role: Literal["student", "teacher", "admin", "system"] | None = None
    student_id: uuid.UUID | None = None
    quiz_session_id: uuid.UUID | None = None
    stage: Literal[
        "import",
        "unit",
        "retrieval",
        "generation",
        "verification",
        "scoring",
        "hint",
        "advance",
        "session",
    ]
    node: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_.:-]+$")
    policy_version: int | None = Field(default=None, ge=1, le=20)
    prompt_version: str | None = Field(default=None, max_length=80)
    extractor_version: str | None = Field(default=None, max_length=80)
    source_ids: list[str] = Field(default_factory=list, max_length=32)
    candidate_count: int | None = Field(default=None, ge=0, le=100_000)
    accepted_count: int | None = Field(default=None, ge=0, le=100_000)
    returned_count: int | None = Field(default=None, ge=0, le=100_000)
    quality_reasons: list[str] = Field(default_factory=list, max_length=12)
    fallback_reason: str | None = Field(default=None, max_length=80)
    model_call_count: int | None = Field(default=None, ge=0, le=20)
    latency_ms: int | None = Field(default=None, ge=0, le=180_000)
    estimated_cost_usd: Decimal | None = Field(default=None, ge=0)


async def record_learning_trace(event: LearningTraceEvent) -> bool:
    """Persist one bounded event independently of the caller's learning transaction."""
    context = current_usage_context()
    request_id = event.request_id or (context.request_id if context else uuid.uuid4())
    key = str(request_id)
    previous = _event_count.get()
    count = previous[1] if previous and previous[0] == key else 0
    if count >= MAX_EVENTS_PER_REQUEST:
        learning_trace_dropped.inc()
        return False

    details = event.model_dump(
        mode="json", exclude={"actor_id", "actor_role", "student_id", "quiz_session_id"}
    )
    details["request_id"] = str(request_id)
    if event.correlation_id is None:
        details["correlation_id"] = str(request_id)
    if event.estimated_cost_usd is not None:
        details["estimated_cost_usd"] = float(event.estimated_cost_usd)
    encoded = json.dumps(details, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) > MAX_TRACE_BYTES:
        learning_trace_dropped.inc()
        return False

    _event_count.set((key, count + 1))
    try:
        async with asyncio.timeout(2):
            async with async_session() as session:
                record_audit(
                    session,
                    action=f"learning.{event.stage}",
                    category="learning",
                    actor_id=event.actor_id
                    or event.student_id
                    or (context.actor_id if context else None),
                    actor_role=event.actor_role
                    or (
                        "student"
                        if event.student_id or (context and context.actor_id)
                        else "system"
                    ),
                    target_type="quiz_session" if event.quiz_session_id else "learning_request",
                    target_id=event.quiz_session_id,
                    details=details,
                )
        return True
    except Exception as error:  # telemetry cannot fail the learning request
        learning_trace_dropped.inc()
        log.warning("Could not persist learning trace (%s)", type(error).__name__)
        return False


async def record_grounded_batch(
    *,
    node: str,
    student_id: uuid.UUID | None,
    source_ids: list[str],
    prompt_version: str,
    generation_calls: int,
    verification_calls: int,
    latency_ms: int,
) -> None:
    """Record bounded generator and verifier metadata without question content."""
    await record_learning_trace(
        LearningTraceEvent(
            stage="generation",
            node=node,
            model_call_count=generation_calls,
            student_id=student_id,
            source_ids=source_ids[:32],
            prompt_version=prompt_version,
            latency_ms=min(180_000, max(0, latency_ms)),
        )
    )
    await record_learning_trace(
        LearningTraceEvent(
            stage="verification",
            node=node,
            model_call_count=verification_calls,
            student_id=student_id,
            source_ids=source_ids[:32],
            prompt_version=prompt_version,
            latency_ms=min(180_000, max(0, latency_ms)),
        )
    )

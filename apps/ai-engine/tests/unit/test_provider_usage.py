"""Provider responses are measured without retaining prompts, audio or secrets."""

import json
import uuid
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, LLMResult
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from database.models import ProviderUsage, User
from tools import provider_usage as usage

pytestmark = pytest.mark.unit


@pytest.fixture
async def usage_db(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(lambda c: User.__table__.create(c))
        await connection.run_sync(lambda c: ProviderUsage.__table__.create(c))

    @asynccontextmanager
    async def session_scope():
        async with factory() as session:
            yield session
            await session.commit()

    monkeypatch.setattr(usage, "async_session", session_scope)
    monkeypatch.setattr(usage.settings, "PROVIDER_PRICES_JSON", "{}")
    yield factory
    await engine.dispose()


async def test_llm_metadata_and_context_are_isolated_and_duplicate_end_is_once(usage_db):
    actor = User(
        id=uuid.uuid4(),
        username="usage_test",
        full_name="Test",
        role="student",
        password_hash="test",
    )
    async with usage_db() as session:
        session.add(actor)
        await session.commit()
    handler = usage.ProviderUsageHandler("tutor", "model-test")
    run, request = uuid.uuid4(), uuid.uuid4()
    with usage.usage_context(actor_id=actor.id, request_id=request, language="en"):
        await handler.on_chat_model_start({}, [["PRIVATE PROMPT"]], run_id=run)
    response = LLMResult(
        generations=[
            [
                ChatGeneration(
                    message=AIMessage(
                        content="PRIVATE ANSWER",
                        usage_metadata={"input_tokens": 23, "output_tokens": 7, "total_tokens": 30},
                    )
                )
            ]
        ]
    )
    await handler.on_llm_end(response, run_id=run)
    await handler.on_llm_end(response, run_id=run)
    async with usage_db() as session:
        rows = (await session.scalars(select(ProviderUsage))).all()
    assert len(rows) == 1
    row = rows[0]
    assert (row.actor_id, row.request_id, row.language) == (actor.id, request, "en")
    assert (row.input_tokens, row.output_tokens, row.total_tokens) == (23, 7, 30)
    assert row.latency_ms >= 0 and row.status == "success"
    assert row.estimated_cost_usd is None
    assert "PRIVATE" not in repr(row.__dict__)
    assert usage.current_usage_context() is None


async def test_error_code_is_static_and_does_not_store_provider_exception(usage_db):
    handler = usage.ProviderUsageHandler("quiz", "model-test")
    run = uuid.uuid4()
    await handler.on_chat_model_start({}, [], run_id=run)
    error = RuntimeError("api-key-secret student question secret")
    error.status_code = 429
    await handler.on_llm_error(error, run_id=run)
    async with usage_db() as session:
        row = await session.scalar(select(ProviderUsage))
    assert row.status == "error" and row.error_code == "http_429"
    assert row.total_tokens is None and row.estimated_cost_usd is None
    assert "secret" not in repr(row.__dict__)


async def test_constraint_failure_is_counted_without_exposing_database_error(usage_db, monkeypatch):
    dropped = []
    monkeypatch.setattr(usage, "dropped_usage", SimpleNamespace(inc=lambda: dropped.append(True)))
    await usage.record_usage(
        provider=None, service="tutor", model="model-test", status="success", latency_ms=1
    )
    assert dropped == [True]
    async with usage_db() as session:
        assert await session.scalar(select(ProviderUsage)) is None


async def test_embedding_transport_reads_reported_usage_and_preserves_vectors(usage_db):
    response = {
        "data": [{"embedding": [0.1, 0.2]}],
        "usage": {"prompt_tokens": 9, "total_tokens": 9},
    }

    class Client:
        async def create(self, **kwargs):
            assert kwargs["input"] == ["PRIVATE SOURCE"]
            return response

    transport = usage.MeasuredEmbeddingClient(Client(), "embedding-test")
    assert await transport.create(input=["PRIVATE SOURCE"]) is response
    async with usage_db() as session:
        row = await session.scalar(select(ProviderUsage))
    assert row.service == "embedding" and row.input_tokens == 9
    assert row.output_tokens == 0 and row.total_tokens == 9
    assert "PRIVATE SOURCE" not in repr(row.__dict__)


async def test_factory_callback_measures_an_actual_langchain_sdk_response(usage_db, monkeypatch):
    import httpx
    import langchain_openai

    from tools import llm_client

    async def transport(request):
        assert "PRIVATE REQUEST" in request.content.decode()
        return httpx.Response(
            200,
            json={
                "id": "chatcmpl-test",
                "object": "chat.completion",
                "created": 1,
                "model": "model-test",
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": "PRIVATE RESPONSE"},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {"prompt_tokens": 18, "completion_tokens": 4, "total_tokens": 22},
            },
        )

    original = langchain_openai.ChatOpenAI
    monkeypatch.setattr(usage.settings, "OPENAI_API_KEY", "fixture-secret")
    monkeypatch.setattr(usage.settings, "OPENAI_BASE_URL", "http://provider.test/v1")
    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
        monkeypatch.setattr(
            langchain_openai,
            "ChatOpenAI",
            lambda **opts: original(**opts, http_async_client=client),
        )
        model = llm_client._chat("model-test", streaming=False)
        result = await model.ainvoke("PRIVATE REQUEST")
    assert result.content == "PRIVATE RESPONSE"
    async with usage_db() as session:
        row = await session.scalar(select(ProviderUsage))
    assert row.total_tokens == 22 and row.service == "tutor"
    assert "PRIVATE" not in repr(row.__dict__)


def test_price_estimates_require_explicit_valid_units_and_known_usage(monkeypatch):
    monkeypatch.setattr(
        usage.settings,
        "PROVIDER_PRICES_JSON",
        json.dumps({"openai:model-test": {"input_per_million": "2", "output_per_million": "8"}}),
    )
    cost, snapshot = usage.estimate_cost(
        "openai", "model-test", "success", input_tokens=1000000, output_tokens=500000
    )
    assert float(cost) == 6 and snapshot["currency"] == "USD"
    assert (
        usage.estimate_cost("openai", "model-test", "success", input_tokens=None, output_tokens=0)[
            0
        ]
        is None
    )
    assert usage.estimate_cost("openai", "not-priced", "success", input_tokens=100)[0] is None
    for invalid in [
        "not-json",
        '{"openai:model-test":{"input_per_million":-1}}',
        '{"openai:model-test":{"input_per_million":"NaN"}}',
    ]:
        monkeypatch.setattr(usage.settings, "PROVIDER_PRICES_JSON", invalid)
        assert (
            usage.estimate_cost(
                "openai", "model-test", "success", input_tokens=100, output_tokens=100
            )[0]
            is None
        )


async def test_telemetry_storage_failure_never_breaks_learning(monkeypatch, caplog):
    @asynccontextmanager
    async def unavailable():
        raise RuntimeError("secret connection details")
        yield

    monkeypatch.setattr(usage, "async_session", unavailable)
    monkeypatch.setattr(usage.log, "disabled", False)
    monkeypatch.setattr(usage.log, "level", 30)
    # App logging configuration is also exercised in this suite and replaces
    # root handlers. Attach this capture directly to the logger under test.
    usage.log.addHandler(caplog.handler)
    try:
        await usage.record_usage(
            provider="openai", service="tutor", model="model-test", status="success", latency_ms=1
        )
    finally:
        usage.log.removeHandler(caplog.handler)
    assert "secret connection details" not in caplog.text
    assert "Provider usage could not be saved" in caplog.text


async def test_concurrent_callback_runs_keep_their_own_actor_context(usage_db):
    import asyncio

    handler = usage.ProviderUsageHandler("tutor", "model-test")
    requests = [uuid.uuid4(), uuid.uuid4()]

    async def call(request):
        run = uuid.uuid4()
        with usage.usage_context(request_id=request):
            await handler.on_chat_model_start({}, [], run_id=run)
        await asyncio.sleep(0)
        await handler.on_llm_end(
            LLMResult(
                generations=[],
                llm_output={
                    "token_usage": {"prompt_tokens": 5, "completion_tokens": 2, "total_tokens": 7}
                },
            ),
            run_id=run,
        )

    await asyncio.gather(*(call(request) for request in requests))
    async with usage_db() as session:
        rows = (await session.scalars(select(ProviderUsage))).all()
    assert {row.request_id for row in rows} == set(requests)
    assert all(row.total_tokens == 7 for row in rows)


async def test_speech_transport_and_cache_are_separate_measured_events(
    usage_db, tmp_path, monkeypatch
):
    import httpx

    from voice import elevenlabs, tts

    calls = []

    async def transport(request):
        calls.append(request.url.path)
        if "speech-to-text" in request.url.path:
            return httpx.Response(200, json={"text": "PRIVATE TRANSCRIPT", "audio_duration": 2.5})
        return httpx.Response(200, content=b"ID3-audio")

    client_type = httpx.AsyncClient
    monkeypatch.setattr(
        elevenlabs.httpx,
        "AsyncClient",
        lambda **kwargs: client_type(transport=httpx.MockTransport(transport), **kwargs),
    )
    monkeypatch.setattr(usage.settings, "ELEVENLABS_API_KEY", "fixture-secret")
    monkeypatch.setattr(usage.settings, "TTS_BACKEND", "elevenlabs")
    monkeypatch.setattr(tts, "OUTPUT_DIR", tmp_path)
    await tts.synthesise_bytes("PRIVATE SENTENCE")
    await tts.synthesise_bytes("PRIVATE SENTENCE")
    result = await elevenlabs.transcribe(b"private-audio")
    assert result["text"] == "PRIVATE TRANSCRIPT" and len(calls) == 2
    async with usage_db() as session:
        rows = (
            await session.scalars(select(ProviderUsage).order_by(ProviderUsage.created_at))
        ).all()
    assert [row.status for row in rows] == ["success", "cache_hit", "success"]
    assert rows[1].estimated_cost_usd == 0 and rows[2].audio_seconds == 2.5
    assert "PRIVATE" not in repr([row.__dict__ for row in rows])


async def test_admin_usage_is_real_bounded_filtered_and_role_protected(usage_db, monkeypatch):
    import httpx
    from fastapi import FastAPI

    from api.dependencies import current_user, db_session
    from api.routes import admin_insights
    from database.models import LearningSession, QuizSession

    async with usage_db() as session:
        connection = await session.connection()
        await connection.run_sync(lambda c: LearningSession.__table__.create(c))
        await connection.run_sync(lambda c: QuizSession.__table__.create(c))

    async def quota():
        return {"available": False}

    monkeypatch.setattr(admin_insights, "get_subscription_info", quota)
    actual_costs = {
        "configured": True,
        "available": True,
        "period_days": 30,
        "currency": "USD",
        "total_usd": 0.5,
        "total_idr": 8250,
        "exchange_rate": 16500.0,
        "exchange_rate_date": "2026-10-19",
        "fetched_at": "2026-10-20T12:00:00+00:00",
        "error_code": None,
    }

    async def costs():
        return actual_costs

    monkeypatch.setattr(admin_insights, "get_openai_costs", costs, raising=False)
    await usage.record_usage(
        provider="openai",
        service="tutor",
        model="model-test",
        status="success",
        latency_ms=12,
        input_tokens=8,
        output_tokens=2,
        total_tokens=10,
    )
    await usage.record_usage(
        provider="elevenlabs",
        service="tts",
        model="voice-test",
        status="cache_hit",
        latency_ms=1,
        characters=8,
    )
    actor = {"role": "admin"}

    async def authenticated():
        return SimpleNamespace(role=actor["role"])

    async def db():
        async with usage_db() as session:
            yield session

    app = FastAPI()
    app.include_router(admin_insights.router, prefix="/admin")
    app.dependency_overrides[current_user] = authenticated
    app.dependency_overrides[db_session] = db
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/admin/insights/ai-usage?limit=1&provider=openai")
        assert response.status_code == 200
        body = response.json()
        assert body["openai_costs"] == actual_costs
        assert body["summary"]["requests"] == 2 and body["summary"]["cache_hits"] == 1
        assert body["openai"]["total_tokens"] == 10
        assert body["summary"]["estimated_cost_usd"] is None
        assert body["summary"]["unpriced_requests"] == 1
        assert body["pagination"]["total"] == 1
        assert (
            len(body["recent_requests"]) == 1 and body["recent_requests"][0]["service"] == "tutor"
        )
        assert (await client.get("/admin/insights/ai-usage?limit=101")).status_code == 422
        assert (await client.get("/admin/insights/ai-usage?provider=invalid")).status_code == 422
        actor["role"] = "student"
        assert (await client.get("/admin/insights/ai-usage")).status_code == 403

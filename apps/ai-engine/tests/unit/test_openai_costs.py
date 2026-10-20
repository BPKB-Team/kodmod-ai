"""Actual OpenAI organization costs and their IDR display conversion."""

from datetime import UTC, datetime, timedelta

import httpx
import pytest

from tools import openai_costs

pytestmark = pytest.mark.unit


async def test_actual_costs_use_admin_key_and_convert_usd_to_idr(monkeypatch):
    service = openai_costs
    admin_key = "admin-test-secret"
    monkeypatch.setattr(service.settings, "OPENAI_ADMIN_KEY", admin_key)
    now = datetime(2026, 10, 20, 12, 0, tzinfo=UTC)
    requests = []

    def respond(request):
        requests.append(request)
        if request.url.host == "api.openai.com":
            assert request.method == "GET"
            assert request.url.path == "/v1/organization/costs"
            assert request.headers["Authorization"] == f"Bearer {admin_key}"
            params = dict(request.url.params)
            assert params["start_time"] == str(int((now - timedelta(days=30)).timestamp()))
            assert params["end_time"] == str(int(now.timestamp()))
            assert params["bucket_width"] == "1d"
            assert int(params["limit"]) <= 180
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "start_time": 1792368000,
                            "results": [
                                {"amount": {"value": 0.25, "currency": "usd"}},
                                {"amount": {"value": 0.05, "currency": "USD"}},
                            ],
                        },
                        {
                            "start_time": 1792454400,
                            "results": [
                                {"amount": {"value": 0.20, "currency": "usd"}},
                            ],
                        },
                    ],
                    "has_more": False,
                    "next_page": None,
                },
            )
        assert request.url.host == "api.frankfurter.dev"
        assert request.url.path == "/v2/rate/usd/idr"
        return httpx.Response(
            200, json={"date": "2026-10-19", "base": "USD", "quote": "IDR", "rate": 16500.5}
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        result = await service.get_openai_costs(client=client, now=now)

    assert len(requests) == 2
    assert result["configured"] is True
    assert result["available"] is True
    assert result["total_usd"] == pytest.approx(0.5)
    assert result["total_idr"] == 8250
    assert result["exchange_rate"] == pytest.approx(16500.5)
    assert result["exchange_rate_date"] == "2026-10-19"
    assert admin_key not in repr(result)


async def test_missing_admin_key_does_not_call_external_services(monkeypatch):
    service = openai_costs
    monkeypatch.setattr(service.settings, "OPENAI_ADMIN_KEY", None)

    def unexpected_request(request):
        raise AssertionError(f"unexpected external request to {request.url.host}")

    async with httpx.AsyncClient(transport=httpx.MockTransport(unexpected_request)) as client:
        result = await service.get_openai_costs(client=client)

    assert result["configured"] is False
    assert result["available"] is False
    assert result["error_code"] == "admin_key_missing"
    assert result["total_usd"] is None
    assert result["total_idr"] is None


async def test_exchange_rate_failure_keeps_actual_usd_cost_visible(monkeypatch):
    service = openai_costs
    monkeypatch.setattr(service.settings, "OPENAI_ADMIN_KEY", "admin-test-secret")

    def respond(request):
        if request.url.host == "api.openai.com":
            return httpx.Response(
                200, json={"data": [{"results": [{"amount": {"value": 1.25, "currency": "usd"}}]}]}
            )
        return httpx.Response(503, text="private exchanger detail")

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        result = await service.get_openai_costs(client=client)

    assert result["available"] is True
    assert result["total_usd"] == pytest.approx(1.25)
    assert result["total_idr"] is None
    assert result["exchange_rate"] is None
    assert result["error_code"] == "exchange_rate_unavailable"
    assert "private exchanger detail" not in repr(result)


async def test_openai_costs_provider_error_is_redacted(monkeypatch):
    service = openai_costs
    monkeypatch.setattr(service.settings, "OPENAI_ADMIN_KEY", "admin-test-secret")

    def respond(request):
        if request.url.host == "api.openai.com":
            return httpx.Response(403, json={"error": {"message": "admin-test-secret rejected"}})
        raise AssertionError("FX must not be queried after Costs API failure")

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        result = await service.get_openai_costs(client=client)

    assert result["configured"] is True
    assert result["available"] is False
    assert result["error_code"] == "openai_costs_unavailable"
    assert result["total_usd"] is None
    assert "admin-test-secret" not in repr(result)

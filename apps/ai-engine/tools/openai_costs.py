"""Read organization-level OpenAI costs for the admin monitoring page."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

import httpx

from config.settings import settings

OPENAI_COSTS_URL = "https://api.openai.com/v1/organization/costs"
EXCHANGE_RATE_URL = "https://api.frankfurter.dev/v2/rate/usd/idr"
PERIOD_DAYS = 30
TIMEOUT = httpx.Timeout(8.0, connect=3.0)


class _CostDataError(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _result(*, configured: bool, available: bool, error_code: str | None = None) -> dict:
    return {
        "configured": configured,
        "available": available,
        "period_days": PERIOD_DAYS,
        "currency": "USD",
        "total_usd": None,
        "total_idr": None,
        "exchange_rate": None,
        "exchange_rate_date": None,
        "fetched_at": datetime.now(UTC).isoformat(),
        "error_code": error_code,
    }


def _amount(value: object) -> Decimal:
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise _CostDataError("openai_costs_unavailable") from None
    if not amount.is_finite() or amount < 0:
        raise _CostDataError("openai_costs_unavailable")
    return amount


async def _organization_total(client: httpx.AsyncClient, admin_key: str, now: datetime) -> Decimal:
    end_time = int(now.timestamp())
    params: dict[str, str | int] = {
        "start_time": int((now - timedelta(days=PERIOD_DAYS)).timestamp()),
        "end_time": end_time,
        "bucket_width": "1d",
        "limit": PERIOD_DAYS + 1,
    }
    total = Decimal("0")
    seen_pages: set[str] = set()

    for _ in range(3):
        response = await client.get(
            OPENAI_COSTS_URL,
            params=params,
            headers={"Authorization": f"Bearer {admin_key}", "Accept": "application/json"},
        )
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
            raise _CostDataError("openai_costs_unavailable")

        for bucket in payload["data"]:
            if not isinstance(bucket, dict):
                raise _CostDataError("openai_costs_unavailable")
            results = bucket.get("results", [])
            if not isinstance(results, list):
                raise _CostDataError("openai_costs_unavailable")
            for item in results:
                if not isinstance(item, dict):
                    raise _CostDataError("openai_costs_unavailable")
                amount = item.get("amount")
                if amount is None:
                    continue
                if not isinstance(amount, dict):
                    raise _CostDataError("openai_costs_unavailable")
                value = amount.get("value")
                if value is None:
                    continue
                if str(amount.get("currency", "")).lower() != "usd":
                    raise _CostDataError("unsupported_currency")
                total += _amount(value)

        if not payload.get("has_more"):
            return total
        cursor = payload.get("next_page")
        if not isinstance(cursor, str) or not cursor or cursor in seen_pages:
            raise _CostDataError("openai_costs_unavailable")
        seen_pages.add(cursor)
        params["page"] = cursor

    raise _CostDataError("openai_costs_unavailable")


async def _exchange_rate(client: httpx.AsyncClient) -> tuple[Decimal, str] | None:
    try:
        response = await client.get(EXCHANGE_RATE_URL)
        response.raise_for_status()
        payload = response.json()
        if (
            not isinstance(payload, dict)
            or payload.get("base") != "USD"
            or payload.get("quote") != "IDR"
        ):
            return None
        rate = _amount(payload.get("rate"))
        if rate <= 0:
            return None
        rate_date = datetime.strptime(str(payload.get("date")), "%Y-%m-%d").date().isoformat()
        return rate, rate_date
    except (httpx.HTTPError, ValueError, TypeError, KeyError):
        return None


async def _load(client: httpx.AsyncClient, admin_key: str, now: datetime) -> dict:
    result = _result(configured=True, available=False)
    try:
        total_usd = await _organization_total(client, admin_key, now)
    except _CostDataError as error:
        result["error_code"] = error.code
        return result
    except (httpx.HTTPError, ValueError, TypeError, KeyError):
        result["error_code"] = "openai_costs_unavailable"
        return result

    result["available"] = True
    result["total_usd"] = float(total_usd)
    exchange = await _exchange_rate(client)
    if exchange is None:
        result["error_code"] = "exchange_rate_unavailable"
        return result

    rate, rate_date = exchange
    result["exchange_rate"] = float(rate)
    result["exchange_rate_date"] = rate_date
    result["total_idr"] = int((total_usd * rate).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    return result


async def get_openai_costs(
    *, client: httpx.AsyncClient | None = None, now: datetime | None = None
) -> dict:
    """Return actual 30-day organization costs and a dated IDR reference conversion."""
    admin_key = (settings.OPENAI_ADMIN_KEY or "").strip()
    if not admin_key:
        return _result(configured=False, available=False, error_code="admin_key_missing")

    current = now or datetime.now(UTC)
    if current.tzinfo is None:
        current = current.replace(tzinfo=UTC)
    current = current.astimezone(UTC)

    if client is not None:
        return await _load(client, admin_key, current)
    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=False) as owned_client:
        return await _load(owned_client, admin_key, current)

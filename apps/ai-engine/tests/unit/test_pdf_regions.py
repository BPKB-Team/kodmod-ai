"""Region rendering and bounded optional vision are separately testable."""

import pytest

from api.pdf_regions import region_cache_key, render_region
from tests.unit.test_book_import import pdf


def test_region_render_is_png_and_outside_page_rejected():
    data = pdf(["Native source"])
    rendered = render_region(data, page_index=0, bbox=(10, 10, 100, 100))
    assert rendered.startswith(b"\x89PNG")
    with pytest.raises(ValueError):
        render_region(data, page_index=0, bbox=(-10, 0, 1000, 1000))
    assert region_cache_key(data, 0, (10, 10, 100, 100)) == region_cache_key(
        data, 0, (10, 10, 100, 100)
    )
    assert region_cache_key(data, 0, (10, 10, 100, 100)) != region_cache_key(
        data, 0, (11, 10, 100, 100)
    )


async def test_vision_budget_cache_failure_and_no_paid_retry(monkeypatch, tmp_path):
    import json
    from types import SimpleNamespace

    from config.settings import settings
    from tools import material_vision_tool as vision

    monkeypatch.setattr(settings, "UPLOAD_DIR", tmp_path)
    monkeypatch.setattr(settings, "MATERIAL_VISION_ENABLED", True)
    monkeypatch.setattr(settings, "LLM_MATERIAL_VISION_MODEL", "configured-vision-model")
    calls = []

    class Model:
        async def ainvoke(self, messages):
            calls.append(messages)
            return SimpleNamespace(content=json.dumps({"text": "Tabel: Bumi, periode 365 hari"}))

    monkeypatch.setattr(vision, "get_material_vision_llm", lambda: Model())
    budget = vision.VisionBudget()
    for n in range(11):
        await vision.analyze_material_region(b"PNG", source_key=f"source-{n}", budget=budget)
    assert len(calls) == 10
    assert "untrusted" in calls[0][0].content.lower()
    cached = await vision.analyze_material_region(
        b"PNG", source_key="source-0", budget=vision.VisionBudget()
    )
    assert "365 hari" in cached.text and cached.needs_review and len(calls) == 10

    class BadModel:
        async def ainvoke(self, *a):
            calls.append("bad")
            return SimpleNamespace(content='{"text":"x","asset_id":"invented"}')

    monkeypatch.setattr(vision, "get_material_vision_llm", lambda: BadModel())
    first = await vision.analyze_material_region(
        b"PNG", source_key="bad", budget=vision.VisionBudget()
    )
    second = await vision.analyze_material_region(
        b"PNG", source_key="bad", budget=vision.VisionBudget()
    )
    assert not first.text and not second.text and len(calls) == 11


async def test_vision_disabled_and_timeout_remain_review_required(monkeypatch, tmp_path):
    import asyncio

    from config.settings import settings
    from tools import material_vision_tool as vision

    monkeypatch.setattr(settings, "UPLOAD_DIR", tmp_path)
    monkeypatch.setattr(settings, "MATERIAL_VISION_ENABLED", False)
    monkeypatch.setattr(
        vision, "get_material_vision_llm", lambda: (_ for _ in ()).throw(AssertionError("disabled"))
    )
    result = await vision.analyze_material_region(
        b"PNG", source_key="disabled", budget=vision.VisionBudget()
    )
    assert result.needs_review and not result.text
    monkeypatch.setattr(settings, "MATERIAL_VISION_ENABLED", True)
    monkeypatch.setattr(settings, "LLM_MATERIAL_VISION_MODEL", "test-vision")

    class Slow:
        async def ainvoke(self, *a):
            await asyncio.sleep(1)

    monkeypatch.setattr(vision, "get_material_vision_llm", lambda: Slow())
    result = await vision.analyze_material_region(
        b"PNG", source_key="timeout", budget=vision.VisionBudget(timeout_seconds=0.01)
    )
    assert not result.text and result.needs_review

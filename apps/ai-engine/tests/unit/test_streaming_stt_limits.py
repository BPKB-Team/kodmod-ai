from __future__ import annotations

import pytest

from voice.streaming import StreamingSTT

pytestmark = pytest.mark.unit


@pytest.mark.asyncio
async def test_feed_rejects_audio_frame_above_hard_limit() -> None:
    stt = StreamingSTT(sample_rate=16_000)

    with pytest.raises(ValueError, match="maximum allowed size"):
        await stt.feed(b"x" * (stt.max_frame_bytes + 1))

    assert stt._buffered_bytes == 0
    assert not stt._buffer


@pytest.mark.asyncio
async def test_feed_keeps_rolling_audio_buffer_within_hard_limit(monkeypatch) -> None:
    stt = StreamingSTT(sample_rate=10)
    transcribed: list[bytes] = []

    async def capture(audio_bytes: bytes, *, partial: bool) -> str:
        assert partial
        transcribed.append(audio_bytes)
        return ""

    monkeypatch.setattr(stt, "_transcribe", capture)

    await stt.feed(b"a" * 80)
    await stt.feed(b"b" * 80)

    assert stt._buffered_bytes == stt.max_frame_bytes == 120
    assert transcribed[-1] == b"a" * 40 + b"b" * 80

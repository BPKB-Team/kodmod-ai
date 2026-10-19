"""Small, dependency-light client for the ElevenLabs speech APIs.

The application deliberately talks to ElevenLabs through ``httpx`` instead of
the vendor SDK.  This keeps the API process lightweight, gives batch and
streaming TTS the same error handling, and keeps the provider key inside the
backend process.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import httpx

from config.settings import settings

TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream"
STT_URL = "https://api.elevenlabs.io/v1/speech-to-text"
DEFAULT_TTS_MODEL = "eleven_multilingual_v2"
DEFAULT_TTS_OUTPUT_FORMAT = "mp3_44100_128"
DEFAULT_STT_MODEL = "scribe_v2"
MAX_TTS_CHARACTERS = 5_000


class ElevenLabsConfigurationError(RuntimeError):
    """Raised when the provider is selected without the required settings."""


class ElevenLabsError(RuntimeError):
    """Safe provider error that never includes the response body."""

    def __init__(
        self, message: str, *, status_code: int | None = None, request_id: str | None = None
    ):
        super().__init__(message)
        self.status_code = status_code
        self.request_id = request_id


def _api_key() -> str:
    value = getattr(settings, "ELEVENLABS_API_KEY", None)
    if not value or not value.strip():
        raise ElevenLabsConfigurationError(
            "ElevenLabs is not configured: set ELEVENLABS_API_KEY on the backend"
        )
    return value.strip()


def _voice_id(voice_id: str | None) -> str:
    value = voice_id or getattr(settings, "ELEVENLABS_TTS_VOICE_ID", None)
    if not value or not value.strip():
        raise ElevenLabsConfigurationError(
            "ElevenLabs is not configured: set ELEVENLABS_TTS_VOICE_ID on the backend"
        )
    return value.strip()


def _headers() -> dict[str, str]:
    return {
        "xi-api-key": _api_key(),
        "Accept": "audio/mpeg",
    }


def _timeout() -> float:
    return float(getattr(settings, "ELEVENLABS_TIMEOUT_SECONDS", 60.0))


def _tts_payload(text: str) -> dict[str, Any]:
    plain = text.strip()
    if not plain:
        raise ValueError("text must not be empty")
    if len(plain) > MAX_TTS_CHARACTERS:
        raise ValueError(f"text must be at most {MAX_TTS_CHARACTERS} characters")

    payload: dict[str, Any] = {
        "text": plain,
        "model_id": getattr(settings, "ELEVENLABS_TTS_MODEL", DEFAULT_TTS_MODEL),
    }
    voice_settings = {
        "stability": getattr(settings, "ELEVENLABS_TTS_STABILITY", 0.5),
        "similarity_boost": getattr(settings, "ELEVENLABS_TTS_SIMILARITY_BOOST", 0.75),
        "style": getattr(settings, "ELEVENLABS_TTS_STYLE", 0.0),
        "speed": getattr(settings, "ELEVENLABS_TTS_SPEED", 0.92),
        "use_speaker_boost": getattr(settings, "ELEVENLABS_TTS_SPEAKER_BOOST", False),
    }
    payload["voice_settings"] = voice_settings
    return payload


def _request_id(response: httpx.Response) -> str | None:
    return response.headers.get("request-id") or response.headers.get("x-request-id")


def _raise_for_provider(response: httpx.Response, *, operation: str) -> None:
    if 200 <= response.status_code < 300:
        return
    raise ElevenLabsError(
        f"ElevenLabs {operation} request failed (status {response.status_code})",
        status_code=response.status_code,
        request_id=_request_id(response),
    )


async def _synthesise(
    text: str,
    *,
    voice_id: str | None = None,
    model_id: str | None = None,
    output_format: str | None = None,
) -> bytes:
    """Return a complete MP3 response from ElevenLabs TTS."""
    payload = _tts_payload(text)
    if model_id:
        payload["model_id"] = model_id
    voice = _voice_id(voice_id)
    fmt = output_format or getattr(
        settings, "ELEVENLABS_TTS_OUTPUT_FORMAT", DEFAULT_TTS_OUTPUT_FORMAT
    )
    params = {"output_format": fmt} if fmt else {}

    try:
        async with httpx.AsyncClient(timeout=_timeout(), follow_redirects=False) as client:
            response = await client.post(
                TTS_URL.format(voice_id=voice),
                headers={**_headers(), "Content-Type": "application/json"},
                params=params,
                json=payload,
            )
    except httpx.RequestError as exc:
        raise ElevenLabsError("ElevenLabs TTS request could not be completed") from exc

    _raise_for_provider(response, operation="TTS")
    return response.content


async def _stream_speech(
    text: str,
    *,
    voice_id: str | None = None,
    model_id: str | None = None,
    output_format: str | None = None,
    chunk_size: int = 4096,
) -> AsyncIterator[bytes]:
    """Yield MP3 chunks as ElevenLabs generates them."""
    payload = _tts_payload(text)
    if model_id:
        payload["model_id"] = model_id
    voice = _voice_id(voice_id)
    fmt = output_format or getattr(
        settings, "ELEVENLABS_TTS_OUTPUT_FORMAT", DEFAULT_TTS_OUTPUT_FORMAT
    )
    params = {"output_format": fmt} if fmt else {}

    try:
        async with httpx.AsyncClient(timeout=_timeout(), follow_redirects=False) as client:
            async with client.stream(
                "POST",
                TTS_URL.format(voice_id=voice),
                headers={**_headers(), "Content-Type": "application/json"},
                params=params,
                json=payload,
            ) as response:
                _raise_for_provider(response, operation="TTS stream")
                async for chunk in response.aiter_bytes(chunk_size=chunk_size):
                    if chunk:
                        yield chunk
    except httpx.RequestError as exc:
        raise ElevenLabsError("ElevenLabs TTS stream could not be completed") from exc


async def _transcribe(
    audio_bytes: bytes,
    *,
    filename: str = "audio.webm",
    content_type: str = "application/octet-stream",
    language: str | None = None,
) -> dict[str, Any]:
    """Transcribe an uploaded audio file with ElevenLabs Scribe."""
    if not audio_bytes:
        raise ValueError("audio must not be empty")

    data: dict[str, str] = {
        "model_id": getattr(settings, "ELEVENLABS_STT_MODEL", DEFAULT_STT_MODEL),
    }
    language_code = language or getattr(settings, "STT_LANGUAGE", None)
    if language_code:
        data["language_code"] = language_code
    if getattr(settings, "ELEVENLABS_STT_NO_VERBATIM", True):
        data["no_verbatim"] = "true"

    files = {
        "file": (filename or "audio.webm", audio_bytes, content_type or "application/octet-stream")
    }
    try:
        async with httpx.AsyncClient(timeout=_timeout(), follow_redirects=False) as client:
            response = await client.post(
                STT_URL,
                headers={"xi-api-key": _api_key()},
                data=data,
                files=files,
            )
    except httpx.RequestError as exc:
        raise ElevenLabsError("ElevenLabs STT request could not be completed") from exc

    _raise_for_provider(response, operation="STT")
    try:
        body = response.json()
    except ValueError as exc:
        raise ElevenLabsError("ElevenLabs STT returned an invalid response") from exc

    result: dict[str, Any] = {
        "text": str(body.get("text") or "").strip(),
        "language_code": body.get("language_code") or language_code or "",
    }
    if isinstance(body.get("words"), list):
        result["words"] = body["words"]
    if isinstance(body.get("audio_duration"), (int, float)):
        result["audio_seconds"] = body["audio_duration"]
    return result


async def synthesise(text: str, *, voice_id=None, model_id=None, output_format=None) -> bytes:
    import asyncio
    import time

    from tools.provider_usage import record_usage

    started = time.monotonic()
    model = model_id or getattr(settings, "ELEVENLABS_TTS_MODEL", DEFAULT_TTS_MODEL)
    try:
        audio = await _synthesise(
            text, voice_id=voice_id, model_id=model_id, output_format=output_format
        )
    except BaseException as error:
        await record_usage(
            provider="elevenlabs",
            service="tts",
            model=model,
            status="cancelled" if isinstance(error, asyncio.CancelledError) else "error",
            latency_ms=(time.monotonic() - started) * 1000,
            error=error,
        )
        raise
    await record_usage(
        provider="elevenlabs",
        service="tts",
        model=model,
        status="success",
        latency_ms=(time.monotonic() - started) * 1000,
        characters=len(text.strip()),
        audio_bytes=len(audio),
    )
    return audio


async def stream_speech(
    text: str, *, voice_id=None, model_id=None, output_format=None, chunk_size=4096
) -> AsyncIterator[bytes]:
    import asyncio
    import time

    from tools.provider_usage import record_usage

    started, size = time.monotonic(), 0
    model = model_id or getattr(settings, "ELEVENLABS_TTS_MODEL", DEFAULT_TTS_MODEL)
    try:
        async for chunk in _stream_speech(
            text,
            voice_id=voice_id,
            model_id=model_id,
            output_format=output_format,
            chunk_size=chunk_size,
        ):
            size += len(chunk)
            yield chunk
    except BaseException as error:
        await record_usage(
            provider="elevenlabs",
            service="tts",
            model=model,
            status="cancelled"
            if isinstance(error, (asyncio.CancelledError, GeneratorExit))
            else "error",
            latency_ms=(time.monotonic() - started) * 1000,
            error=error,
        )
        raise
    await record_usage(
        provider="elevenlabs",
        service="tts",
        model=model,
        status="success",
        latency_ms=(time.monotonic() - started) * 1000,
        characters=len(text.strip()),
        audio_bytes=size,
    )


async def transcribe(
    audio_bytes: bytes,
    *,
    filename="audio.webm",
    content_type="application/octet-stream",
    language=None,
) -> dict[str, Any]:
    import asyncio
    import time

    from tools.provider_usage import record_usage

    started = time.monotonic()
    try:
        result = await _transcribe(
            audio_bytes, filename=filename, content_type=content_type, language=language
        )
    except BaseException as error:
        await record_usage(
            provider="elevenlabs",
            service="stt",
            model=getattr(settings, "ELEVENLABS_STT_MODEL", DEFAULT_STT_MODEL),
            status="cancelled" if isinstance(error, asyncio.CancelledError) else "error",
            latency_ms=(time.monotonic() - started) * 1000,
            error=error,
        )
        raise
    await record_usage(
        provider="elevenlabs",
        service="stt",
        model=getattr(settings, "ELEVENLABS_STT_MODEL", DEFAULT_STT_MODEL),
        status="success",
        latency_ms=(time.monotonic() - started) * 1000,
        audio_bytes=len(audio_bytes),
        audio_seconds=result.get("audio_seconds"),
    )
    return result


async def get_subscription_info() -> dict[str, Any]:
    """Fetch live ElevenLabs subscription quota and usage details."""
    try:
        api_key = _api_key()
    except ElevenLabsConfigurationError:
        return {"configured": False, "available": False}

    url = "https://api.elevenlabs.io/v1/user/subscription"
    headers = {"xi-api-key": api_key}
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                return {
                    "configured": True,
                    "available": True,
                    "character_count": data.get("character_count", 0),
                    "character_limit": data.get("character_limit", 0),
                    "tier": data.get("tier", "standard"),
                    "status": data.get("status", "active"),
                    "next_reset_unix": data.get("next_character_count_reset_unix"),
                }
            return {
                "configured": True,
                "available": False,
            }
    except Exception:
        return {"configured": True, "available": False}

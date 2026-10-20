"""Offline speech is restricted to the test entrypoint, with real cache behavior."""

import pytest

from config.settings import settings
from scripts.serve_test_api import speech_fixture_app
from voice import elevenlabs, tts

pytestmark = pytest.mark.unit


@pytest.mark.parametrize("env, database", [("dev", "kodmod_test"), ("test", "kodmod")])
def test_speech_fixture_refuses_application_environment(monkeypatch, tmp_path, env, database):
    original = elevenlabs.synthesise
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
    monkeypatch.setenv("AUDIO_DIR", str(tmp_path / "audio"))
    monkeypatch.setattr(settings, "ENV", env)
    monkeypatch.setattr(settings, "DB_NAME", database)
    with pytest.raises(RuntimeError, match="refuses non-test"):
        speech_fixture_app()
    assert (tmp_path / "uploads").is_dir()
    assert (tmp_path / "audio").is_dir()
    assert elevenlabs.synthesise is original


def test_speech_fixture_refuses_real_provider_run(monkeypatch, tmp_path):
    original = elevenlabs.synthesise
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
    monkeypatch.setenv("AUDIO_DIR", str(tmp_path / "audio"))
    monkeypatch.setattr(settings, "ENV", "test")
    monkeypatch.setattr(settings, "DB_NAME", "kodmod_test")
    monkeypatch.setenv("KODMOD_RUN_REAL_LLM", "1")
    with pytest.raises(RuntimeError, match="real-provider"):
        speech_fixture_app()
    assert elevenlabs.synthesise is original


async def test_speech_fixture_keeps_real_audio_cache_without_provider_key(monkeypatch, tmp_path):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
    monkeypatch.setenv("AUDIO_DIR", str(tmp_path / "audio"))
    monkeypatch.setattr(settings, "ENV", "test")
    monkeypatch.setattr(settings, "DB_NAME", "kodmod_test")
    monkeypatch.setattr(settings, "TTS_BACKEND", "elevenlabs")
    monkeypatch.setattr(settings, "ELEVENLABS_API_KEY", "")
    monkeypatch.setattr(tts, "OUTPUT_DIR", tmp_path)
    monkeypatch.delenv("KODMOD_RUN_REAL_LLM", raising=False)
    # Track the original transport so the fixture cannot leak into other tests.
    monkeypatch.setattr(elevenlabs, "synthesise", elevenlabs.synthesise)
    speech_fixture_app()
    first = await tts.synthesise_bytes("Offline menu", scope="public-menu")
    files = list((tmp_path / "speech-cache").glob("*.mp3"))
    assert len(files) == 1
    modified = files[0].stat().st_mtime_ns
    assert await tts.synthesise_bytes("Offline menu", scope="public-menu") == first
    assert first == b"ID3-kodmod-offline-test-audio"
    assert files[0].stat().st_mtime_ns == modified

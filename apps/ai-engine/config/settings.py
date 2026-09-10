"""
KODMOD AI - Configuration Settings
==================================

Centralized settings using pydantic-settings. All environment-driven knobs
flow through here so the rest of the codebase imports `settings` and never
touches `os.environ` directly.

Environment variables can be supplied via:
- A `.env` file in the project root
- Real environment variables (preferred for production / Kubernetes)
- Docker secrets mounted as files

The naming convention mirrors the env keys (UPPER_SNAKE_CASE) so deployers
can grep the codebase to find every knob a single name corresponds to.

Every field has a safe default so `from config.settings import settings`
never raises in a clean environment (see tests/static/test_settings_load.py) -
a missing LLM API key or model id should fail lazily, the first time it's
actually needed (see `tools.llm_client._resolve`), not at import time.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Sentinel used as the default for every LLM_*_MODEL field. `.env.example`
# ships this literal value so a fresh checkout fails loudly (but lazily, on
# first use - see tools.llm_client._resolve) instead of silently calling
# whatever model a hardcoded default happened to name.
MODEL_UNSET = "SET_ME_IN_ENV"


class Settings(BaseSettings):
    """Application-wide settings."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
        # CORS_ALLOW_ORIGINS is a List[str]; without this, pydantic-settings
        # tries to JSON-decode the raw env string before our comma-split
        # validator ever runs, and a plain "a,b" value blows up with a
        # confusing SettingsError. Let the validator do all the parsing.
        enable_decoding=False,
    )

    # ------------------------------------------------------------------ env
    ENV: Literal["dev", "staging", "prod", "test"] = "dev"
    APP_NAME: str = "KODMOD AI"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = False

    # ------------------------------------------------------------------ api
    API_HOST: str = "0.0.0.0"
    API_PORT: int = 8000
    API_PREFIX: str = "/api/v1"
    # Comma-separated. Credentials are allowed on the CORS middleware, so "*"
    # is not a valid value - list the frontend origin(s) explicitly.
    CORS_ALLOW_ORIGINS: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])
    JWT_SECRET: str = "change-me-in-production"
    JWT_ALG: str = "HS256"
    JWT_EXPIRE_MIN: int = 60 * 24  # 24h

    # ------------------------------------------------------------------- llm
    # OpenAI is the only provider (see tools/llm_client.py). This field is
    # kept as an inert, harmless knob for older tooling/tests that still pass
    # KODMOD_LLM_PROVIDER - nothing in llm_client branches on it anymore.
    KODMOD_LLM_PROVIDER: str = "openai"
    OPENAI_API_KEY: str | None = None
    # Override only to point at an OpenAI-compatible endpoint (e.g. the test
    # stub started by scripts/serve_test_api).
    OPENAI_BASE_URL: str | None = None
    # Legacy field - no longer read by llm_client, kept only so
    # tests/security/test_secret_hygiene.py has something to assert isn't a
    # hardcoded literal.
    ANTHROPIC_API_KEY: str | None = None

    # Per-role model ids. Required in practice, but defaulted to MODEL_UNSET
    # (not enforced by pydantic) so a missing one fails at first *use*
    # (tools.llm_client._resolve) with a clear message, not at import time.
    LLM_ROUTER_MODEL: str = MODEL_UNSET
    LLM_TUTOR_MODEL: str = MODEL_UNSET
    LLM_QUIZ_MODEL: str = MODEL_UNSET
    LLM_SCORING_MODEL: str = MODEL_UNSET
    LLM_RECOMMENDATION_MODEL: str = MODEL_UNSET
    LLM_REFLECTION_MODEL: str = MODEL_UNSET

    # ------------------------------------------------------------- database
    DB_USER: str = "kodmod"
    DB_PASSWORD: str = "kodmod"
    DB_HOST: str = "localhost"
    DB_PORT: int = 5432
    DB_NAME: str = "kodmod"
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20

    @property
    def DATABASE_URL(self) -> str:  # noqa: N802 (uppercase property is intentional)
        return (
            f"postgresql+asyncpg://{self.DB_USER}:{self.DB_PASSWORD}"
            f"@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"
        )

    @property
    def LANGGRAPH_DB_URI(self) -> str:  # noqa: N802
        # AsyncPostgresSaver / psycopg expect a libpq-style DSN, not the
        # SQLAlchemy +asyncpg driver form.
        return (
            f"postgresql://{self.DB_USER}:{self.DB_PASSWORD}"
            f"@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"
        )

    # ---------------------------------------------------------------- redis
    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379
    REDIS_DB: int = 0
    REDIS_PASSWORD: str | None = None

    @property
    def REDIS_URL(self) -> str:  # noqa: N802
        auth = f":{self.REDIS_PASSWORD}@" if self.REDIS_PASSWORD else ""
        return f"redis://{auth}{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"

    # ------------------------------------------------------------ langgraph
    # "postgres" persists sessions across restarts and supports
    # human-in-the-loop interrupts; "memory" is for local dev / tests where
    # nothing needs to survive a process restart.
    CHECKPOINTER: Literal["postgres", "memory"] = "postgres"

    # ------------------------------------------------------------------- rag
    EMBEDDING_MODEL: str = "text-embedding-3-small"
    EMBEDDING_DIM: int = 1536
    VECTOR_BACKEND: Literal["pgvector", "qdrant"] = "pgvector"
    QDRANT_URL: str = "http://localhost:6333"
    QDRANT_API_KEY: str | None = None
    RERANKER_MODEL: str = "BAAI/bge-reranker-v2-m3"
    # A cross-encoder rerank pass is ~2GB of model weights; let dev/CI turn it
    # off and fall back to embedding-similarity order.
    RAG_RERANK_ENABLED: bool = True
    RAG_TOP_K: int = 8
    RAG_RERANK_TOP_K: int = 4

    # ----------------------------------------------------------------- voice
    # NOTE: the active chat flow is text-first (see api/routes/chat.py); the
    # voice/* modules and these settings are currently unwired but kept
    # working (api/routes/voice.py, api/websockets/voice_stream.py still
    # import them) so re-enabling voice doesn't require touching config.
    STT_BACKEND: Literal["faster-whisper", "openai-whisper", "deepgram"] = "faster-whisper"
    STT_MODEL: str = "large-v3"
    STT_DEVICE: Literal["cuda", "cpu", "auto"] = "auto"
    STT_COMPUTE_TYPE: str = "float16"
    STT_LANGUAGE: str = "id"
    DEEPGRAM_API_KEY: str | None = None

    TTS_BACKEND: Literal["piper", "azure", "elevenlabs", "coqui"] = "piper"
    TTS_VOICE: str = "id-ID-ArdiNeural"
    TTS_RATE: float = 1.0
    AZURE_TTS_KEY: str | None = None
    AZURE_TTS_REGION: str | None = None
    ELEVENLABS_API_KEY: str | None = None

    AUDIO_DIR: Path = Path("/var/lib/kodmod/audio")
    MAX_AUDIO_SECONDS: int = 120

    # --------------------------------------------------------- file uploads
    UPLOAD_DIR: Path = Path("./data/uploads")
    MAX_UPLOAD_MB: int = 25

    @property
    def MAX_UPLOAD_BYTES(self) -> int:  # noqa: N802
        return self.MAX_UPLOAD_MB * 1024 * 1024

    # --------------------------------------------------------- observability
    LANGSMITH_API_KEY: str | None = None
    LANGSMITH_PROJECT: str = "kodmod-ai"
    LANGCHAIN_TRACING_V2: bool = False
    PROMETHEUS_ENABLED: bool = True
    LOG_LEVEL: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    LOG_JSON: bool = True

    # ----------------------------------------------------------- pedagogy
    DEFAULT_DIFFICULTY: Literal["easy", "medium", "hard"] = "medium"
    DEFAULT_LANGUAGE: Literal["id", "en"] = "id"
    # Appended to every agent's system prompt (see tools.llm_client.
    # language_instruction) so spoken/written output stays in one consistent
    # language no matter what language the input or curriculum context is in.
    GRAPH_LANGUAGE: str = "Bahasa Indonesia"
    QUIZ_PASS_THRESHOLD: float = 0.6
    # A low score alone never blocks a quiz forever - after this many
    # attempts on the same question, route_after_scoring lets it pass
    # regardless of score (see graphs/main_graph.py).
    QUIZ_MAX_ATTEMPTS_PER_QUESTION: int = 2
    MASTERY_PROMOTION: float = 0.8
    SOCRATIC_DEPTH: int = 3  # how many follow-up turns the tutor pursues

    # ----------------------------------------------------------- accessibility
    ACCESSIBILITY_DEFAULT_PROFILE: Literal["blind", "low_vision", "standard"] = "blind"
    SSML_ENABLED: bool = True
    MAX_SPOKEN_SENTENCE_WORDS: int = 22

    # ----------------------------------------------------------------- validators
    @field_validator("CORS_ALLOW_ORIGINS", mode="before")
    @classmethod
    def _split_origins(cls, v):
        if isinstance(v, str):
            return [s.strip() for s in v.split(",") if s.strip()]
        return v

    @field_validator("AUDIO_DIR", "UPLOAD_DIR", mode="after")
    @classmethod
    def _ensure_dir(cls, v: Path) -> Path:
        try:
            v.mkdir(parents=True, exist_ok=True)
        except (PermissionError, OSError):
            # In tests / restricted CI we silently skip; the runtime user must
            # ensure these exist with proper perms in production.
            pass
        return v


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached accessor - call this everywhere instead of `Settings()`."""
    return Settings()


# Convenience singleton (most code does `from config.settings import settings`)
settings = get_settings()


# Side-effect: wire LangSmith env vars if enabled.
if settings.LANGCHAIN_TRACING_V2 and settings.LANGSMITH_API_KEY:
    import os

    os.environ.setdefault("LANGCHAIN_TRACING_V2", "true")
    os.environ.setdefault("LANGCHAIN_API_KEY", settings.LANGSMITH_API_KEY)
    os.environ.setdefault("LANGCHAIN_PROJECT", settings.LANGSMITH_PROJECT)

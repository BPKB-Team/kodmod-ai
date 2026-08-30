# @kodmod/ai-engine

Backend agentic KODMOD. Python 3.11+, FastAPI, LangGraph.

## Menjalankan

```bash
# dari root repo:
docker compose up -d postgres redis

python -m venv .venv
.venv/Scripts/activate        # Windows;  source .venv/bin/activate di Unix
pip install -e ".[dev]"
cp .env.example .env          # isi ANTHROPIC_API_KEY
uvicorn api.main:app --reload --port 8000
```

## Struktur

```
agents/          Node LangGraph, satu file per agent
graphs/          state.py (KODMODState) + main_graph.py (orchestrator)
tools/           Tool yang di-bind ke agent (RAG, profil siswa, klien LLM)
rag/             Ingestion → chunking → embedding → retrieval → rerank
  stores/        Backend vektor: pgvector (default) | qdrant
voice/           STT (faster-whisper/Deepgram) + TTS (Piper/Azure/ElevenLabs)
memory/          long_term.py (mastery Postgres), short_term.py (sesi Redis)
analytics/       student_model.py, aggregator.py, insights.py
accessibility/   narration.py, simplifier.py, voice_commands.py
api/             FastAPI: routes/ + websockets/voice_stream.py
database/        SQLAlchemy models, schema.sql, migrasi Alembic
models/          Model domain Pydantic
prompts/         System prompt versi-terkontrol (.md) + loader.py
config/          settings.py (pydantic-settings), logging.py
tests/           unit/ + integration/
```

## Alur satu giliran

```
audio → stt → intent_router ─┬─► rag_retrieval → tutoring → reflection
                             │                              → accessibility → tts
                             ├─► problem_generator → quiz_ask → tts
                             └─► analytics → recommendation → accessibility
```

## Perintah

```bash
pytest -q              # test
ruff check .           # lint
ruff check --fix .     # auto-fix
alembic upgrade head   # migrasi basis data
```

## Konfigurasi

Semua knob lewat `config/settings.py` (pydantic-settings), diisi dari `.env`.
Lihat `.env.example` untuk daftar lengkapnya.

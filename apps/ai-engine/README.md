# @kodmod/ai-engine

Backend agentic-nya KODMOD. Python 3.11+, FastAPI, LangGraph.

## Cara menjalankan

```bash
# dari root repo
docker compose up -d postgres redis

python -m venv .venv
.venv/Scripts/activate        # Windows, kalau di Unix pakai: source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env          # isi ANTHROPIC_API_KEY-nya
uvicorn api.main:app --reload --port 8000
```

## Struktur folder

```
agents/          Node LangGraph, satu file per agent
graphs/          state.py (KODMODState) + main_graph.py (orchestrator)
tools/           Tool yang dipakai agent (RAG, profil siswa, klien LLM)
rag/             Alur ingestion -> chunking -> embedding -> retrieval -> rerank
  stores/        Backend vektor: pgvector (default) atau qdrant
voice/           STT (faster-whisper/Deepgram) + TTS (Piper/Azure/ElevenLabs)
memory/          long_term.py (mastery di Postgres), short_term.py (sesi di Redis)
analytics/       student_model.py, aggregator.py, insights.py
accessibility/   narration.py, simplifier.py, voice_commands.py
api/             FastAPI: routes/ + websockets/voice_stream.py
database/        SQLAlchemy models, schema.sql, migrasi Alembic
models/          Model domain Pydantic
prompts/         System prompt yang di-versioning (.md) + loader.py
config/          settings.py (pydantic-settings), logging.py
tests/           unit/ + integration/
```

## Alur satu giliran percakapan

```
audio -> stt -> intent_router
                  |-> rag_retrieval -> tutoring -> reflection -> accessibility -> tts
                  |-> problem_generator -> quiz_ask -> tts
                  |-> analytics -> recommendation -> accessibility
```

## Perintah yang sering dipakai

```bash
pytest -q              # jalanin test
ruff check .           # lint
ruff check --fix .     # auto-fix lint
alembic upgrade head   # migrasi basis data
```

## Konfigurasi

Semua pengaturan lewat `config/settings.py` (pydantic-settings), diisi dari file `.env`. Lihat `.env.example` buat daftar lengkapnya.

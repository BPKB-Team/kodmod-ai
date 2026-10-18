# Qdrant Retrieval Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use Qdrant for KODMOD vector candidate search while PostgreSQL continues to own content and enforce access.

**Architecture:** Add an async Qdrant adapter selected by `VECTOR_BACKEND`. Qdrant supplies candidate IDs and coarse scope filters; the existing PostgreSQL query validates every ID, retrieves text, and remains the fallback. Indexes are synchronized best-effort and can be rebuilt from PostgreSQL.

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy async, pgvector, `qdrant-client` 1.19.x, Qdrant 1.19.2, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-17-qdrant-rag-design.md`

## Global Constraints

- PostgreSQL remains the source of truth for content, enrollment, publication, and indexed revisions.
- Qdrant payloads must not contain chunk text, imported source paths, provenance, or accessibility metadata.
- Preserve the existing pgvector fallback and make Qdrant optional outside the Docker Centre environment.
- Keep Qdrant on the private Compose network only; do not publish REST/gRPC ports to the host.
- Never remove Qdrant or PostgreSQL data volumes during rollout or rollback.
- Do not change the existing chat API response contract or embedding model/dimension.

## Review Focus

- A stale, unpublished, archived, or unenrolled class-material point must never return text; verify with the existing PostgreSQL filtering path.
- A Qdrant timeout or missing collection must return through pgvector rather than fail tutoring.
- Reindexing must reuse stored vectors and preserve point UUIDs without deleting a legacy collection.
- Concurrent/repeated material indexing must leave Qdrant point IDs aligned with the committed PostgreSQL rows.
- Qdrant payloads must not copy text or private import provenance.

---

### Task 1: Qdrant adapter and configuration

**Files:**
- Modify: `apps/ai-engine/config/settings.py`
- Modify: `apps/ai-engine/requirements.txt`
- Modify: `apps/ai-engine/rag/stores/qdrant_store.py`

**Interfaces:**
- `query(embedding, *, top_k, concept_id, subject_id, language, student_id, class_id, material_id) -> list[dict]` returns only PostgreSQL-validated documents.
- PostgreSQL `upsert_chunks(records) -> int` commits canonical rows, then mirrors point UUIDs, vectors, and allowlisted filter payload to Qdrant.
- `sync_material_replacement(old_ids, points)`, `delete_points(ids)`, `ensure_collection()`, and `close_client()` provide Qdrant lifecycle operations.

- [x] Add `QDRANT_COLLECTION="kodmod_curriculum_v2"` and timeout configuration; retain `VECTOR_BACKEND="pgvector"` as the application default.
- [x] Add `qdrant-client>=1.19.1,<2.0` to both runtime dependency manifests and use `AsyncQdrantClient` with `query_points`.
- [x] Ensure the cosine collection uses `EMBEDDING_DIM`, create it lazily, and avoid storing text or provenance in point payloads.
- [x] Provide best-effort client close and explicit logging when collection setup or Qdrant requests fail.

### Task 2: Select Qdrant for retrieval without weakening authorization

**Files:**
- Modify: `apps/ai-engine/rag/stores/pgvector_store.py`
- Modify: `apps/ai-engine/rag/retriever.py`
- Modify: `apps/ai-engine/tools/rag_tool.py`
- Modify: `apps/ai-engine/tests/integration/test_rag_retriever.py` (update the existing backend-selection contract only)

**Interfaces:**
- `pgvector_store.query(..., candidate_ids: list[uuid.UUID] | None = None)` adds an optional candidate-ID restriction while preserving all existing SQL authorization and revision predicates.
- Both retrieval entry points use `qdrant_store` when `settings.VECTOR_BACKEND == "qdrant"`; otherwise behavior remains pgvector-only.

- [x] Add Qdrant scope filters (`global` or `class`), class/material filters for class retrieval, and concept/subject/language filters for global retrieval.
- [x] Validate IDs and vector freshness hashes through the existing PostgreSQL query, order by its cosine score, and use full pgvector fallback on Qdrant errors, stale IDs, or fewer validated results than requested.
- [x] Keep invalid class/student/material combinations fail-closed before returning results.

### Task 3: Keep the vector index synchronized and backfill existing rows

**Files:**
- Modify: `apps/ai-engine/rag/stores/pgvector_store.py`
- Modify: `apps/ai-engine/api/material_service.py`
- Create: `apps/ai-engine/scripts/reindex_qdrant.py`

**Interfaces:**
- `reindex_qdrant` reads committed `CurriculumChunk` rows, joins class IDs where present, and calls `qdrant_store.upsert_chunks` in bounded batches.
- PostgreSQL remains durable if a Qdrant sync fails; the operation logs a degraded-index warning and retrieval uses pgvector fallback.

- [x] Assign stable row IDs before global upserts and best-effort mirror global vectors to Qdrant after the PostgreSQL commit.
- [x] After class-material commits, replace points for the material with the committed row IDs and class scope; keep class text only in PostgreSQL.
- [x] Capture IDs before source/document deletes and best-effort remove those points after PostgreSQL commits.
- [x] Add an idempotent backfill command with a configurable batch size; do not call the embedding provider or clear collections.

### Task 4: Enable and document local Docker Centre integration

**Files:**
- Modify: `docker-compose.yml`
- Modify: `infra/docker/compose.centre.example.yaml`
- Modify: `scripts/docker.ps1`
- Modify: `apps/ai-engine/.env.example`
- Modify: `docs/ARCHITECTURE.md`
- Create: `docs/QDRANT_INTEGRATION.md`
- Local config: `F:\Docker_Centre\kodmod\.env` (set backend only; do not expose other values)

- [x] Pin the Qdrant service to `qdrant/qdrant:v1.19.2`, pass `VECTOR_BACKEND`/collection settings to API services, and retain the optional `qdrant` profile.
- [x] Make the Windows startup wrapper activate the Qdrant profile when its selected backend is Qdrant, without changing the default pgvector behavior.
- [x] Document `python -m scripts.reindex_qdrant`, the private Compose URL, named-volume storage on the F: Docker data disk, backup/restore, and rollback to pgvector.
- [x] Enable Qdrant in the current Docker Centre `.env` and backfill the existing vectors after Qdrant was healthy.

### Task 5: Local rollout checks

**Files:** No additional source files.

- [x] Confirm Compose configuration is valid and only the `kodmod-centre` project changes.
- [x] Start/rebuild KODMOD using its guarded Docker wrapper, which takes a PostgreSQL backup before migrations.
- [x] Run the Qdrant backfill and inspect the collection point count without printing secrets or material text.
- [x] Confirm KODMOD web/API/database/worker and Qdrant are healthy and the existing Timgravid containers remain running.
- [x] Run the full repository test/readiness suite after the user explicitly requested full testing; keep its unrelated blockers visible in the completion report.

## Rollout verification (2026-10-18)

- Active Docker Centre storage is the Compose named volume `kodmod-centre_kodmod-qdrantdata`, backed by Docker Desktop WSL2/ext4 under `F:\Docker_Centre\wsl\DockerDesktopWSL`. The former Windows bind directory `F:\Docker_Centre\kodmod\data\qdrant` remains intact and is not mounted by the active Qdrant container.
- Qdrant `v1.19.2` is on the private Compose network. REST `6333` and gRPC `6334` have no host port mappings.
- Reindexed 30 canonical PostgreSQL vectors. The active `kodmod_curriculum_v2` collection reported `green` with 30 points; its payload contained only allowlisted metadata.
- Snapshot restore was verified into a unique temporary collection using the SHA-256 checksum: 30 points restored, status `green`, and the temporary collection/file were removed after verification.
- Verified backup: `F:\Docker_Centre\kodmod\backups\qdrant\kodmod_curriculum_v2-5134353806303611-2026-10-17-21-18-47.snapshot` (897,024 bytes), SHA-256 `b16d1ed0f635ec7a0125be8f50e8afde3f57899b5bcb146ea0f73d653dc76b36`.
- The earlier 580,416,000-byte snapshot from the old `9p` bind mount has an invalid WAL and failed restore. It remains as a forensic artifact; do not restore it. The previous bind directory is also retained.
- Full repository readiness is not green: the suite recorded 1,062 passes and 9 skips, while separate readiness checks identified three known blockers (two mypy errors in `apps/ai-engine/analytics/aggregator.py` and an Alembic database-not-at-head check). Coverage targets and traceability/benchmark/soak evidence also remain outstanding. These are not Qdrant collection or restore failures.

## Review before publishing (2026-10-18)

- Bounded the complete Qdrant client initialization by one configured timeout and
  added a cooldown after failure. Concurrent waiters now share the failed probe
  and promptly reach PostgreSQL fallback instead of repeating serialized timeouts.
  Regression tests cover concurrent failure, recovery, and client cleanup.
- Corrected the analytics helper annotations identified by a fresh mypy run;
  mypy now passes all 90 checked source files. The earlier mypy failure count
  above is historical. Alembic-at-head, coverage, benchmark, and soak acceptance
  have not been certified by this publishing check.
- Updated snapshot commands to resolve the service container through Compose.
- Fresh scoped backend run: 698 passed, 29 skipped, 449 deselected. Its selector
  was `not static and not slow and not perf and not system and not real_llm`.
  This is a regression result, not a claim that every readiness stage passed.
- See [the change review](../../CHANGE_REVIEW_2026-10-18.md) for the frontend,
  build, publishing hygiene, and remaining live-provider limitations.

# Qdrant Retrieval Integration Design

**Date:** 2026-10-17

## Intent

Use Qdrant for nearest-neighbor candidate search in KODMOD's retrieval-augmented tutoring flow while preserving PostgreSQL as the authoritative store for curriculum text, embeddings, publication state, enrollment checks, and material revisions. This enables an independently scalable vector index without weakening student access checks or making existing pgvector data unavailable.

## Current state

- This section records the design-time state on 2026-10-17. The implementation and current operational state are summarized below.
- At design time, retrieval was still pgvector-only and the existing Qdrant adapter was not wired into either entry point.
- PostgreSQL's query joins class materials, classrooms, and enrollments, and checks publication plus indexed content/mapping versions before returning a class chunk.
- The local Compose service had an optional `qdrant` profile; its Windows bind-mounted storage still required live durability verification before rollout.

## Goals

1. Route both LangGraph retrieval and `RAGTool` through Qdrant when `VECTOR_BACKEND=qdrant`.
2. Keep PostgreSQL as the source of truth and revalidate every Qdrant point ID through the existing PostgreSQL permission and freshness query before returning content.
3. Store vectors and only the metadata needed for Qdrant filtering. Do not store chunk text, source provenance, or accessibility metadata in Qdrant.
4. Keep global ingestion, class-material indexing, and deletion/reindex operations synchronized with Qdrant on a best-effort basis; retain pgvector search as a transparent fallback.
5. Provide an idempotent backfill command that copies existing vectors from `curriculum_chunks` without calling the embedding provider.
6. Keep the local Docker Centre Qdrant service on the F: drive and make the backend selectable with `VECTOR_BACKEND`.

## Non-goals

- Removing PostgreSQL/pgvector, moving application text or authorization data out of PostgreSQL, or adding an Alembic migration.
- Changing embeddings, chunking, reranking, chat APIs, or student-facing response formats.
- Connecting to Qdrant Cloud or publishing the Qdrant REST/gRPC ports to the host; services communicate over the private Compose network only.
- Automatically deleting the existing Qdrant storage directory or its collections during rollout or reindex.

## Chosen design

### Retrieval contract

`VECTOR_BACKEND` remains `pgvector` by default. When set to `qdrant`, the async Qdrant adapter filters by retrieval scope and returns candidate point IDs. The adapter passes those IDs and the original query filters to `pgvector_store.query()`. PostgreSQL remains responsible for loading text and metadata and for enforcing:

- a valid student and class pair for class-scoped retrieval;
- current enrollment and an active classroom;
- published material with `rag_status="ready"`;
- matching content and concept-mapping revisions.

If Qdrant is unavailable, returns no usable points, or yields fewer validated results than requested, the adapter falls back to the existing full pgvector query. Qdrant failure must not make already indexed PostgreSQL content unavailable.

### Collection and payload

- Collection: `kodmod_curriculum_v2`.
- Vector size: `settings.EMBEDDING_DIM` (currently 1536).
- Distance: cosine.
- Point ID: the UUID of the corresponding `CurriculumChunk` row.
- Allowlisted payload fields: scope, class/material IDs, concept/subject IDs, language, and indexed content/mapping versions where available.
- No text, source path, imported-document provenance, or accessibility metadata is stored in Qdrant.

The new collection name isolates this schema from any legacy `kodmod_curriculum` collection. The backfill is an upsert from PostgreSQL; it does not delete the prior collection or reset the Qdrant storage directory.

### Index lifecycle

- Global `upsert_chunks()` first commits rows to PostgreSQL, then best-effort upserts the same IDs/vectors and allowlisted payload to Qdrant.
- Class material indexing commits the canonical rows and then best-effort replaces points for that material. PostgreSQL's current revision checks make any stale Qdrant points unusable; failed Qdrant sync is logged and retrieval falls back to pgvector.
- PostgreSQL delete operations capture affected row IDs and best-effort delete the matching Qdrant points after the database transaction succeeds.
- `python -m scripts.reindex_qdrant` reads all current PostgreSQL chunks in batches and upserts them. Re-running it is safe and does not re-embed material.

### Runtime and operations

- Use `AsyncQdrantClient` so network requests do not block FastAPI's event loop; close it with the API lifecycle.
- Pin the Docker Centre server image to Qdrant `v1.19.2` and the Python client floor to `qdrant-client>=1.19.1,<2.0`.
- Keep the Qdrant service in its existing optional Compose profile. The Docker startup wrapper activates that profile when its selected `VECTOR_BACKEND` is `qdrant`.
- Set the current Docker Centre's backend to Qdrant for this rollout; other/local environments keep the `pgvector` default unless explicitly configured.
- Do not publish Qdrant host ports; services communicate over the Compose network at `http://qdrant:6333`.

### Rollback and data safety

Set `VECTOR_BACKEND=pgvector` and rerun the normal Docker startup command to return retrieval to PostgreSQL. PostgreSQL remains complete throughout; no migration or data conversion is needed. Keep the Qdrant named volume and the old F: bind directory in place for diagnosis or a later re-enable. Never use `down -v` or delete either data location as part of rollout or rollback.

## Success criteria

- Both retrieval entry points honor `VECTOR_BACKEND`.
- A Qdrant result cannot return text until PostgreSQL validates its ID and authorization scope.
- Current global and class-material vectors can be backfilled and newly indexed without re-embedding.
- Missing Qdrant data or an unavailable Qdrant service falls back to the existing pgvector query.
- The local KODMOD stack can start Qdrant from its F: Docker Centre path without stopping the separate Timgravid stack.

## Operational follow-up (2026-10-18)

- The active storage is the Compose named volume `kodmod-centre_kodmod-qdrantdata`, formatted as ext4 in Docker Desktop WSL2. Docker Desktop's WSL2 data directory is currently on `F:\Docker_Centre\wsl\DockerDesktopWSL`, so the Qdrant data remains on F: without using a Windows bind mount for its WAL.
- The previous `F:\Docker_Centre\kodmod\data\qdrant` bind directory remains intact and is not mounted by the active container. Its filesystem appeared as `9p`; Qdrant warned that durability could not be guaranteed.
- Qdrant `v1.19.2` is healthy on the private Compose network. REST `6333` and gRPC `6334` are not published to Windows. The active `kodmod_curriculum_v2` collection was reindexed from PostgreSQL and verified `green` with 30 points.
- A 897,024-byte snapshot from the ext4-backed collection restored successfully to a unique temporary collection after SHA-256 verification. The collection reported `green` with 30 points; the temporary collection and copied container file were removed after verification. Its verified SHA-256 is `b16d1ed0f635ec7a0125be8f50e8afde3f57899b5bcb146ea0f73d653dc76b36`; the artifact and `.sha256` manifest are in `F:\Docker_Centre\kodmod\backups\qdrant`.
- A 580,416,000-byte snapshot captured from the old `9p` storage failed restore because `0/wal/first-index` contained 16 zero bytes. It remains in the backup folder for audit only and must not be used for recovery. PostgreSQL is canonical, so normal recovery is to switch to pgvector and reindex.
- Detailed operator commands and recovery safeguards are in [`docs/QDRANT_OPERATIONS.md`](../../QDRANT_OPERATIONS.md).

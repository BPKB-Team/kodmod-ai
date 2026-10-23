"""Unit coverage for the Qdrant candidate-store boundary."""

import asyncio
import uuid
from types import SimpleNamespace

import pytest

from rag.stores import qdrant_store

pytestmark = pytest.mark.unit


def test_qdrant_payload_excludes_canonical_text_and_source() -> None:
    payload = qdrant_store._payload(
        {
            "scope": "class",
            "vector_hash": "vector-digest",
            "class_id": "11111111-1111-1111-1111-111111111111",
            "material_id": "22222222-2222-2222-2222-222222222222",
            "material_version": 3,
            "material_mapping_version": 2,
            "concept_id": "33333333-3333-3333-3333-333333333333",
            "subject_id": "44444444-4444-4444-4444-444444444444",
            "language": "id",
            "text": "private lesson content",
            "source": "private/source.pdf",
            "accessibility_metadata": {"private": True},
        }
    )

    assert payload == {
        "scope": "class",
        "vector_hash": "vector-digest",
        "class_id": "11111111-1111-1111-1111-111111111111",
        "material_id": "22222222-2222-2222-2222-222222222222",
        "material_version": 3,
        "material_mapping_version": 2,
        "concept_id": "33333333-3333-3333-3333-333333333333",
        "subject_id": "44444444-4444-4444-4444-444444444444",
        "language": "id",
    }


async def test_query_hydrates_candidates_from_postgres(monkeypatch) -> None:
    from rag.stores import pgvector_store

    point_id = uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
    digest = "current-vector-digest"
    observed: dict = {}

    class FakeQdrantClient:
        async def query_points(self, **kwargs):
            observed["qdrant"] = kwargs
            return SimpleNamespace(
                points=[SimpleNamespace(id=str(point_id), payload={"vector_hash": digest})]
            )

    async def fake_client():
        return FakeQdrantClient()

    async def postgres_query(embedding, **kwargs):
        observed["postgres"] = kwargs
        return [{"id": point_id, "text": "canonical PostgreSQL content", "_vector_hash": digest}]

    monkeypatch.setattr(qdrant_store, "_client", fake_client)
    monkeypatch.setattr(pgvector_store, "query", postgres_query)

    results = await qdrant_store.query(
        [0.25] * 8,
        top_k=1,
        student_id=uuid.UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
        class_id=uuid.UUID("cccccccc-cccc-cccc-cccc-cccccccccccc"),
    )

    assert results == [{"id": point_id, "text": "canonical PostgreSQL content"}]
    assert observed["qdrant"]["with_payload"] == ["vector_hash"]
    assert observed["qdrant"]["with_vectors"] is False
    assert observed["postgres"]["candidate_ids"] == [point_id]
    assert observed["postgres"]["include_vector_hash"] is True


async def test_query_falls_back_to_postgres_when_qdrant_is_unavailable(monkeypatch) -> None:
    from rag.stores import pgvector_store

    calls = []
    canonical = [
        {"id": uuid.UUID("dddddddd-dddd-dddd-dddd-dddddddddddd"), "text": "from PostgreSQL"}
    ]

    async def failed_client():
        raise TimeoutError("Qdrant is offline")

    async def postgres_query(embedding, **kwargs):
        calls.append(kwargs)
        return canonical

    monkeypatch.setattr(qdrant_store, "_client", failed_client)
    monkeypatch.setattr(pgvector_store, "query", postgres_query)

    results = await qdrant_store.query([0.5] * 8, top_k=2)

    assert results == canonical
    assert len(calls) == 1
    assert "candidate_ids" not in calls[0]


async def test_query_falls_back_when_qdrant_vector_hash_is_stale(monkeypatch) -> None:
    from rag.stores import pgvector_store

    point_id = uuid.UUID("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee")
    calls = []

    class FakeQdrantClient:
        async def query_points(self, **kwargs):
            return SimpleNamespace(
                points=[SimpleNamespace(id=str(point_id), payload={"vector_hash": "old-digest"})]
            )

    async def fake_client():
        return FakeQdrantClient()

    async def postgres_query(embedding, **kwargs):
        calls.append(kwargs)
        result = {"id": point_id, "text": "fresh PostgreSQL content"}
        if kwargs.get("include_vector_hash"):
            result["_vector_hash"] = "new-digest"
        return [result]

    monkeypatch.setattr(qdrant_store, "_client", fake_client)
    monkeypatch.setattr(pgvector_store, "query", postgres_query)

    results = await qdrant_store.query([0.75] * 8, top_k=1)

    assert results == [{"id": point_id, "text": "fresh PostgreSQL content"}]
    assert len(calls) == 2
    assert calls[0]["candidate_ids"] == [point_id]
    assert "candidate_ids" not in calls[1]


async def test_query_rejects_class_scope_without_student_identity(monkeypatch) -> None:
    async def unexpected_client():
        raise AssertionError("Qdrant must not be queried without student identity")

    monkeypatch.setattr(qdrant_store, "_client", unexpected_client)

    results = await qdrant_store.query(
        [0.1] * 8,
        class_id=uuid.UUID("ffffffff-ffff-ffff-ffff-ffffffffffff"),
    )

    assert results == []


async def test_failed_initialization_is_shared_by_waiters_and_can_recover(monkeypatch) -> None:
    import qdrant_client

    probes = 0
    clients = []

    class FakeClient:
        def __init__(self, **kwargs):
            self.closed = False
            clients.append(self)

        async def close(self):
            self.closed = True

    async def unavailable(client):
        nonlocal probes
        probes += 1
        await asyncio.sleep(0.01)
        raise TimeoutError("offline")

    monkeypatch.setattr(qdrant_client, "AsyncQdrantClient", FakeClient)
    monkeypatch.setattr(qdrant_store, "_client_instance", None)
    monkeypatch.setattr(qdrant_store, "_client_lock", asyncio.Lock())
    monkeypatch.setattr(qdrant_store, "_client_retry_at", 0.0, raising=False)
    monkeypatch.setattr(qdrant_store, "ensure_collection", unavailable)

    results = await asyncio.gather(
        *(qdrant_store._client() for _ in range(10)), return_exceptions=True
    )

    assert all(isinstance(result, (TimeoutError, ConnectionError)) for result in results)
    assert probes == 1, "waiting callers must not repeat the failing network probe serially"
    assert len(clients) == 1 and clients[0].closed

    async def recovered(client):
        return None

    monkeypatch.setattr(qdrant_store, "_client_retry_at", 0.0)
    monkeypatch.setattr(qdrant_store, "ensure_collection", recovered)
    client = await qdrant_store._client()
    assert client is clients[1]
    assert await qdrant_store._client() is client
    await qdrant_store.close_client()
    assert client.closed
    assert qdrant_store._client_retry_at == 0.0


async def test_initialization_has_one_overall_timeout_and_closes_failed_client(monkeypatch) -> None:
    import qdrant_client

    closed = []

    class FakeClient:
        def __init__(self, **kwargs):
            pass

        async def close(self):
            closed.append(True)

    async def stalled(client):
        await asyncio.Event().wait()

    monkeypatch.setattr(qdrant_client, "AsyncQdrantClient", FakeClient)
    monkeypatch.setattr(qdrant_store, "_client_instance", None)
    monkeypatch.setattr(qdrant_store, "_client_lock", asyncio.Lock())
    monkeypatch.setattr(qdrant_store, "_client_retry_at", 0.0, raising=False)
    monkeypatch.setattr(qdrant_store.settings, "QDRANT_TIMEOUT_SECONDS", 0.01)
    monkeypatch.setattr(qdrant_store, "ensure_collection", stalled)

    with pytest.raises(TimeoutError):
        await asyncio.wait_for(qdrant_store._client(), timeout=0.2)
    assert closed == [True], "the initialization deadline must close its incomplete client"
    assert qdrant_store._client_instance is None


async def test_client_uses_configured_private_ca(monkeypatch) -> None:
    import qdrant_client

    context = object()
    captured = {}
    ca_options = {}

    class FakeClient:
        def __init__(self, **kwargs):
            captured.update(kwargs)

        async def close(self):
            pass

    async def ready(client):
        return None

    monkeypatch.setattr(qdrant_client, "AsyncQdrantClient", FakeClient)

    def create_context(**kwargs):
        ca_options.update(kwargs)
        return context

    monkeypatch.setattr(qdrant_store.ssl, "create_default_context", create_context)
    monkeypatch.setattr(qdrant_store.settings, "QDRANT_CA_CERT_FILE", "/etc/ssl/certs/qdrant-ca.crt")
    monkeypatch.setattr(qdrant_store, "_client_instance", None)
    monkeypatch.setattr(qdrant_store, "_client_lock", asyncio.Lock())
    monkeypatch.setattr(qdrant_store, "_client_retry_at", 0.0, raising=False)
    monkeypatch.setattr(qdrant_store, "ensure_collection", ready)

    client = await qdrant_store._client()

    assert ca_options == {"cafile": "/etc/ssl/certs/qdrant-ca.crt"}
    assert captured["verify"] is context
    assert captured["check_compatibility"] is False
    assert await qdrant_store._client() is client
    await qdrant_store.close_client()

"""Opt-in real PDF import on a disposable schema in the dedicated test database.

KODMOD_MATERIAL_TEST_DIR selects user-supplied PDFs. Embeddings are simulated;
PostgreSQL, pgvector, PDF extraction and the application routes are real.
"""

import io
import json
import os
import uuid
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI
from pypdf import PdfReader
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.schema import CreateSchema, DropSchema

from api import durable_jobs, material_service, material_worker
from api.dependencies import current_user, db_session
from api.routes import classrooms
from config.settings import settings
from database.models import BackgroundJob, Base, CurriculumChunk, User
from rag import ingestion
from rag.stores import pgvector_store
from scripts.local_database import is_local_database_url

pytestmark = [pytest.mark.integration, pytest.mark.db, pytest.mark.asyncio(loop_scope="function")]


async def test_supplied_pdfs_preview_publish_read_and_scoped_retrieval(monkeypatch, tmp_path):
    directory = os.getenv("KODMOD_MATERIAL_TEST_DIR")
    if not directory:
        pytest.skip("set KODMOD_MATERIAL_TEST_DIR to validate the four supplied PDFs")
    folder = Path(directory).resolve(strict=True)
    paths = sorted(folder.glob("*.pdf"))
    assert len(paths) == 4, "this acceptance batch expects the four supplied materials"
    # Dedicated test database, never the application/demo database. The URL can
    # be overridden for isolated CI stacks; this test creates and drops only a
    # random schema inside the selected database.
    url = os.getenv(
        "KODMOD_MATERIAL_TEST_DATABASE_URL",
        "postgresql+asyncpg://kodmod:kodmod@127.0.0.1:5434/kodmod_test",
    )
    assert is_local_database_url(url), "supplied-PDF integration must use a local test database"
    schema = "material_validation_" + uuid.uuid4().hex
    admin_engine = create_async_engine(url)
    engine = create_async_engine(
        url,
        connect_args={"server_settings": {"search_path": schema + ",public"}},
        execution_options={"schema_translate_map": {None: schema}},
    )
    factory = async_sessionmaker(engine, expire_on_commit=False)
    dimension = CurriculumChunk.__table__.c.embedding.type.dim
    vector = [1.0] + [0.0] * (dimension - 1)

    async def embed(texts):
        return [list(vector) for _ in texts]

    monkeypatch.setattr(ingestion, "_embed_batch", embed)
    monkeypatch.setattr(material_service, "async_session", factory)
    monkeypatch.setattr(durable_jobs, "async_session", factory)
    monkeypatch.setattr(material_worker, "async_session", factory)
    monkeypatch.setattr(material_worker, "HEARTBEAT_PATH", tmp_path / "worker-heartbeat")
    monkeypatch.setattr(settings, "UPLOAD_DIR", tmp_path / "uploads")
    monkeypatch.setattr(pgvector_store, "async_session", factory)
    from database import session as database_session

    monkeypatch.setattr(database_session, "async_session", factory)
    actor, users, report = {}, {}, []
    app = FastAPI()
    app.include_router(classrooms.router, prefix="/classes")

    async def user():
        return users[actor["name"]]

    async def transaction():
        async with factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[current_user] = user
    app.dependency_overrides[db_session] = transaction

    async def process_queued_job(kind, target_id):
        job = await durable_jobs.claim()
        assert job is not None
        assert job.kind == kind and str(job.target_id) == target_id
        await material_worker.run_job(job)
        async with factory() as session:
            stored = await session.get(BackgroundJob, job.id)
            assert stored.state == "complete", stored.error_message

    async def completed_preview(client, class_id, response):
        assert response.status_code == 202, response.text
        pending = response.json()
        assert pending["state"] == "pending" and pending["preview"] is None
        await process_queued_job("material_import", pending["import_id"])
        read = await client.get(f"/classes/{class_id}/imports/{pending['import_id']}")
        assert read.status_code == 200, read.text
        completed = read.json()
        assert completed["state"] == "complete" and completed["preview"] is not None
        return completed

    created = False
    try:
        async with admin_engine.begin() as connection:
            await connection.execute(CreateSchema(schema))
            created = True
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with factory() as session:
            for name, role in [
                ("owner", "teacher"),
                ("other", "teacher"),
                ("student", "student"),
                ("outsider", "student"),
            ]:
                users[name] = User(
                    username="material-test-" + name,
                    role=role,
                    full_name="Pengujian materi",
                    password_hash="unused-test-only",
                    is_active=True,
                )
                session.add(users[name])
            await session.commit()
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://material-test", timeout=90
        ) as client:
            for path in paths:
                actor["name"] = "owner"
                response = await client.post(
                    "/classes", json={"name": "Uji " + path.stem[:100], "subject": path.stem[:100]}
                )
                assert response.status_code == 201, response.text
                cid = response.json()["id"]
                assert (
                    await client.post(
                        f"/classes/{cid}/members", json={"username": users["student"].username}
                    )
                ).status_code == 201
                endpoint = f"/classes/{cid}/materials/import"
                raw = path.read_bytes()
                page_count = len(PdfReader(io.BytesIO(raw)).pages)
                first_page, last_page = {
                    "nasa-space-math-solar-system-i.pdf": (2, 3),
                    "nist-periodic-table-2024.pdf": (1, 2),
                    "poster_ss_back_a.pdf": (1, 1),
                    "usgs-natural-water-chemistry-section2.pdf": (5, 7),
                }[path.name]
                assert last_page <= page_count
                response = await client.post(
                    endpoint,
                    data={"first_page": str(first_page), "last_page": str(last_page)},
                    files={"file": (path.name, raw, "application/pdf")},
                )
                imported = await completed_preview(client, cid, response)
                preview = imported["preview"]
                chapters = preview["sections"]
                selection = preview["page_range"]
                assert selection == {"first": first_page, "last": last_page}
                assert 1 <= len(preview["content"]) <= 100000
                blocks = preview["document"]["blocks"]
                expected_pages = set(range(first_page, last_page + 1))
                assert blocks
                assert all(block["provenance"]["page"] in expected_pages for block in blocks)
                if path.name == "nasa-space-math-solar-system-i.pdf":
                    assert "Answer Key" not in preview["content"]
                assert not (await client.get(f"/classes/{cid}")).json()["materials"], (
                    "preview must not save or publish"
                )
                payload = {
                    "title": chapters[0]["title"] if chapters else path.stem,
                    "content": preview["content"],
                    "published": False,
                    "source_filename": f"{path.name} · Halaman {selection['first']}–{selection['last']}",
                    "source_import_id": imported["import_id"],
                }
                response = await client.post(f"/classes/{cid}/materials", json=payload)
                assert response.status_code == 201, response.text
                mid = response.json()["id"]
                actor["name"] = "student"
                assert (await client.get(f"/classes/{cid}/materials/{mid}")).status_code == 404
                assert (
                    await client.post(endpoint, files={"file": (path.name, raw)})
                ).status_code == 403
                actor["name"] = "other"
                assert (
                    await client.post(endpoint, files={"file": (path.name, raw)})
                ).status_code == 404
                actor["name"] = "owner"
                response = await client.put(
                    f"/classes/{cid}/materials/{mid}", json=payload | {"published": True}
                )
                assert response.status_code == 200, response.text
                assert response.json()["rag_status"] == "pending"
                await process_queued_job("material_index", mid)
                actor["name"] = "student"
                response = await client.get(f"/classes/{cid}/materials/{mid}")
                assert response.status_code == 200, response.text
                material = response.json()
                assert material["rag_status"] == "ready" and material["n_chunks"] > 0
                # MaterialWrite deliberately strips only outer whitespace; the
                # extracted body must otherwise survive draft/publish/index/read.
                assert material["content"] == payload["content"].strip()
                async with factory() as session:
                    context = await material_service.resolve_tutoring_context(
                        session, uuid.UUID(cid), uuid.UUID(mid), users["student"]
                    )
                    chunks = (
                        await session.scalars(
                            select(CurriculumChunk).where(
                                CurriculumChunk.material_id == uuid.UUID(mid)
                            )
                        )
                    ).all()
                    assert all(
                        chunk.material_version == material["content_version"] for chunk in chunks
                    )
                assert context["material_id"] == mid
                docs = await pgvector_store.query(
                    vector,
                    class_id=uuid.UUID(cid),
                    material_id=uuid.UUID(mid),
                    student_id=users["student"].id,
                )
                assert docs and all(str(doc["material_id"]) == mid for doc in docs)
                assert not await pgvector_store.query(
                    vector,
                    class_id=uuid.UUID(cid),
                    material_id=uuid.UUID(mid),
                    student_id=users["outsider"].id,
                )
                actor["name"] = "outsider"
                assert (await client.get(f"/classes/{cid}/materials/{mid}")).status_code == 404
                report.append(
                    {
                        "filename": path.name,
                        "total_pages": preview["total_pages"],
                        "suggested_chapters": len(chapters),
                        "selected_pages": selection,
                        "characters": len(payload["content"]),
                        "blocks": len(blocks),
                        "review_required_blocks": sum(
                            block["review_state"] == "needs_review" for block in blocks
                        ),
                        "extraction_methods": sorted(
                            {block["provenance"]["method"] for block in blocks}
                        ),
                        "chunks": material["n_chunks"],
                        "rag_status": material["rag_status"],
                        "flow": "queued-import-worker-preview-draft-publish-worker-index-read-retrieve",
                        "provider": "simulated",
                    }
                )
                print(json.dumps(report[-1], ensure_ascii=True), flush=True)
            actor["name"] = "student"
            assert len((await client.get("/classes/student/materials")).json()) == 4
        output = os.getenv("KODMOD_MATERIAL_TEST_REPORT")
        if output:
            Path(output).write_text(
                json.dumps(
                    {
                        "schema": schema,
                        "database_port": 5434,
                        "materials": report,
                        "provider": "simulated",
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
    finally:
        await engine.dispose()
        if created:
            async with admin_engine.begin() as connection:
                await connection.execute(DropSchema(schema, cascade=True))
        await admin_engine.dispose()

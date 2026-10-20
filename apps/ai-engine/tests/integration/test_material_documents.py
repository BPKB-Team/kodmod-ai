"""Real PostgreSQL checks for document revisions and private asset publication."""

import os
import uuid
from io import BytesIO

import pytest
from fastapi import BackgroundTasks, HTTPException, UploadFile
from PIL import Image
from sqlalchemy import select

from api.material_assets import authorized_asset, store_material_asset
from api.routes import admin_materials, classrooms
from database.models import ClassMaterial, MaterialRevision
from tests.unit.test_guided_learning import learning_http as learning_http


@pytest.fixture
async def retrieval_qdrant(backend, monkeypatch):
    from rag.stores import qdrant_store

    if backend != "qdrant":
        yield None
        return
    if not os.getenv("KODMOD_QDRANT_TEST_URL"):
        pytest.skip("requires a disposable Qdrant test service")
    collection = f"retrieval_test_{uuid.uuid4().hex}"
    monkeypatch.setattr(qdrant_store.settings, "QDRANT_URL", os.environ["KODMOD_QDRANT_TEST_URL"])
    monkeypatch.setattr(qdrant_store.settings, "QDRANT_COLLECTION", collection)
    monkeypatch.setattr(qdrant_store, "_client_instance", None)
    monkeypatch.setattr(qdrant_store, "_client_retry_at", 0.0)
    yield qdrant_store
    client = qdrant_store._client_instance
    if client is not None:
        try:
            await client.delete_collection(collection_name=collection)
        finally:
            await qdrant_store.close_client()


async def test_document_projection_revision_and_conflict_are_shared(learning_http):
    _, factory, controls, material, _, admin = learning_http
    body = classrooms.MaterialWrite(
        title=material.title,
        document={
            "schema_version": 1,
            "blocks": [
                {
                    "id": "power",
                    "type": "paragraph",
                    "inlines": [{"text": "a"}, {"text": "p+q", "marks": ["superscript"]}],
                }
            ],
        },
        expected_version=1,
        published=True,
    )
    async with factory() as session:
        row = await session.get(ClassMaterial, material.id)
        original = row.content
        await admin_materials.update_material(
            material.id, body, BackgroundTasks(), actor=admin, session=session
        )
    async with factory() as session:
        row = await session.get(ClassMaterial, material.id)
        assert row.content == "a^{p+q}" and row.document["blocks"][0]["id"] == "power"
        assert row.content_version == 2 and row.rag_status == "pending"
        revision = await session.scalar(
            select(MaterialRevision).where(MaterialRevision.material_id == row.id)
        )
        assert revision.content == original and revision.document is None
        with pytest.raises(HTTPException) as conflict:
            await admin_materials.update_material(
                row.id, body, BackgroundTasks(), actor=admin, session=session
            )
        assert conflict.value.status_code == 409
        assert row.content_version == 2


async def test_admin_original_is_attachment_by_default_and_inline_pdf_only_for_preview(
    learning_http, monkeypatch, tmp_path
):
    from io import BytesIO

    from fastapi import UploadFile

    from api.material_artifacts import create_import
    from config.settings import settings
    from database.models import Classroom
    from tests.unit.test_pdf_layout import make_pdf

    client, factory, controls, material, _, admin = learning_http
    monkeypatch.setattr(settings, "UPLOAD_DIR", tmp_path)
    async with factory() as session:
        classroom = await session.get(Classroom, material.class_id)
        imported = await create_import(
            session,
            classroom,
            admin,
            UploadFile(
                filename="source.pdf",
                file=BytesIO(make_pdf(lambda page: page.drawString(40, 700, "Materi sumber"))),
            ),
        )
        row = await session.get(ClassMaterial, material.id)
        row.source_import_id = uuid.UUID(imported["import_id"])
        await session.commit()

    url = f"/admin/materials/{material.id}/original"
    assert (await client.get(url)).status_code == 403
    controls["actor"] = admin
    download = await client.get(url)
    assert download.status_code == 200
    assert download.headers["content-type"] == "application/octet-stream"
    assert download.headers["content-disposition"].startswith("attachment")
    inline = await client.get(url + "?preview=true")
    assert inline.status_code == 200
    assert inline.headers["content-type"] == "application/pdf"
    assert inline.headers["content-disposition"].startswith("inline")


async def test_assets_pending_draft_cross_class_and_student_access(
    learning_http, monkeypatch, tmp_path
):
    from config.settings import settings

    monkeypatch.setattr(settings, "UPLOAD_DIR", tmp_path)
    _, factory, controls, material, outsider, admin = learning_http
    source = BytesIO()
    Image.new("RGB", (20, 20), "red").save(source, format="PNG")
    source.seek(0)
    async with factory() as session:
        output = await store_material_asset(
            session, admin, material.class_id, UploadFile(filename="photo.png", file=source)
        )
        assert "storage_key" not in output
        aid = uuid.UUID(output["id"])
        with pytest.raises(HTTPException):
            await authorized_asset(session, controls["actor"], material.class_id, aid)
        with pytest.raises(HTTPException):
            await authorized_asset(session, admin, uuid.uuid4(), aid)
        row = await session.get(ClassMaterial, material.id)
        row.document = {
            "schema_version": 1,
            "blocks": [
                {"id": "image", "type": "image", "asset_id": str(aid), "alt": "Urutan orbit"}
            ],
        }
        row.published = False
        await session.commit()
        with pytest.raises(HTTPException):
            await authorized_asset(session, controls["actor"], material.class_id, aid)
        row.published = True
        await session.commit()
        assert (
            await authorized_asset(session, controls["actor"], material.class_id, aid)
        ).id == aid
        with pytest.raises(HTTPException):
            await authorized_asset(session, outsider, material.class_id, aid)
        row.published = False
        await session.commit()
        with pytest.raises(HTTPException):
            await authorized_asset(session, controls["actor"], material.class_id, aid)


async def test_mixed_import_worker_retry_reuses_private_asset_and_paid_region(
    learning_http, monkeypatch, tmp_path
):
    import json
    from types import SimpleNamespace

    from reportlab.lib.utils import ImageReader
    from sqlalchemy import func

    from api import durable_jobs, material_worker, pdf_regions
    from api.material_artifacts import create_import
    from config.settings import settings
    from database.models import Classroom, MaterialAsset
    from tests.unit.test_pdf_layout import make_pdf
    from tools import material_vision_tool

    _, factory, _, material, _, admin = learning_http
    monkeypatch.setattr(settings, "UPLOAD_DIR", tmp_path)
    monkeypatch.setattr(settings, "MATERIAL_VISION_ENABLED", True)
    monkeypatch.setattr(settings, "LLM_MATERIAL_VISION_MODEL", "fixture-vision")
    monkeypatch.setattr(durable_jobs, "async_session", factory)
    monkeypatch.setattr(material_worker, "async_session", factory)
    monkeypatch.setattr(
        pdf_regions, "recognize_region", lambda *a, **k: pdf_regions.RegionExtraction()
    )
    calls = []

    class Model:
        async def ainvoke(self, *a):
            calls.append(1)
            return SimpleNamespace(content=json.dumps({"text": "Tabel planet dan periode orbit"}))

    monkeypatch.setattr(material_vision_tool, "get_material_vision_llm", lambda: Model())
    im = Image.new("RGB", (100, 100), "white")

    def draw(c):
        c.drawString(50, 700, "Teks native di samping gambar")
        c.drawImage(ImageReader(im), 50, 400, width=200, height=150)

    async with factory() as session:
        classroom = await session.get(Classroom, material.class_id)
        await create_import(
            session,
            classroom,
            admin,
            UploadFile(filename="mixed.pdf", file=BytesIO(make_pdf(draw))),
        )
    job = await durable_jobs.claim()
    first = await material_worker.process(job)
    second = await material_worker.process(job)
    assert first == second and len(calls) == 1
    assert any(
        b["provenance"]["method"] == "vision" and b["review_state"] == "needs_review"
        for b in first["document"]["blocks"]
    )
    async with factory() as session:
        assert await session.scalar(select(func.count()).select_from(MaterialAsset)) == 1


async def test_metadata_remains_readable_but_cannot_start_learning_or_quiz(learning_http):
    client, factory, _, material, _, _ = learning_http
    async with factory() as session:
        row = await session.get(ClassMaterial, material.id)
        row.content = "<!-- demo note -->\n\n# Dasar-Dasar Tata Surya"
        await session.commit()
    read = await client.get(f"/classes/{material.class_id}/materials/{material.id}")
    assert read.status_code == 200 and read.json()["learning_progress"]["total_units"] == 0
    assert read.json()["ai_readiness"] == "insufficient_learning_content"
    source = {"class_id": str(material.class_id), "material_id": str(material.id)}
    lesson = await client.post("/learning/start", json=source)
    assert (
        lesson.status_code == 409
        and lesson.json()["detail"]["code"] == "insufficient_learning_content"
    )
    quiz = await client.post("/quiz/start", json={**source, "n_questions": 1})
    assert (
        quiz.status_code == 409 and quiz.json()["detail"]["code"] == "insufficient_learning_content"
    )


@pytest.mark.skipif(
    os.getenv("KODMOD_GUIDED_POSTGRES") != "1" or os.getenv("KODMOD_RETRIEVAL_POSTGRES") != "1",
    reason="requires the isolated PostgreSQL + pgvector retrieval fixture",
)
@pytest.mark.parametrize(
    "backend",
    [
        pytest.param("pgvector", id="pgvector"),
        pytest.param(
            "qdrant",
            id="qdrant",
            marks=pytest.mark.skipif(
                not os.getenv("KODMOD_QDRANT_TEST_URL"),
                reason="requires a disposable Qdrant test service",
            ),
        ),
    ],
)
async def test_class_concept_retrieval_enforces_current_authorization_and_preserves_provenance(
    learning_http, monkeypatch, backend, retrieval_qdrant
):
    from config.settings import settings
    from database.models import (
        ClassMaterial,
        Classroom,
        Concept,
        CurriculumChunk,
        Enrollment,
        MaterialConcept,
        Subject,
    )
    from rag import retrieval_service
    from rag.source_bundle import MaterialScope
    from rag.stores import pgvector_store, qdrant_store

    _, factory, controls, material, _, admin = learning_http
    student = controls["actor"]
    concept_id = uuid.uuid4()
    subject_id = uuid.uuid4()
    other_material_id = uuid.uuid4()
    approved_chunk_id = uuid.uuid4()
    unmapped_chunk_id = uuid.uuid4()
    async with factory() as session:
        classroom = await session.get(Classroom, material.class_id)
        session.add(Subject(id=subject_id, name=f"Retrieval {uuid.uuid4()}", created_by=admin.id))
        await session.flush()
        session.add(
            Concept(
                id=concept_id,
                subject_id=subject_id,
                name="Pecahan senilai",
                slug=f"pecahan-senilai-{uuid.uuid4().hex}",
            )
        )
        await session.flush()
        classroom.subject_id = subject_id
        row = await session.get(ClassMaterial, material.id)
        row.mapping_version = 1
        row.indexed_mapping_version = 1
        session.add(
            MaterialConcept(
                material_id=material.id,
                mapping_version=1,
                content_version=1,
                concept_id=concept_id,
                is_primary=True,
                approved_by=admin.id,
            )
        )
        unmapped = ClassMaterial(
            id=other_material_id,
            class_id=material.class_id,
            title="Materi lain tanpa pemetaan",
            content="Pecahan dalam materi yang tidak disetujui untuk konsep ini.",
            published=True,
            rag_status="ready",
            content_version=1,
            indexed_version=1,
            mapping_version=0,
            indexed_mapping_version=0,
            n_chunks=1,
        )
        session.add(unmapped)
        session.add_all(
            [
                CurriculumChunk(
                    id=approved_chunk_id,
                    material_id=material.id,
                    material_version=1,
                    material_mapping_version=1,
                    content=(
                        "Pecahan senilai memiliki nilai sama jika pembilang dan "
                        "penyebut dikalikan dengan bilangan yang sama."
                    ),
                    embedding=[0.1] * settings.EMBEDDING_DIM,
                    source="pecahan.pdf",
                    language="id",
                    chunk_index=0,
                    accessibility_metadata={
                        "block_ids": ["paragraph-7"],
                        "spans": [{"block_id": "paragraph-7", "page": 11}],
                        "document_hash": "a" * 64,
                        "approved_concept_ids": [str(concept_id)],
                    },
                ),
                CurriculumChunk(
                    id=unmapped_chunk_id,
                    material_id=other_material_id,
                    material_version=1,
                    material_mapping_version=0,
                    content="Pecahan konteks lain yang belum disetujui.",
                    embedding=[0.1] * settings.EMBEDDING_DIM,
                    source="lain.pdf",
                    language="id",
                    chunk_index=0,
                    accessibility_metadata={"block_ids": ["unmapped-block"]},
                ),
            ]
        )
        await session.commit()

    async def embed(_texts):
        return [[0.1] * settings.EMBEDDING_DIM]

    monkeypatch.setattr(retrieval_service, "embed_text", embed)
    monkeypatch.setattr(retrieval_service.settings, "VECTOR_BACKEND", backend)
    monkeypatch.setattr(pgvector_store, "async_session", factory)
    if backend == "qdrant":
        assert retrieval_qdrant is qdrant_store
        canonical = await pgvector_store.query(
            [0.1] * settings.EMBEDDING_DIM,
            top_k=1,
            concept_id=concept_id,
            subject_id=subject_id,
            student_id=student.id,
            class_id=material.class_id,
            include_vector_hash=True,
        )
        assert len(canonical) == 1 and canonical[0]["id"] == str(approved_chunk_id)
        await qdrant_store.upsert_points(
            [
                {
                    "id": str(approved_chunk_id),
                    "embedding": [0.1] * settings.EMBEDDING_DIM,
                    "scope": "class",
                    "class_id": str(material.class_id),
                    "material_id": str(material.id),
                    "material_version": 1,
                    "material_mapping_version": 1,
                    "vector_hash": canonical[0]["_vector_hash"],
                }
            ]
        )
    request = retrieval_service.RetrievalRequest(
        query="Jelaskan pecahan senilai",
        scope=MaterialScope(
            student_id=student.id,
            class_id=material.class_id,
            concept_id=concept_id,
            subject_id=subject_id,
        ),
        candidate_k=20,
        final_k=6,
        use_reranker=False,
    )

    result = await retrieval_service.retrieve_sources(request)
    assert [doc["material_id"] for doc in result.documents] == [str(material.id)]
    source = result.bundle.sources[0]
    assert source.block_ids == ("paragraph-7",)
    assert source.spans[0]["page"] == 11
    assert source.document_hash == "a" * 64
    assert source.content_version == 1 and source.mapping_version == 1

    async with factory() as session:
        await session.delete(await session.get(Enrollment, (material.class_id, student.id)))
        await session.commit()
    assert not (await retrieval_service.retrieve_sources(request)).bundle.sources

    async with factory() as session:
        session.add(Enrollment(class_id=material.class_id, student_id=student.id))
        row = await session.get(ClassMaterial, material.id)
        row.published = False
        await session.commit()
    assert not (await retrieval_service.retrieve_sources(request)).bundle.sources

    async with factory() as session:
        row = await session.get(ClassMaterial, material.id)
        row.published = True
        row.content_version = 2
        row.indexed_version = 2
        await session.commit()
    assert not (await retrieval_service.retrieve_sources(request)).bundle.sources

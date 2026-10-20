"""Real PostgreSQL checks for document revisions and private asset publication."""

import uuid
from io import BytesIO
from pathlib import Path

import pytest
from fastapi import BackgroundTasks, HTTPException, UploadFile
from PIL import Image
from sqlalchemy import select

from api.material_assets import authorized_asset, store_material_asset
from api.routes import admin_materials, classrooms
from database.models import ClassMaterial, MaterialRevision
from tests.unit.test_guided_learning import learning_http as learning_http


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
        imported = await create_import(
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

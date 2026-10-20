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

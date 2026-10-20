import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from database import models
from tests.unit.test_guided_learning import action_body, open_lesson
from tests.unit.test_guided_learning import learning_http as learning_http


async def test_finish_records_all_canonical_units_once_without_mastery(learning_http):
    client, factory, _, material, _, _ = learning_http
    state = await open_lesson(client, material)
    path = f"/learning/sessions/{state['session_id']}/actions"
    while "continue" in state["available_actions"]:
        response = await client.post(path, json=action_body(state, "continue"))
        assert response.status_code == 200, response.text
        state = response.json()
    body = action_body(state, "finish")
    finished = await client.post(path, json=body)
    assert finished.status_code == 200, finished.text
    assert finished.json()["learning_progress"]["status"] == "completed"
    assert (await client.post(path, json=body)).json() == finished.json()
    async with factory() as db:
        row = await db.scalar(select(models.MaterialLearningProgress))
        assert len(row.completed_unit_ids) == state["total_units"]
        assert row.status == "completed" and row.completed_at
        assert await db.scalar(select(func.count()).select_from(models.MasteryEvent)) == 0
    materials = (await client.get("/classes/student/materials")).json()
    assert materials[0]["learning_progress"]["status"] == "completed"
    reading = await client.patch(
        f"/classes/{material.class_id}/materials/{material.id}/progress", json={"completed": False}
    )
    assert reading.status_code == 200, reading.text
    assert (await client.get("/classes/student/materials")).json()[0]["learning_progress"][
        "status"
    ] == "completed"
    async with factory() as db:
        changed = await db.get(models.ClassMaterial, material.id)
        changed.content_version += 1
        await db.commit()
    assert (await client.get("/classes/student/materials")).json()[0]["learning_progress"][
        "status"
    ] == "not_started"
    async with factory() as db:
        assert (await db.scalar(select(models.MaterialLearningProgress))).status == "completed"


async def test_repeat_and_reading_do_not_complete_tutor(learning_http):
    client, factory, _, material, _, _ = learning_http
    state = await open_lesson(client, material)
    response = await client.post(
        f"/learning/sessions/{state['session_id']}/actions", json=action_body(state, "repeat")
    )
    assert response.status_code == 200, response.text
    assert response.json()["learning_progress"]["completed_units"] == 0


async def test_subset_finish_and_manifest_changes_cannot_claim_full_completion(learning_http):
    from api.learning_progress import build_unit_manifest, record_learning_unit
    from api.learning_service import learning_units

    client, factory, controls, material, _, _ = learning_http
    manifest = build_unit_manifest(material, learning_units(material.content))
    async with factory() as db:
        with pytest.raises(HTTPException) as error:
            await record_learning_unit(
                db,
                student_id=controls["actor"].id,
                material=material,
                manifest=manifest,
                completed_unit_id=manifest.units[-1].unit_id,
                finish=True,
            )
        assert error.value.status_code == 409
        await db.rollback()
    changed = build_unit_manifest(
        material, learning_units(material.content), partitioner_version="future"
    )
    assert changed.unit_manifest_hash != manifest.unit_manifest_hash
    assert {u.unit_id for u in changed.units}.isdisjoint(u.unit_id for u in manifest.units)

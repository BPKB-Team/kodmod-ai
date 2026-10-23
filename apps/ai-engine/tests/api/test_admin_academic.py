"""
Tests for Admin Academic Management (Classrooms & Subjects) and Cascade Deletion.
"""

import uuid
import pytest
from sqlalchemy import select

from database.models import Classroom, Concept, Enrollment, Subject
from database.session import async_session

pytestmark = [pytest.mark.api, pytest.mark.asyncio(loop_scope="session")]


async def test_admin_classes_crud_and_cascade_delete(
    client, admin_factory, teacher_factory, student_factory, subject_factory
):
    _, admin_token = await admin_factory()
    teacher, _ = await teacher_factory()
    student, _ = await student_factory()
    subject = await subject_factory(name=f"Mapel-{uuid.uuid4().hex[:6]}")

    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    # 1. Create class via admin
    create_res = await client.post(
        "/admin/classes",
        headers=admin_headers,
        json={
            "name": "Kelas 10 RPL A",
            "subject_id": str(subject.id),
            "teacher_id": str(teacher.id),
            "description": "Kelas pemrograman dasar",
        },
    )
    assert create_res.status_code == 201, create_res.text
    class_data = create_res.json()
    class_id = class_data["id"]
    assert class_data["name"] == "Kelas 10 RPL A"
    assert class_data["teacher_name"] == teacher.full_name

    # Add an enrollment to verify child deletion
    async with async_session() as s:
        enrollment = Enrollment(class_id=uuid.UUID(class_id), student_id=student.id)
        s.add(enrollment)
        await s.commit()

    # 2. List classes via admin
    list_res = await client.get("/admin/classes?q=Kelas+10+RPL", headers=admin_headers)
    assert list_res.status_code == 200
    classes = list_res.json()
    assert any(c["id"] == class_id for c in classes)
    target = next(c for c in classes if c["id"] == class_id)
    assert target["member_count"] == 1

    # 3. Update class via admin
    patch_res = await client.patch(
        f"/admin/classes/{class_id}",
        headers=admin_headers,
        json={"name": "Kelas 10 RPL Unggulan", "is_archived": True},
    )
    assert patch_res.status_code == 200
    assert patch_res.json()["name"] == "Kelas 10 RPL Unggulan"
    assert patch_res.json()["is_archived"] is True

    # 4. Delete class via admin (Full cascade)
    del_res = await client.delete(f"/admin/classes/{class_id}", headers=admin_headers)
    assert del_res.status_code == 204

    async with async_session() as s:
        stored_class = await s.get(Classroom, uuid.UUID(class_id))
        assert stored_class is None
        stored_enrollment = await s.get(Enrollment, (uuid.UUID(class_id), student.id))
        assert stored_enrollment is None


async def test_admin_subjects_crud_and_cascade_delete(
    client, admin_factory, teacher_factory, subject_factory
):
    _, admin_token = await admin_factory()
    teacher, _ = await teacher_factory()
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    unique_suffix = uuid.uuid4().hex[:6]
    subj_name = f"Biologi Molekuler {unique_suffix}"

    # 1. Create subject via admin
    create_res = await client.post(
        "/admin/subjects",
        headers=admin_headers,
        json={"name": subj_name, "description": "Studi genetika dan molekuler"},
    )
    assert create_res.status_code == 201, create_res.text
    subject_id = create_res.json()["id"]

    # Create a classroom and a concept under this subject to test deep cascade
    async with async_session() as s:
        room = Classroom(
            name=f"Kelas Bio {unique_suffix}",
            subject=subj_name,
            subject_id=uuid.UUID(subject_id),
            teacher_id=teacher.id,
        )
        s.add(room)
        concept = Concept(
            subject_id=uuid.UUID(subject_id),
            name="DNA dan RNA",
            slug=f"dna-rna-{unique_suffix}",
            description="Konsep dasar replikasi DNA",
        )
        s.add(concept)
        await s.commit()
        room_id = room.id
        concept_id = concept.id

    # 2. List subjects via admin
    list_res = await client.get(f"/admin/subjects?q={unique_suffix}", headers=admin_headers)
    assert list_res.status_code == 200
    subjects = list_res.json()
    assert len(subjects) >= 1
    found = next(s for s in subjects if s["id"] == subject_id)
    assert found["class_count"] == 1
    assert found["concept_count"] == 1

    # 3. Update subject
    patch_res = await client.patch(
        f"/admin/subjects/{subject_id}",
        headers=admin_headers,
        json={"name": f"Biologi Modern {unique_suffix}"},
    )
    assert patch_res.status_code == 200
    assert patch_res.json()["name"] == f"Biologi Modern {unique_suffix}"

    # Verify classroom subject name was updated
    async with async_session() as s:
        updated_room = await s.get(Classroom, room_id)
        assert updated_room.subject == f"Biologi Modern {unique_suffix}"

    # 4. Delete subject via admin (Full cascade: subject + classrooms + concepts)
    del_res = await client.delete(f"/admin/subjects/{subject_id}", headers=admin_headers)
    assert del_res.status_code == 204

    async with async_session() as s:
        assert await s.get(Subject, uuid.UUID(subject_id)) is None
        assert await s.get(Classroom, room_id) is None
        assert await s.get(Concept, concept_id) is None

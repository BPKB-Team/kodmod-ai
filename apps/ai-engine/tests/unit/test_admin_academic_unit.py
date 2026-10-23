"""
KM-UNIT: Admin Academic Management and Cascade Deletion.
"""

from __future__ import annotations

import uuid

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from api.dependencies import db_session, require_admin
from api.routes import admin
from database.models import (
    AssignmentAnswer,
    AssignmentAttempt,
    AssignmentMasteryEvent,
    AuditEvent,
    Base,
    ClassActivity,
    ClassMaterial,
    Classroom,
    Concept,
    Document,
    Enrollment,
    InvitationCode,
    LearningSession,
    MaterialAsset,
    MaterialConcept,
    MaterialImport,
    QuizAssignment,
    QuizDraft,
    QuizDraftQuestion,
    QuizDraftVersion,
    QuizQuestion,
    QuizReviewEvent,
    QuizSession,
    Subject,
    User,
)

pytestmark = pytest.mark.unit


@pytest_asyncio.fixture
async def academic_workspace():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.execute(text("PRAGMA foreign_keys=ON"))
        await connection.run_sync(
            lambda sync: Base.metadata.create_all(
                sync,
                tables=[
                    model.__table__
                    for model in (
                        User,
                        Subject,
                        Classroom,
                        Concept,
                        Document,
                        Enrollment,
                        ClassMaterial,
                        MaterialAsset,
                        MaterialImport,
                        MaterialConcept,
                        ClassActivity,
                        QuizDraft,
                        QuizDraftVersion,
                        QuizDraftQuestion,
                        QuizReviewEvent,
                        QuizAssignment,
                        AssignmentAttempt,
                        AssignmentAnswer,
                        AssignmentMasteryEvent,
                        QuizSession,
                        QuizQuestion,
                        LearningSession,
                        AuditEvent,
                        InvitationCode,
                    )
                ],
            )
        )
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    admin_user = User(
        id=uuid.uuid4(),
        username="admin1",
        full_name="Admin Test",
        password_hash="fakehash",
        role="admin",
        is_active=True,
    )
    teacher_user = User(
        id=uuid.uuid4(),
        username="teacher1",
        full_name="Guru Fisika",
        password_hash="fakehash",
        role="teacher",
        is_active=True,
    )
    student_user = User(
        id=uuid.uuid4(),
        username="student1",
        full_name="Siswa Pintar",
        password_hash="fakehash",
        role="student",
        is_active=True,
    )

    async with sessions() as session:
        session.add_all([admin_user, teacher_user, student_user])
        await session.commit()

    async def override_admin():
        return admin_user

    async def override_db():
        async with sessions() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app = FastAPI()
    app.include_router(admin.router, prefix="/admin")
    app.dependency_overrides[require_admin] = override_admin
    app.dependency_overrides[db_session] = override_db

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield {
            "client": client,
            "sessions": sessions,
            "admin": admin_user,
            "teacher": teacher_user,
            "student": student_user,
        }

    await engine.dispose()


@pytest.mark.asyncio
async def test_admin_class_crud_and_cascade(academic_workspace):
    client = academic_workspace["client"]
    sessions = academic_workspace["sessions"]
    teacher = academic_workspace["teacher"]
    student = academic_workspace["student"]

    # 1. Create subject
    subj_res = await client.post(
        "/admin/subjects",
        json={"name": "Fisika Dasar", "description": "Mekanika dan Kinematika"},
    )
    assert subj_res.status_code == 201
    subject_id = subj_res.json()["id"]

    # 2. Create class
    class_res = await client.post(
        "/admin/classes",
        json={
            "name": "Fisika 10-A",
            "subject_id": subject_id,
            "teacher_id": str(teacher.id),
            "description": "Kelas fisika semester 1",
        },
    )
    assert class_res.status_code == 201, class_res.text
    class_id = class_res.json()["id"]
    assert class_res.json()["name"] == "Fisika 10-A"

    # Add child items: Enrollment, ClassMaterial, QuizDraftVersion, QuizAssignment, Attempt
    async with sessions() as s:
        s.add(Enrollment(class_id=uuid.UUID(class_id), student_id=student.id))
        s.add(
            ClassMaterial(
                class_id=uuid.UUID(class_id),
                title="Hukum Newton",
                content="Hukum 1, 2, 3 Newton",
                published=True,
            )
        )
        draft = QuizDraft(
            id=uuid.uuid4(),
            teacher_id=teacher.id,
            subject_id=uuid.UUID(subject_id),
            title="Draf Kuis",
        )
        s.add(draft)
        await s.flush()
        ver = QuizDraftVersion(
            id=uuid.uuid4(),
            draft_id=draft.id,
            version=1,
            subject_id=uuid.UUID(subject_id),
            title="Versi 1",
        )
        s.add(ver)
        await s.flush()
        assignment = QuizAssignment(
            id=uuid.uuid4(),
            version_id=ver.id,
            class_id=uuid.UUID(class_id),
            teacher_id=teacher.id,
        )
        s.add(assignment)
        await s.flush()
        attempt = AssignmentAttempt(
            id=uuid.uuid4(),
            assignment_id=assignment.id,
            student_id=student.id,
            total_questions=1,
        )
        s.add(attempt)
        await s.commit()

    # 3. List classes
    list_res = await client.get("/admin/classes?q=Fisika")
    assert list_res.status_code == 200
    classes = list_res.json()
    assert len(classes) == 1
    assert classes[0]["member_count"] == 1
    assert classes[0]["material_count"] == 1
    assert classes[0]["assignment_count"] == 1

    # 4. Update class
    update_res = await client.patch(
        f"/admin/classes/{class_id}",
        json={"name": "Fisika 10 Unggulan", "is_archived": True},
    )
    assert update_res.status_code == 200
    assert update_res.json()["name"] == "Fisika 10 Unggulan"
    assert update_res.json()["is_archived"] is True

    # 5. Delete class with complete cascade
    del_res = await client.delete(f"/admin/classes/{class_id}")
    assert del_res.status_code == 204

    async with sessions() as s:
        assert await s.get(Classroom, uuid.UUID(class_id)) is None
        assert await s.get(Enrollment, (uuid.UUID(class_id), student.id)) is None
        materials = (
            await s.execute(
                select(ClassMaterial).where(ClassMaterial.class_id == uuid.UUID(class_id))
            )
        ).all()
        assert len(materials) == 0
        assignments = (
            await s.execute(
                select(QuizAssignment).where(QuizAssignment.class_id == uuid.UUID(class_id))
            )
        ).all()
        assert len(assignments) == 0


@pytest.mark.asyncio
async def test_admin_subject_cascade_delete(academic_workspace):
    client = academic_workspace["client"]
    sessions = academic_workspace["sessions"]
    teacher = academic_workspace["teacher"]

    # 1. Create subject
    subj_res = await client.post(
        "/admin/subjects",
        json={"name": "Kimia Organik", "description": "Senyawa karbon"},
    )
    assert subj_res.status_code == 201
    subject_id = subj_res.json()["id"]

    # 2. Create classroom and concept under this subject
    class_res = await client.post(
        "/admin/classes",
        json={
            "name": "Kimia 11-IPA",
            "subject_id": subject_id,
            "teacher_id": str(teacher.id),
        },
    )
    assert class_res.status_code == 201
    class_id = class_res.json()["id"]

    async with sessions() as s:
        concept = Concept(
            id=uuid.uuid4(),
            subject_id=uuid.UUID(subject_id),
            name="Alkana Alkena Alkuna",
            slug="alkana-alkena",
        )
        s.add(concept)
        doc = Document(
            id=uuid.uuid4(),
            subject_id=uuid.UUID(subject_id),
            filename="kurikulum-kimia.pdf",
            stored_path="test-doc.pdf",
        )
        s.add(doc)
        await s.commit()
        concept_id = concept.id
        doc_id = doc.id

    # 3. List subjects
    subj_list = await client.get("/admin/subjects?q=Kimia")
    assert subj_list.status_code == 200
    assert len(subj_list.json()) == 1
    assert subj_list.json()[0]["class_count"] == 1
    assert subj_list.json()[0]["concept_count"] == 1

    # 4. Delete subject with total cascade
    del_res = await client.delete(f"/admin/subjects/{subject_id}")
    assert del_res.status_code == 204

    # Verify subject, classroom, concept, and document are all gone
    async with sessions() as s:
        assert await s.get(Subject, uuid.UUID(subject_id)) is None
        assert await s.get(Classroom, uuid.UUID(class_id)) is None
        assert await s.get(Concept, concept_id) is None
        assert await s.get(Document, doc_id) is None

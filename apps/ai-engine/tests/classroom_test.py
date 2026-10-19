"""Isolated route tests. Run python -m unittest tests.classroom_test -v.

Uses an in-memory SQLite database only; never connects to the application DB.
"""

import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi import FastAPI
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from api.dependencies import current_user, db_session
from api.routes import classrooms
from database.models import (
    BackgroundJob,
    Base,
    ClassActivity,
    ClassMaterial,
    Classroom,
    Enrollment,
    MaterialImport,
    MaterialProgress,
    Subject,
    User,
)


class ClassroomRoutesTest(unittest.IsolatedAsyncioTestCase):
    async def test_student_library_progress_is_private_and_reversible(self):
        cid = await self.create_class()
        for name in ("student", "outsider"):
            await self.client.post(f"/classes/{cid}/members", json={"username": name})
        mid = (
            await self.client.post(
                f"/classes/{cid}/materials",
                json={"title": "Pecahan", "content": "Materi pecahan", "published": True},
            )
        ).json()["id"]
        await self.client.post(
            f"/classes/{cid}/materials", json={"title": "Rahasia draft", "content": "Draft"}
        )
        self.actor = self.student
        response = await self.client.get("/classes/student/materials")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 1)
        path = f"/classes/{cid}/materials/{mid}/progress"
        response = await self.client.patch(path, json={"completed": True, "bookmarked": True})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["completed"])
        self.assertIsNotNone(response.json()["completed_at"])
        self.assertTrue(
            (await self.client.get("/classes/student/materials")).json()[0]["progress"][
                "bookmarked"
            ]
        )
        self.actor = self.outsider
        self.assertFalse(
            (await self.client.get("/classes/student/materials")).json()[0]["progress"]["completed"]
        )
        self.actor = self.student
        response = await self.client.patch(path, json={"completed": False})
        self.assertFalse(response.json()["completed"])
        self.assertIsNone(response.json()["completed_at"])
        self.assertTrue(response.json()["bookmarked"])

    async def test_progress_cannot_escape_material_access(self):
        cid = await self.create_class()
        mid = (
            await self.client.post(
                f"/classes/{cid}/materials", json={"title": "Draft", "content": "Isi"}
            )
        ).json()["id"]
        path = f"/classes/{cid}/materials/{mid}/progress"
        self.assertEqual((await self.client.patch(path, json={"completed": True})).status_code, 403)
        await self.client.post(f"/classes/{cid}/members", json={"username": "student"})
        self.actor = self.student
        self.assertEqual((await self.client.patch(path, json={"completed": True})).status_code, 404)
        self.actor = self.teacher
        await self.client.put(
            f"/classes/{cid}/materials/{mid}",
            json={"title": "Terbit", "content": "Isi", "published": True},
        )
        self.actor = self.student
        self.assertEqual(
            (
                await self.client.patch(
                    path, json={"completed": True, "student_id": str(self.outsider.id)}
                )
            ).status_code,
            422,
        )
        self.assertEqual(
            (await self.client.patch(path, json={"bookmarked": True})).status_code, 200
        )
        self.actor = self.teacher
        await self.client.delete(f"/classes/{cid}/members/{self.student.id}")
        self.actor = self.student
        self.assertEqual((await self.client.get("/classes/student/materials")).json(), [])
        self.assertEqual((await self.client.patch(path, json={"completed": True})).status_code, 404)

    async def asyncSetUp(self):
        from config.settings import settings

        self.upload_dir = tempfile.TemporaryDirectory(prefix="kodmod-test-imports-")
        self.addCleanup(self.upload_dir.cleanup)
        self.upload_patch = patch.object(settings, "UPLOAD_DIR", Path(self.upload_dir.name))
        self.upload_patch.start()
        self.addCleanup(self.upload_patch.stop)
        # Published material indexing calls an external embedding provider. Route
        # authorization/progress tests stay offline; the job has separate tests.
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with self.engine.begin() as conn:
            await conn.execute(text("PRAGMA foreign_keys=ON"))
            await conn.run_sync(
                lambda c: Base.metadata.create_all(
                    c,
                    tables=[
                        User.__table__,
                        Subject.__table__,
                        Classroom.__table__,
                        Enrollment.__table__,
                        BackgroundJob.__table__,
                        MaterialImport.__table__,
                        ClassMaterial.__table__,
                        ClassActivity.__table__,
                        MaterialProgress.__table__,
                        Base.metadata.tables["material_learning_progress"],
                        Base.metadata.tables["learning_plans"],
                        Base.metadata.tables["learning_plan_steps"],
                    ],
                )
            )
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)
        self.teacher = User(
            id=uuid.uuid4(),
            username="teacher",
            full_name="Guru Satu",
            role="teacher",
            is_active=True,
            password_hash="unused",
        )
        self.other_teacher = User(
            id=uuid.uuid4(),
            username="other",
            full_name="Guru Dua",
            role="teacher",
            is_active=True,
            password_hash="unused",
        )
        self.student = User(
            id=uuid.uuid4(),
            username="student",
            full_name="Siswa Satu",
            role="student",
            is_active=True,
            password_hash="unused",
        )
        self.outsider = User(
            id=uuid.uuid4(),
            username="outsider",
            full_name="Siswa Dua",
            role="student",
            is_active=True,
            password_hash="unused",
        )
        async with self.sessions() as s:
            s.add_all([self.teacher, self.other_teacher, self.student, self.outsider])
            await s.commit()
        app = FastAPI()
        app.include_router(classrooms.router, prefix="/classes")
        self.actor = self.teacher

        async def actor():
            return self.actor

        async def database():
            async with self.sessions() as s:
                try:
                    yield s
                    await s.commit()
                except Exception:
                    await s.rollback()
                    raise

        app.dependency_overrides[current_user] = actor
        app.dependency_overrides[db_session] = database
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        )

    async def asyncTearDown(self):
        await self.client.aclose()
        await self.engine.dispose()

    async def create_class(self):
        response = await self.client.post(
            "/classes",
            json={
                "name": "Matematika VII",
                "subject": "Matematika",
                "description": "Belajar bersama",
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["id"]

    async def test_member_candidate_search_does_not_expand_wildcard_only_queries(self):
        cid = await self.create_class()

        for query in ("%%", "__"):
            response = await self.client.get(
                f"/classes/{cid}/member-candidates", params={"q": query}
            )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), [])

    async def test_member_candidates_and_batch_enrollment_are_class_scoped(self):
        cid = await self.create_class()
        candidates = await self.client.get(
            f"/classes/{cid}/member-candidates", params={"q": "Siswa"}
        )
        self.assertEqual(candidates.status_code, 200, candidates.text)
        self.assertEqual(
            {row["id"] for row in candidates.json()},
            {str(self.student.id), str(self.outsider.id)},
        )

        added = await self.client.post(
            f"/classes/{cid}/members/batch",
            json={"student_ids": [str(self.student.id), str(self.outsider.id)]},
        )
        self.assertEqual(added.status_code, 201, added.text)
        self.assertEqual(added.json(), {"added": 2})

        duplicate = await self.client.post(
            f"/classes/{cid}/members/batch",
            json={"student_ids": [str(self.student.id)]},
        )
        self.assertEqual(duplicate.status_code, 409)

        self.actor = self.other_teacher
        self.assertEqual(
            (
                await self.client.get(f"/classes/{cid}/member-candidates", params={"q": "Siswa"})
            ).status_code,
            404,
        )

    async def test_learning_material_only_visible_to_enrolled_student(self):
        cid = await self.create_class()
        added = await self.client.post(f"/classes/{cid}/members", json={"username": "student"})
        self.assertEqual(added.status_code, 201)
        material = await self.client.post(
            f"/classes/{cid}/materials",
            json={
                "title": "Pecahan",
                "content": "Satu per dua sama dengan dua per empat.",
                "published": True,
            },
        )
        self.assertEqual(material.status_code, 201)
        mid = material.json()["id"]
        self.actor = self.student
        self.assertEqual(len((await self.client.get("/classes")).json()), 1)
        self.assertIn(
            "Satu per dua",
            (await self.client.get(f"/classes/{cid}/materials/{mid}")).json()["content"],
        )
        self.actor = self.outsider
        self.assertEqual((await self.client.get("/classes")).json(), [])
        self.assertEqual((await self.client.get(f"/classes/{cid}")).status_code, 404)
        self.assertEqual(
            (await self.client.get(f"/classes/{cid}/materials/{mid}")).status_code, 404
        )

    async def test_teacher_ownership_and_student_write_denied(self):
        cid = await self.create_class()
        self.actor = self.other_teacher
        self.assertEqual((await self.client.get(f"/classes/{cid}")).status_code, 404)
        self.assertEqual(
            (
                await self.client.post(f"/classes/{cid}/members", json={"username": "student"})
            ).status_code,
            404,
        )
        self.actor = self.student
        self.assertEqual(
            (await self.client.post("/classes", json={"name": "x", "subject": "y"})).status_code,
            403,
        )

    async def test_drafts_removal_archive_and_audit(self):
        cid = await self.create_class()
        await self.client.post(f"/classes/{cid}/members", json={"username": "student"})
        duplicate = await self.client.post(f"/classes/{cid}/members", json={"username": "student"})
        self.assertEqual(duplicate.status_code, 409)
        draft = await self.client.post(
            f"/classes/{cid}/materials",
            json={"title": "Draft", "content": "Belum terbit", "published": False},
        )
        mid = draft.json()["id"]
        self.actor = self.student
        self.assertEqual((await self.client.get(f"/classes/{cid}")).json()["materials"], [])
        self.assertEqual(
            (await self.client.get(f"/classes/{cid}/materials/{mid}")).status_code, 404
        )
        self.actor = self.teacher
        await self.client.delete(f"/classes/{cid}/members/{self.student.id}")
        self.actor = self.student
        self.assertEqual((await self.client.get(f"/classes/{cid}")).status_code, 404)
        self.actor = self.teacher
        response = await self.client.patch(f"/classes/{cid}", json={"is_archived": True})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            (
                await self.client.post(
                    f"/classes/{cid}/materials", json={"title": "x", "content": "y"}
                )
            ).status_code,
            409,
        )
        async with self.sessions() as s:
            self.assertGreaterEqual(
                len((await s.execute(select(ClassActivity))).scalars().all()), 5
            )

    async def test_invalid_and_wrong_role_members(self):
        self.assertEqual(
            (
                await self.client.post("/classes", json={"name": "  ", "subject": "Math"})
            ).status_code,
            422,
        )

        cid = await self.create_class()
        self.assertEqual(
            (
                await self.client.post(f"/classes/{cid}/members", json={"username": "other"})
            ).status_code,
            404,
        )
        self.assertEqual(
            (
                await self.client.post(
                    f"/classes/{cid}/materials", json={"title": "Empty", "content": "  "}
                )
            ).status_code,
            422,
        )

    async def test_publish_unpublish_restore_and_cross_class_material(self):
        cid = await self.create_class()
        other = await self.create_class()
        await self.client.post(f"/classes/{cid}/members", json={"username": "student"})
        draft = await self.client.post(
            f"/classes/{cid}/materials", json={"title": "Draft", "content": "Isi"}
        )
        mid = draft.json()["id"]
        body = {"title": "Materi terbaru", "content": "Isi terbaru", "published": True}
        self.assertEqual(
            (await self.client.put(f"/classes/{other}/materials/{mid}", json=body)).status_code,
            404,
        )
        self.assertEqual(
            (await self.client.get(f"/classes/{other}/materials/{mid}")).status_code, 404
        )
        self.assertEqual(
            (await self.client.put(f"/classes/{cid}/materials/{mid}", json=body)).status_code,
            200,
        )
        self.actor = self.student
        detail = (await self.client.get(f"/classes/{cid}")).json()
        self.assertEqual(detail["material_count"], 1)
        self.assertEqual(detail["members"], [])
        self.assertEqual(
            (await self.client.get(f"/classes/{cid}/materials/{mid}")).json()["content"],
            "Isi terbaru",
        )
        self.assertEqual(
            (await self.client.put(f"/classes/{cid}/materials/{mid}", json=body)).status_code,
            403,
        )
        self.actor = self.teacher
        await self.client.patch(f"/classes/{cid}", json={"is_archived": True})
        self.actor = self.student
        self.assertEqual((await self.client.get("/classes")).json(), [])
        self.assertEqual(
            (await self.client.get(f"/classes/{cid}/materials/{mid}")).status_code, 404
        )
        self.actor = self.teacher
        await self.client.patch(f"/classes/{cid}", json={"is_archived": False})
        self.actor = self.student
        self.assertEqual(len((await self.client.get("/classes")).json()), 1)
        self.actor = self.teacher
        await self.client.put(f"/classes/{cid}/materials/{mid}", json={**body, "published": False})
        self.actor = self.student
        self.assertEqual((await self.client.get(f"/classes/{cid}")).json()["material_count"], 0)
        self.assertEqual(
            (await self.client.get(f"/classes/{cid}/materials/{mid}")).status_code, 404
        )

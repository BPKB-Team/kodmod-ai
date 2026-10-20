"""Material import and scoped tutoring checks against isolated SQLite only."""

import io
import uuid
import zipfile
from contextlib import asynccontextmanager
from unittest.mock import patch

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.compiler import compiles, deregister
from sqlalchemy.sql.elements import BinaryExpression

from database.models import Base, ClassMaterial, Concept, CurriculumChunk, Document, Subject
from tests import classroom_test

pytestmark = pytest.mark.unit


class MaterialImportTest(classroom_test.ClassroomRoutesTest):
    def test_pdf_cleanup_preserves_subtraction_sign_and_dehyphenates_wrapped_words(self):
        from api.material_imports import tidy_pdf_text

        self.assertEqual(
            tidy_pdf_text("Kurangkan nilai x -\ny dari kedua sisi persamaan."),
            "Kurangkan nilai x - y dari kedua sisi persamaan.",
        )
        self.assertEqual(
            tidy_pdf_text("Gunakan istilah inter-\nnasional dalam contoh ini."),
            "Gunakan istilah internasional dalam contoh ini.",
        )

    async def completed_preview(self, cid, response):
        from api import durable_jobs, material_worker

        self.assertEqual(response.status_code, 202, response.text)
        iid = response.json()["import_id"]
        with (
            patch.object(durable_jobs, "async_session", self.sessions),
            patch.object(material_worker, "async_session", self.sessions),
        ):
            job = await durable_jobs.claim()
            self.assertIsNotNone(job)
            await material_worker.run_job(job)
        result = (await self.client.get(f"/classes/{cid}/imports/{iid}")).json()
        return result

    async def test_pdf_text_can_be_reviewed_and_scan_only_pdf_is_rejected(self):
        from pypdf import PdfWriter
        from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

        cid = await self.create_class()
        writer = PdfWriter()
        page = writer.add_blank_page(width=300, height=300)
        font = DictionaryObject(
            {
                NameObject("/Type"): NameObject("/Font"),
                NameObject("/Subtype"): NameObject("/Type1"),
                NameObject("/BaseFont"): NameObject("/Helvetica"),
            }
        )
        page[NameObject("/Resources")] = DictionaryObject(
            {NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})}
        )
        stream = DecodedStreamObject()
        stream.set_data(b"BT /F1 12 Tf 20 200 Td (Pecahan senilai) Tj ET")
        page[NameObject("/Contents")] = writer._add_object(stream)
        data = io.BytesIO()
        writer.write(data)
        response = await self.client.post(
            f"/classes/{cid}/materials/import", files={"file": ("buku.pdf", data.getvalue())}
        )
        preview = await self.completed_preview(cid, response)
        self.assertIn("Pecahan senilai", preview["preview"]["content"])
        scan = PdfWriter()
        scan.add_blank_page(width=300, height=300)
        data = io.BytesIO()
        scan.write(data)
        response = await self.client.post(
            f"/classes/{cid}/materials/import", files={"file": ("scan.pdf", data.getvalue())}
        )
        from api import pdf_ocr

        with patch.object(
            pdf_ocr,
            "recognize_page",
            return_value={"text": "Teks scan sudah dibaca", "confidence": 91},
        ):
            preview = await self.completed_preview(cid, response)
        self.assertEqual(preview["state"], "complete")
        self.assertEqual(preview["preview"]["pages"][0]["method"], "ocr")

    async def test_import_rejects_oversize_and_xml_entities(self):
        from config.settings import settings

        cid = await self.create_class()
        with patch.object(settings, "MAX_UPLOAD_MB", 0):
            response = await self.client.post(
                f"/classes/{cid}/materials/import", files={"file": ("large.txt", b"a")}
            )
        self.assertEqual(response.status_code, 413)
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as archive:
            archive.writestr(
                "word/document.xml",
                '<!DOCTYPE x [<!ENTITY bad "expanded">]><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p>&bad;</w:p></w:body></w:document>',
            )
        response = await self.client.post(
            f"/classes/{cid}/materials/import", files={"file": ("unsafe.docx", data.getvalue())}
        )
        preview = await self.completed_preview(cid, response)
        self.assertEqual(preview["state"], "retry")

    async def test_retrieval_enforces_enrollment_publication_and_revision(self):
        from rag.stores import pgvector_store

        cid = uuid.UUID(await self.create_class())
        await self.client.post(f"/classes/{cid}/members", json={"username": "student"})
        async with self.engine.begin() as conn:
            await conn.run_sync(
                lambda c: Base.metadata.create_all(
                    c,
                    tables=[
                        Subject.__table__,
                        Concept.__table__,
                        Document.__table__,
                        CurriculumChunk.__table__,
                    ],
                )
            )
        async with self.sessions() as session:
            good = ClassMaterial(
                class_id=cid,
                title="Buku pecahan",
                content="Jawaban kelas",
                published=True,
                rag_status="ready",
                content_version=1,
                indexed_version=1,
                n_chunks=1,
            )
            draft = ClassMaterial(
                class_id=cid,
                title="Draft",
                content="Rahasia",
                published=False,
                rag_status="ready",
                indexed_version=1,
                n_chunks=1,
            )
            stale = ClassMaterial(
                class_id=cid,
                title="Berubah",
                content="Versi baru",
                published=True,
                rag_status="ready",
                content_version=2,
                indexed_version=1,
                n_chunks=1,
            )
            session.add_all([good, draft, stale])
            await session.flush()
            from config.settings import settings

            vector = [0.1] * settings.EMBEDDING_DIM
            for material in (good, draft, stale):
                session.add(
                    CurriculumChunk(
                        material_id=material.id,
                        material_version=1,
                        content=material.content,
                        embedding=vector,
                        source="C:/private/uploads/source.pdf",
                        language="id",
                    )
                )
            session.add(
                CurriculumChunk(
                    content="Kurikulum umum",
                    embedding=vector,
                    source="C:/private/shared.md",
                    language="id",
                )
            )
            await session.commit()
            good_id = good.id

        @asynccontextmanager
        async def isolated_session():
            async with self.sessions() as session:
                yield session

        # SQLite has no pgvector operator. Only the distance expression is
        # substituted; every real SQL permission join/filter still executes.
        @compiles(BinaryExpression, "sqlite")
        def offline_distance(element, compiler, **kwargs):
            if getattr(element.operator, "opstring", None) == "<=>":
                return "0.0"
            return compiler.visit_binary(element, **kwargs)

        try:
            with patch.object(pgvector_store, "async_session", isolated_session):
                try:
                    docs = await pgvector_store.query(
                        vector, class_id=cid, student_id=self.student.id
                    )
                except TypeError:
                    self.fail("Scoped material retrieval is not implemented")
                self.assertEqual([doc["text"] for doc in docs], ["Jawaban kelas"])
                self.assertEqual(docs[0]["material_id"], str(good_id))
                self.assertNotIn("private", docs[0]["source"])
                self.assertEqual(
                    await pgvector_store.query(vector, class_id=cid, student_id=self.outsider.id),
                    [],
                )
                self.assertEqual(await pgvector_store.query(vector, class_id=cid), [])
                general = await pgvector_store.query(vector)
                self.assertEqual([doc["text"] for doc in general], ["Kurikulum umum"])
                self.assertEqual(general[0]["source"], "shared.md")
                async with self.sessions() as session:
                    from database.models import Classroom

                    classroom = await session.get(Classroom, cid)
                    classroom.is_archived = True
                    await session.commit()
                self.assertEqual(
                    await pgvector_store.query(vector, class_id=cid, student_id=self.student.id), []
                )
        finally:
            deregister(BinaryExpression)

    async def test_indexing_writes_current_chunks_and_discards_an_old_job(self):
        try:
            from api import material_service
        except ImportError:
            self.fail("Material indexing is not implemented")
        cid = await self.create_class()
        response = await self.client.post(
            f"/classes/{cid}/materials", json={"title": "Pecahan", "content": "Pecahan senilai mempunyai nilai yang sama meskipun pembilang dan penyebutnya berbeda."}
        )
        mid = uuid.UUID(response.json()["id"])
        async with self.engine.begin() as conn:
            await conn.run_sync(
                lambda c: Base.metadata.create_all(
                    c,
                    tables=[
                        Subject.__table__,
                        Concept.__table__,
                        Document.__table__,
                        CurriculumChunk.__table__,
                    ],
                )
            )
        async with self.sessions() as session:
            row = await session.get(ClassMaterial, mid)
            row.published = True
            await session.commit()

        @asynccontextmanager
        async def isolated_session():
            async with self.sessions() as session:
                yield session
                await session.commit()

        async def embed_text(texts):
            from config.settings import settings

            return [[0.1] * settings.EMBEDDING_DIM for _ in texts]

        with (
            patch.object(material_service, "async_session", isolated_session),
            patch("rag.ingestion.embed_text", embed_text),
        ):
            await material_service.index_class_material(mid, 1)
            async with self.sessions() as session:
                row = await session.get(ClassMaterial, mid)
                self.assertEqual(row.rag_status, "ready")
                self.assertEqual(row.indexed_version, 1)
                self.assertGreater(row.n_chunks, 0)
                self.assertEqual(
                    (await session.scalars(select(CurriculumChunk))).one().content,
                    "Pecahan senilai mempunyai nilai yang sama meskipun pembilang dan penyebutnya berbeda.",
                )
                row.content = "Materi diperbarui."
                row.content_version = 2
                row.rag_status = "pending"
                await session.commit()
            await material_service.index_class_material(mid, 1)
            async with self.sessions() as session:
                row = await session.get(ClassMaterial, mid)
                self.assertEqual(row.content_version, 2)
                self.assertEqual(row.rag_status, "pending")

    async def test_published_material_exposes_retry_index_endpoint(self):
        cid = await self.create_class()
        material = await self.client.post(
            f"/classes/{cid}/materials", json={"title": "Draft", "content": "Pecahan"}
        )
        mid = material.json()["id"]
        retry = await self.client.post(f"/classes/{cid}/materials/{mid}/index")
        self.assertEqual(retry.status_code, 409, retry.text)

    async def test_context_refuses_unready_material_and_an_unenrolled_student(self):
        from fastapi import HTTPException

        try:
            from api.material_service import resolve_tutoring_context
        except ImportError:
            self.fail("Material context validation is not implemented")
        cid = await self.create_class()
        await self.client.post(f"/classes/{cid}/members", json={"username": "student"})
        material = await self.client.post(
            f"/classes/{cid}/materials", json={"title": "Draft", "content": "Pecahan"}
        )
        mid = uuid.UUID(material.json()["id"])
        async with self.sessions() as session:
            row = await session.get(ClassMaterial, mid)
            row.published = True
            await session.commit()
        async with self.sessions() as session:
            with self.assertRaises(HTTPException) as denied:
                await resolve_tutoring_context(session, uuid.UUID(cid), mid, self.outsider)
            self.assertEqual(denied.exception.status_code, 404)
            with self.assertRaises(HTTPException) as pending:
                await resolve_tutoring_context(session, uuid.UUID(cid), mid, self.student)
            self.assertEqual(pending.exception.status_code, 409)

    async def test_draft_has_index_status_and_retains_the_reviewed_filename(self):
        cid = await self.create_class()
        response = await self.client.post(
            f"/classes/{cid}/materials",
            json={
                "title": "Pecahan",
                "content": "Teks sudah diperiksa",
                "source_filename": "buku.pdf",
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        body = response.json()
        self.assertEqual(body["source_filename"], "buku.pdf")
        self.assertEqual(body["rag_status"], "pending")
        self.assertEqual(body["content_version"], 1)
        self.assertEqual(body["indexed_version"], 0)

    async def test_import_reviews_text_without_saving_a_material(self):
        cid = await self.create_class()
        response = await self.client.post(
            f"/classes/{cid}/materials/import",
            files={
                "file": ("pecahan.txt", b"Satu per dua sama dengan dua per empat.", "text/plain")
            },
        )
        preview = await self.completed_preview(cid, response)
        self.assertEqual(response.json()["filename"], "pecahan.txt")
        self.assertIn("Satu per dua", preview["preview"]["content"])
        async with self.sessions() as session:
            self.assertEqual(
                await session.scalar(select(func.count()).select_from(ClassMaterial)), 0
            )

    async def test_saved_original_is_private_and_reviewed_source_cannot_cross_classes(self):
        cid = await self.create_class()
        uploaded = await self.client.post(
            f"/classes/{cid}/materials/import",
            files={"file": ("../source.txt", b"Materi asli untuk ditinjau.")},
        )
        preview = await self.completed_preview(cid, uploaded)
        iid = preview["import_id"]
        self.assertEqual(preview["filename"], "source.txt")
        # Resuming uses persisted SQL, without another upload/provider request.
        resumed = await self.client.get(f"/classes/{cid}/imports/{iid}")
        self.assertEqual(resumed.json()["preview"], preview["preview"])
        download = await self.client.get(f"/classes/{cid}/imports/{iid}/original")
        self.assertEqual(download.content, b"Materi asli untuk ditinjau.")
        self.assertEqual(download.headers["cache-control"], "private, no-store")
        for actor, expected in [(self.other_teacher, 404), (self.student, 403)]:
            self.actor = actor
            self.assertEqual(
                (await self.client.get(f"/classes/{cid}/imports/{iid}")).status_code, expected
            )
            self.assertEqual(
                (await self.client.get(f"/classes/{cid}/imports/{iid}/original")).status_code,
                expected,
            )
        self.actor = self.teacher
        other = await self.create_class()
        body = {
            "title": "Hasil tinjauan",
            "content": "Teks telah diperbaiki guru.",
            "source_import_id": iid,
        }
        self.assertEqual(
            (await self.client.post(f"/classes/{other}/materials", json=body)).status_code, 422
        )
        saved = await self.client.post(f"/classes/{cid}/materials", json=body)
        self.assertEqual(saved.status_code, 201, saved.text)
        self.assertEqual(saved.json()["source_import_id"], iid)

    async def test_import_accepts_docx_paragraphs_and_table_text(self):
        cid = await self.create_class()
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w") as archive:
            archive.writestr(
                "word/document.xml",
                '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                "<w:body><w:p><w:r><w:t>Persamaan linear</w:t></w:r></w:p>"
                "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>x + 2 = 5</w:t></w:r></w:p>"
                "</w:tc></w:tr></w:tbl></w:body></w:document>",
            )
        response = await self.client.post(
            f"/classes/{cid}/materials/import",
            files={"file": ("aljabar.docx", stream.getvalue(), "application/octet-stream")},
        )
        preview = await self.completed_preview(cid, response)
        self.assertIn("Persamaan linear", preview["preview"]["content"])
        self.assertIn("x + 2 = 5", preview["preview"]["content"])

    async def test_import_denies_other_teachers_and_students(self):
        cid = await self.create_class()
        for actor, status in ((self.other_teacher, 404), (self.student, 403)):
            self.actor = actor
            response = await self.client.post(
                f"/classes/{cid}/materials/import", files={"file": ("test.txt", b"Private text")}
            )
            self.assertEqual(response.status_code, status, response.text)

    async def test_import_rejects_bad_extension_and_invalid_utf8(self):
        cid = await self.create_class()
        for filename, data, status in (("bad.exe", b"MZ", 415), ("bad.txt", b"\xff\x00", 202)):
            response = await self.client.post(
                f"/classes/{cid}/materials/import", files={"file": (filename, data)}
            )
            self.assertEqual(response.status_code, status, response.text)
            if status == 202:
                preview = await self.completed_preview(cid, response)
                self.assertEqual(preview["state"], "retry")

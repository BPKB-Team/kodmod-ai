"""Scoped Tutor sessions against isolated SQLite, with no provider calls."""

from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from api import chat_service
from api.dependencies import db_session, require_student
from api.routes import chat, voice
from database.models import (
    Base,
    ClassMaterial,
    Classroom,
    Enrollment,
    InteractionLog,
    LearningSession,
    MaterialImport,
    Subject,
    User,
)

pytestmark = pytest.mark.unit


@pytest.fixture
async def scoped_chat(monkeypatch):
    from analytics.student_model import StudentModel

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(
            lambda c: Base.metadata.create_all(
                c,
                tables=[
                    User.__table__,
                    Classroom.__table__,
                    Enrollment.__table__,
                    ClassMaterial.__table__,
                    MaterialImport.__table__,
                    Subject.__table__,
                    LearningSession.__table__,
                    InteractionLog.__table__,
                ],
            )
        )
    teacher = User(
        id=uuid.uuid4(),
        username="teacher",
        role="teacher",
        full_name="Guru",
        password_hash="unused",
    )
    student = User(
        id=uuid.uuid4(),
        username="student",
        role="student",
        full_name="Siswa",
        password_hash="unused",
    )
    classroom = Classroom(
        id=uuid.uuid4(), teacher_id=teacher.id, name="Kelas VII", subject="Matematika"
    )
    material = ClassMaterial(
        id=uuid.uuid4(),
        class_id=classroom.id,
        title="Pecahan",
        content="Pecahan senilai.",
        published=True,
        rag_status="ready",
        content_version=1,
        indexed_version=1,
        n_chunks=1,
    )
    async with sessions() as session:
        session.add_all([teacher, student, classroom, material])
        await session.flush()
        session.add(Enrollment(class_id=classroom.id, student_id=student.id))
        await session.commit()

    @asynccontextmanager
    async def isolated_session():
        async with sessions() as session:
            yield session
            await session.commit()

    async def dependency_session():
        async with isolated_session() as session:
            yield session

    async def actor():
        return student

    async def load_mastery(student_id):
        return StudentModel(student_id=str(student_id))

    class ProviderBoundary:
        async def ainvoke(self, state, config):
            documents = (
                [
                    {
                        "source": r"C:\private\uploads\pecahan.pdf",
                        "score": 0.7,
                        "class_id": state["class_id"],
                        "material_id": state["material_id"],
                        "material_title": "Pecahan",
                    }
                ]
                if state.get("material_id")
                else []
            )
            return {
                **state,
                "accessible_response": "Penjelasan dari materi.",
                "intent": "tutoring",
                "retrieved_docs": documents,
            }

    monkeypatch.setattr(chat_service, "async_session", isolated_session)
    monkeypatch.setattr(StudentModel, "load", staticmethod(load_mastery))
    import memory.long_term as long_term

    monkeypatch.setattr(long_term, "async_session", isolated_session)
    app = FastAPI()
    app.include_router(chat.router, prefix="/chat")
    app.include_router(voice.router, prefix="/voice")
    app.state.graph = ProviderBoundary()
    app.dependency_overrides[require_student] = actor
    app.dependency_overrides[db_session] = dependency_session
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield SimpleNamespace(
            client=client,
            sessions=sessions,
            student=student,
            classroom=classroom,
            material=material,
            app=app,
            isolated_session=isolated_session,
        )
    await engine.dispose()


def scoped_body(workspace):
    return {
        "text": "Jelaskan materi ini",
        "class_id": str(workspace.classroom.id),
        "material_id": str(workspace.material.id),
    }


async def test_material_selection_is_saved_and_returned_in_session_context(scoped_chat):
    workspace = scoped_chat
    response = await workspace.client.post("/chat/message", json=scoped_body(workspace))
    assert response.status_code == 200, response.text
    expected = {
        "class_id": str(workspace.classroom.id),
        "material_id": str(workspace.material.id),
        "subject_name": "Matematika",
        "material_title": "Pecahan",
        "subject_id": None,
        "mapping_version": 0,
        "approved_material_concepts": [],
    }
    assert response.json().get("context") == expected
    session_id = response.json()["session_id"]
    # Replay shows the stable selected material label. Approved concepts are
    # resolved afresh before the next provider call, never trusted from history.
    history_context = {
        key: expected[key] for key in ("class_id", "material_id", "subject_name", "material_title")
    }
    rows = (await workspace.client.get("/chat/sessions")).json()
    assert rows[0]["context"] == history_context
    detail = (await workspace.client.get(f"/chat/sessions/{session_id}")).json()
    assert detail["context"] == history_context


async def test_deleting_chat_session_also_deletes_its_turns(scoped_chat):
    workspace = scoped_chat
    response = await workspace.client.post("/chat/message", json=scoped_body(workspace))
    assert response.status_code == 200, response.text
    session_id = response.json()["session_id"]

    deleted = await workspace.client.delete(f"/chat/sessions/{session_id}")
    assert deleted.status_code == 204, deleted.text

    async with workspace.sessions() as session:
        assert await session.get(LearningSession, uuid.UUID(session_id)) is None
        assert (
            await session.scalar(
                select(InteractionLog.id).where(InteractionLog.session_id == uuid.UUID(session_id))
            )
            is None
        )


async def test_a_resumed_session_rechecks_revoked_class_access(scoped_chat):
    workspace = scoped_chat
    first = await workspace.client.post("/chat/message", json=scoped_body(workspace))
    assert first.status_code == 200, first.text
    async with workspace.sessions() as session:
        await session.execute(
            delete(Enrollment).where(Enrollment.student_id == workspace.student.id)
        )
        await session.commit()

    response = await workspace.client.post(
        "/chat/message", json={"text": "Lanjutkan", "session_id": first.json()["session_id"]}
    )
    assert response.status_code == 404, response.text


async def test_context_cannot_be_attached_to_an_existing_general_session(scoped_chat):
    workspace = scoped_chat
    first = await workspace.client.post("/chat/message", json={"text": "Halo"})
    response = await workspace.client.post(
        "/chat/message", json={**scoped_body(workspace), "session_id": first.json()["session_id"]}
    )
    assert response.status_code == 409, response.text


async def test_draft_or_outdated_index_never_reaches_tutor(scoped_chat):
    workspace = scoped_chat
    async with workspace.sessions() as session:
        row = await session.get(ClassMaterial, workspace.material.id)
        row.indexed_version = 0
        await session.commit()
    response = await workspace.client.post("/chat/message", json=scoped_body(workspace))
    assert response.status_code == 409, response.text


async def test_material_id_requires_a_class(scoped_chat):
    workspace = scoped_chat
    response = await workspace.client.post(
        "/chat/message", json={"text": "Jelaskan", "material_id": str(workspace.material.id)}
    )
    assert response.status_code == 422, response.text


def test_source_disclosure_has_filename_and_material_reference_only():
    rows = chat_service.sources(
        {
            "retrieved_docs": [
                {
                    "source": r"C:\private\uploads\pecahan.pdf",
                    "score": 0.7,
                    "class_id": "class-1",
                    "material_id": "material-1",
                    "material_title": "Pecahan",
                }
            ]
        }
    )
    assert rows == [
        {
            "source": "pecahan.pdf",
            "section_title": None,
            "score": 0.7,
            "class_id": "class-1",
            "material_id": "material-1",
            "title": "Pecahan",
        }
    ]


async def test_citations_are_saved_and_replayed_from_real_transcript(scoped_chat):
    workspace = scoped_chat
    response = await workspace.client.post("/chat/message", json=scoped_body(workspace))
    assert response.status_code == 200, response.text
    answer = response.json()
    assert answer["sources"][0]["title"] == "Pecahan"
    async with workspace.sessions() as session:
        from sqlalchemy import select

        log = await session.scalar(
            select(InteractionLog).where(
                InteractionLog.session_id == uuid.UUID(answer["session_id"]),
                InteractionLog.role == "assistant",
            )
        )
        assert log.metadata_["sources"] == answer["sources"]
    detail = await workspace.client.get(f"/chat/sessions/{answer['session_id']}")
    assert detail.json()["turns"][1]["sources"] == answer["sources"]


async def test_websocket_resume_rechecks_revoked_context(scoped_chat, monkeypatch):
    from api.websockets import chat_stream

    workspace = scoped_chat
    first = await workspace.client.post("/chat/message", json=scoped_body(workspace))
    async with workspace.sessions() as session:
        await session.execute(
            delete(Enrollment).where(Enrollment.student_id == workspace.student.id)
        )
        await session.commit()
    frames = []

    class Socket:
        app = workspace.app

        async def send_json(self, frame):
            frames.append(frame)

    async def forbidden_provider(*args, **kwargs):
        pytest.fail("Revoked context must not reach the graph")
        yield

    monkeypatch.setattr(chat_stream, "async_session", workspace.isolated_session, raising=False)
    monkeypatch.setattr(chat_stream, "run_turn", forbidden_provider)
    await chat_stream._run_one_turn(
        Socket(),
        workspace.student,
        text="Lanjutkan",
        session_id=uuid.UUID(first.json()["session_id"]),
        subject_id=None,
    )
    assert frames and frames[0]["type"] == "error"
    assert frames[0]["status"] == 404


async def test_voice_socket_rechecks_material_scope_before_running_graph(scoped_chat, monkeypatch):
    from fastapi import WebSocketDisconnect

    from api.websockets import voice_stream

    workspace = scoped_chat
    first = await workspace.client.post("/chat/message", json=scoped_body(workspace))
    async with workspace.sessions() as session:
        row = await session.get(ClassMaterial, workspace.material.id)
        row.published = False
        await session.commit()
    frames = []

    class Socket:
        app = workspace.app

        def __init__(self):
            self.query_params = {"session_id": first.json()["session_id"]}

        async def accept(self):
            pass

        async def send_json(self, frame):
            frames.append(frame)

        async def close(self, code):
            frames.append({"type": "closed", "code": code})

    async def actor(ws):
        return workspace.student

    collected = False

    async def transcript(ws, stt):
        nonlocal collected
        if collected:
            raise WebSocketDisconnect()
        collected = True
        return "Lanjutkan"

    async def forbidden_provider(*args, **kwargs):
        pytest.fail("Revoked voice context must not reach the graph")
        yield

    monkeypatch.setattr(voice_stream, "authenticate_ws", actor)
    monkeypatch.setattr(voice_stream, "StreamingSTT", lambda **kwargs: None)
    monkeypatch.setattr(voice_stream, "_collect_utterance", transcript)
    monkeypatch.setattr(voice_stream, "async_session", workspace.isolated_session, raising=False)
    monkeypatch.setattr(voice_stream, "run_turn", forbidden_provider)
    await voice_stream.voice_ws(Socket())
    assert frames[0]["type"] == "error" and frames[0]["status"] == 404


async def test_voice_text_never_resumes_another_students_checkpoint(scoped_chat):
    workspace = scoped_chat
    victim = User(
        id=uuid.uuid4(),
        username="victim",
        role="student",
        full_name="Siswa lain",
        password_hash="unused",
    )
    victim_session = LearningSession(
        id=uuid.uuid4(), student_id=victim.id, title="Percakapan pribadi"
    )
    async with workspace.sessions() as session:
        session.add(victim)
        await session.flush()
        session.add(victim_session)
        await session.commit()

    response = await workspace.client.post(
        "/voice/text", data={"text": "Halo", "session_id": str(victim_session.id)}
    )

    assert response.status_code == 200, response.text
    assert response.json()["session_id"] != str(victim_session.id)
    async with workspace.sessions() as session:
        owned = await session.get(LearningSession, uuid.UUID(response.json()["session_id"]))
        assert owned is not None and owned.student_id == workspace.student.id


async def test_voice_text_revalidates_the_stored_material_scope(scoped_chat):
    workspace = scoped_chat
    first = await workspace.client.post("/chat/message", json=scoped_body(workspace))
    async with workspace.sessions() as session:
        row = await session.get(ClassMaterial, workspace.material.id)
        row.published = False
        await session.commit()

    response = await workspace.client.post(
        "/voice/text", data={"text": "Lanjut", "session_id": first.json()["session_id"]}
    )

    assert response.status_code == 404, response.text


async def test_voice_text_validates_session_uuid(scoped_chat):
    response = await scoped_chat.client.post(
        "/voice/text", data={"text": "Halo", "session_id": "not-a-uuid"}
    )
    assert response.status_code == 422, response.text

"""Reviewed classroom Concept boundaries, using disposable SQL and fake LLMs."""

import json
import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from agents import problem_generator
from database.models import Base, ClassMaterial, Classroom, Concept, Subject
from tests import assessment_test, classroom_test
from tests.assessment_test import assessment_http as assessment_http


@pytest.fixture
async def mapping_http():
    fixture = classroom_test.ClassroomRoutesTest()
    await fixture.asyncSetUp()
    from api.routes.editorial_quizzes import router

    fixture.client._transport.app.include_router(router)
    try:
        async with fixture.engine.begin() as connection:
            tables = [Subject.__table__, Concept.__table__]
            if "material_concepts" in Base.metadata.tables:
                tables.append(Base.metadata.tables["material_concepts"])
            await connection.run_sync(lambda c: Base.metadata.create_all(c, tables=tables))
        async with fixture.sessions() as session:
            subject, other = Subject(name="Matematika"), Subject(name="Biologi")
            session.add_all([subject, other])
            await session.flush()
            concept = Concept(subject_id=subject.id, name="Pecahan", slug="review-pecahan")
            outside = Concept(subject_id=other.id, name="Sel", slug="review-sel")
            session.add_all([concept, outside])
            await session.commit()
            fixture.subject, fixture.other_subject = subject, other
            fixture.concept, fixture.other_concept = concept, outside
        yield fixture
    finally:
        await fixture.asyncTearDown()
        fixture.doCleanups()


async def material_for(fixture):
    room = await fixture.client.post(
        "/classes",
        json={
            "name": "Kelas pemetaan",
            "subject": "Matematika",
            "subject_id": str(fixture.subject.id),
        },
    )
    assert room.status_code == 201, room.text
    class_id = room.json()["id"]
    response = await fixture.client.post(
        f"/classes/{class_id}/materials",
        json={
            "title": "Pecahan",
            "content": "Satu per dua sama dengan dua per empat.",
            "published": True,
        },
    )
    assert response.status_code == 201, response.text
    return class_id, response.json()["id"]


def approval(fixture, *, content=1, mapping=0, concepts=None):
    return {
        "expected_content_version": content,
        "expected_mapping_version": mapping,
        "concept_ids": concepts if concepts is not None else [str(fixture.concept.id)],
        "primary_concept_id": str(fixture.concept.id) if concepts is None else None,
    }


async def test_owner_approves_versioned_concepts_and_stale_review_is_rejected(mapping_http):
    f = mapping_http
    cid, mid = await material_for(f)
    path = f"/classes/{cid}/materials/{mid}/concepts"
    response = await f.client.put(path, json=approval(f))
    assert response.status_code == 200, response.text
    reviewed = response.json()
    assert reviewed["mapping_version"] == 1
    assert reviewed["concepts"][0]["id"] == str(f.concept.id)
    assert reviewed["concepts"][0]["primary"] is True
    assert reviewed["concepts"][0]["approved_by"] == str(f.teacher.id)
    assert (await f.client.put(path, json=approval(f))).status_code == 409
    async with f.sessions() as session:
        material = await session.get(ClassMaterial, uuid.UUID(mid))
        assert material.rag_status == "pending"
        assert material.mapping_version == 1 and material.indexed_mapping_version == 0


async def test_mapping_rejects_other_subject_and_non_owner_without_changing_revision(mapping_http):
    f = mapping_http
    cid, mid = await material_for(f)
    path = f"/classes/{cid}/materials/{mid}/concepts"
    body = approval(f, concepts=[str(f.other_concept.id)])
    assert (await f.client.put(path, json=body)).status_code == 422
    assert (
        await f.client.put(path, json=approval(f, concepts=[str(uuid.uuid4())]))
    ).status_code == 422
    f.actor = f.other_teacher
    assert (await f.client.get(path)).status_code == 404
    assert (await f.client.put(path, json=approval(f))).status_code == 404
    f.actor = f.student
    assert (await f.client.put(path, json=approval(f))).status_code == 403
    f.actor = f.teacher
    assert (await f.client.get(path)).json()["mapping_version"] == 0


async def test_editing_content_invalidates_current_mapping_and_keeps_historical_review(
    mapping_http,
):
    f = mapping_http
    cid, mid = await material_for(f)
    path = f"/classes/{cid}/materials/{mid}/concepts"
    assert (await f.client.put(path, json=approval(f))).status_code == 200
    response = await f.client.put(
        f"/classes/{cid}/materials/{mid}",
        json={
            "title": "Pecahan baru",
            "content": "Tiga per enam sama dengan satu per dua.",
            "published": True,
        },
    )
    assert response.status_code == 200
    mapping = (await f.client.get(path)).json()
    assert mapping["content_version"] == 2
    assert mapping["concepts"] == []
    assert (await f.client.put(path, json=approval(f, content=1, mapping=1))).status_code == 409
    assert (await f.client.put(path, json=approval(f, content=2, mapping=1))).status_code == 200
    table = Base.metadata.tables["material_concepts"]
    async with f.sessions() as session:
        versions = (
            (
                await session.execute(
                    select(table.c.content_version).where(table.c.material_id == uuid.UUID(mid))
                )
            )
            .scalars()
            .all()
        )
        assert sorted(versions) == [1, 2]


async def test_changing_subject_invalidates_mapping_without_rewriting_history(mapping_http):
    f = mapping_http
    cid, mid = await material_for(f)
    path = f"/classes/{cid}/materials/{mid}/concepts"
    assert (await f.client.put(path, json=approval(f))).status_code == 200
    response = await f.client.patch(f"/classes/{cid}", json={"subject_id": str(f.other_subject.id)})
    assert response.status_code == 200, response.text
    assert response.json()["subject"] == "Biologi"
    mapping = (await f.client.get(path)).json()
    assert mapping["mapping_version"] == 2 and mapping["concepts"] == []
    assert (await f.client.put(path, json=approval(f, mapping=2))).status_code == 422
    async with f.sessions() as session:
        room = await session.get(Classroom, uuid.UUID(cid))
        assert room.subject_id == f.other_subject.id
        table = Base.metadata.tables["material_concepts"]
        assert (
            len(
                (
                    await session.execute(
                        select(table).where(table.c.material_id == uuid.UUID(mid))
                    )
                ).all()
            )
            == 1
        )


@pytest.mark.parametrize("forged", [False, True])
async def test_generator_attributes_only_question_specific_reviewed_concepts(monkeypatch, forged):
    cid, wrong = str(uuid.uuid4()), str(uuid.uuid4())
    class_id, material_id, student_id = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    prompts = []

    class LLM:
        async def ainvoke(self, messages):
            prompts.extend(message["content"] for message in messages)
            return SimpleNamespace(
                content=json.dumps(
                    {
                        "questions": [
                            {
                                "text": "Apa arti satu per dua?",
                                "type": "spoken",
                                "expected_answer": "Satu dari dua bagian yang sama",
                                "source_indices": [1],
                                "concept_id": wrong if forged else cid,
                            }
                        ]
                    }
                )
            )

    monkeypatch.setattr(problem_generator, "get_quiz_llm", lambda: LLM())
    state = {
        "class_id": class_id,
        "material_id": material_id,
        "student_id": student_id,
        "current_topic": "Pecahan",
        "quiz_n_questions": 1,
        "assessment_managed": True,
        "approved_material_concepts": [{"id": cid, "name": "Pecahan"}],
        "quiz_source_docs": [
            {
                "chunk_id": "pecahan-source",
                "class_id": class_id,
                "material_id": material_id,
                "text": "Pecahan menyatakan bagian yang sama besar dalam satu keseluruhan.",
                "approved_concept_ids": [cid],
            }
        ],
    }
    if forged:
        with pytest.raises(ValueError):
            await problem_generator.problem_generator_node(state)
    else:
        result = await problem_generator.problem_generator_node(state)
        assert result["quiz_questions"][0]["concept_id"] == cid
        assert any(cid in prompt for prompt in prompts)


async def test_mapped_assessment_preserves_review_snapshot_and_updates_mastery_once(
    assessment_http, monkeypatch
):
    from database import models as db

    client, factory, controls, graph, concept, _ = assessment_http
    async with factory.kw["bind"].begin() as connection:
        await connection.run_sync(
            lambda c: db.Base.metadata.create_all(c, tables=[db.MaterialConcept.__table__])
        )
    async with factory() as session:
        teacher = db.User(
            username="mapping-owner", full_name="Teacher", role="teacher", password_hash="test"
        )
        session.add(teacher)
        await session.flush()
        room = db.Classroom(
            teacher_id=teacher.id, name="Kelas", subject="Matematika", subject_id=concept.subject_id
        )
        session.add(room)
        await session.flush()
        material = db.ClassMaterial(
            class_id=room.id,
            title="Pecahan",
            content=(
                "Pecahan senilai memiliki nilai yang sama. Pembilang dan penyebut dikalikan "
                "dengan bilangan yang sama sehingga nilai pecahan tetap."
            ),
            published=True,
            rag_status="ready",
            indexed_version=1,
            n_chunks=1,
            mapping_version=1,
            indexed_mapping_version=1,
        )
        session.add(material)
        await session.flush()
        session.add_all(
            [
                db.Enrollment(class_id=room.id, student_id=controls["actor"].id),
                db.MaterialConcept(
                    material_id=material.id,
                    content_version=1,
                    mapping_version=1,
                    concept_id=concept.id,
                    approved_by=teacher.id,
                    is_primary=True,
                ),
            ]
        )
        await session.commit()
    original = graph.ainvoke

    async def attributed(state, config=None):
        final = await original(state, config)
        if not state.get("student_answer"):
            assert state["approved_material_concepts"][0]["id"] == str(concept.id)
            final["quiz_questions"][0]["concept_id"] = str(concept.id)
        return final

    monkeypatch.setattr(graph, "ainvoke", attributed)
    response = await client.post(
        "/quiz/start",
        json={
            "class_id": str(room.id),
            "material_id": str(material.id),
            "n_questions": 1,
        },
    )
    assert response.status_code == 200, response.text
    started = response.json()
    async with factory() as session:
        stored = await session.get(db.QuizSession, uuid.UUID(started["quiz_session_id"]))
        assert stored.assessment_state["material_mapping_version"] == 1
        # Mapping edits affect new questions; this question retains its review.
        source = await session.get(db.ClassMaterial, material.id)
        source.mapping_version = source.indexed_mapping_version = 2
        await session.commit()
    body = assessment_test.submission(started)
    first = await client.post("/quiz/submit", json=body)
    replay = await client.post("/quiz/submit", json=body)
    assert first.status_code == replay.status_code == 200, first.text
    assert first.json() == replay.json()
    async with factory() as session:
        score = await session.scalar(select(db.MasteryScore))
        assert score.concept_id == concept.id and score.n_attempts == 1
        events = list(await session.scalars(select(db.MasteryEvent)))
        assert len(events) == 1
        assert events[0].source_snapshot["mapping_version"] == 1


async def test_failed_old_index_job_cannot_mark_new_mapping_failed(mapping_http, monkeypatch):
    from api import material_service

    f = mapping_http
    cid, mid = await material_for(f)
    path = f"/classes/{cid}/materials/{mid}/concepts"
    assert (await f.client.put(path, json=approval(f))).status_code == 200

    async def failed_provider(*args, **kwargs):
        response = await f.client.put(path, json=approval(f, mapping=1))
        assert response.status_code == 200, response.text
        raise RuntimeError("Simulated provider failure for obsolete mapping")

    monkeypatch.setattr(material_service, "async_session", f.sessions)
    monkeypatch.setattr(material_service, "build_material_records", failed_provider)
    await material_service.index_class_material(uuid.UUID(mid), 1)
    async with f.sessions() as session:
        material = await session.get(ClassMaterial, uuid.UUID(mid))
        assert material.mapping_version == 2
        assert material.rag_status == "pending"


async def test_teacher_proposal_uses_reviewed_question_specific_attribution(
    mapping_http, monkeypatch
):
    f = mapping_http
    cid, mid = await material_for(f)
    assert (
        await f.client.put(f"/classes/{cid}/materials/{mid}/concepts", json=approval(f))
    ).status_code == 200

    async def generate(state):
        assert state["approved_material_concepts"][0]["id"] == str(f.concept.id)
        bundle = state["quiz_source_bundle"]
        assert bundle.sources[0].block_ids
        assert bundle.sources[0].content_version == 1
        assert bundle.sources[0].mapping_version == 1
        assert bundle.sources[0].document_hash
        return {
            "quiz_questions": [
                {
                    "text": "Setengah berarti?",
                    "options": ["A. Satu dari dua", "B. Dua dari dua"],
                    "expected_answer": "a",
                    "explanation": "Satu bagian dari dua bagian sama besar.",
                    "concept_id": str(f.concept.id),
                }
            ]
        }

    monkeypatch.setattr(problem_generator, "problem_generator_node", generate)
    response = await f.client.post(
        "/teacher/quizzes/propose",
        json={
            "class_id": cid,
            "material_id": mid,
            "n_questions": 1,
            "difficulty": "easy",
            "language": "id",
        },
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["review_required"] is True
    assert result["mapping_version"] == 1
    assert result["questions"][0]["concept_id"] == str(f.concept.id)


async def test_teacher_proposal_quality_error_is_safe_and_actionable(mapping_http, monkeypatch):
    from agents.question_quality import QuestionQualityError

    f = mapping_http
    cid, mid = await material_for(f)
    assert (
        await f.client.put(f"/classes/{cid}/materials/{mid}/concepts", json=approval(f))
    ).status_code == 200

    async def fail(_state):
        raise QuestionQualityError("source_quality_failed", "private answer key: secret")

    monkeypatch.setattr(problem_generator, "problem_generator_node", fail)
    response = await f.client.post(
        "/teacher/quizzes/propose",
        json={"class_id": cid, "material_id": mid, "n_questions": 1},
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "source_quality_failed"
    assert "Periksa isi materi" in response.json()["detail"]["message"]
    assert "secret" not in response.text

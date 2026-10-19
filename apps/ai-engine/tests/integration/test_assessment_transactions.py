"""PostgreSQL assessment locking in a disposable schema on the dedicated test DB.

Set ASSESSMENT_TEST_DATABASE_URL to the isolated 127.0.0.1:5434/kodmod_test
database. These tests do not use the shared database, Redis, or live providers.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from contextlib import asynccontextmanager
from types import SimpleNamespace

import httpx
import pytest
import pytest_asyncio
from api.dependencies import current_user
from api.routes import quiz
from database import models
from fastapi import FastAPI
from sqlalchemy import func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.schema import CreateSchema, DropSchema

from tests.assessment_test import AssessmentGraph, start, submission

pytestmark = [
    pytest.mark.integration,
    pytest.mark.db,
    pytest.mark.asyncio(loop_scope="function"),
]


class PausedAssessmentGraph(AssessmentGraph):
    """Hold the first score turn open while another HTTP request reaches its lock."""

    def __init__(self):
        super().__init__()
        self.score_entered = asyncio.Event()
        self.release_score = asyncio.Event()
        self.scoring_calls = 0

    async def ainvoke(self, state, config=None):
        if state.get("student_answer"):
            self.scoring_calls += 1
            if self.scoring_calls == 1:
                self.score_entered.set()
                await asyncio.wait_for(self.release_score.wait(), timeout=10)
        else:
            self.qids = [str(uuid.uuid4()), str(uuid.uuid4())]
        return await super().ainvoke(state, config=config)


class UnavailableAssessmentGraph:
    """A restarted app has no checkpoint or available scoring provider."""

    async def ainvoke(self, state, config=None):
        pytest.fail("A committed submission replay must not invoke the graph")


@pytest_asyncio.fixture(loop_scope="function")
async def isolated_assessment_http(monkeypatch):
    configured_url = os.getenv("ASSESSMENT_TEST_DATABASE_URL")
    if not configured_url:
        pytest.skip("set ASSESSMENT_TEST_DATABASE_URL for dedicated PostgreSQL assessment tests")
    url = make_url(configured_url)
    if (
        url.get_backend_name() != "postgresql"
        or url.host != "127.0.0.1"
        or url.port != 5434
        or url.database != "kodmod_test"
        or url.username != "kodmod"
        or url.password != "kodmod"
    ):
        pytest.fail("assessment tests require the dedicated 127.0.0.1:5434/kodmod_test database")
    url = url.set(drivername="postgresql+asyncpg")
    schema = f"assessment_{uuid.uuid4().hex}"
    admin_engine = create_async_engine(url)
    engine = create_async_engine(
        url,
        pool_size=4,
        max_overflow=0,
        connect_args={
            "server_settings": {
                "search_path": schema,
                "application_name": schema,
                "lock_timeout": "10000ms",
                "statement_timeout": "15000ms",
            }
        },
    )
    factory = async_sessionmaker(engine, expire_on_commit=False)
    created_schema = False
    try:
        async with admin_engine.begin() as connection:
            await connection.execute(CreateSchema(schema))
            created_schema = True
        names = [
            "users",
            "subjects",
            "concepts",
            "quiz_sessions",
            "quiz_questions",
            "quiz_attempts",
            "mastery_scores",
            "assessment_submissions",
            "quiz_question_outcomes",
            "quiz_action_receipts",
            "mastery_events",
        ]
        async with engine.begin() as connection:
            await connection.run_sync(
                lambda sync_connection: models.Base.metadata.create_all(
                    sync_connection,
                    tables=[models.Base.metadata.tables[name] for name in names],
                )
            )
        owner = models.User(
            id=uuid.uuid4(),
            username="assessment-owner",
            password_hash="fixture",
            full_name="Assessment Owner",
            role="student",
        )
        subject = models.Subject(id=uuid.uuid4(), name="Matematika")
        concept = models.Concept(
            id=uuid.uuid4(),
            subject_id=subject.id,
            name="Pecahan",
            slug="assessment-pecahan",
        )
        async with factory() as session:
            session.add_all([owner, subject])
            await session.flush()
            session.add(concept)
            await session.flush()
            session.add(
                models.MasteryScore(
                    student_id=owner.id,
                    concept_id=concept.id,
                    mastery=0.5,
                    confidence=0.5,
                    n_attempts=0,
                )
            )
            await session.commit()

        @asynccontextmanager
        async def transaction():
            async with factory() as session:
                try:
                    yield session
                    await session.commit()
                except Exception:
                    await session.rollback()
                    raise

        async def mastery(student_id):
            async with factory() as session:
                scores = (
                    await session.scalars(
                        select(models.MasteryScore).where(
                            models.MasteryScore.student_id == uuid.UUID(student_id)
                        )
                    )
                ).all()
                return (
                    {str(score.concept_id): score.mastery for score in scores},
                    {str(score.concept_id): score.confidence for score in scores},
                )

        async def user():
            return owner

        async def no_redis(*args, **kwargs):
            pytest.fail("Assessment transaction tests must not write shared Redis")

        monkeypatch.setattr(quiz, "async_session", transaction)
        # These pre-existing regression fixtures deliberately construct persisted v1
        # sessions. V2 tests opt in by replacing the stored policy after creation.
        real_start = quiz.start_assessment

        async def start_legacy(session, graph, student, body, **kwargs):
            result = await real_start(session, graph, student, body, **kwargs)
            row = await session.get(models.QuizSession, result.quiz_session_id)
            row.assessment_state = {**row.assessment_state, "quiz_policy_version": 1}
            return result.model_copy(update={"policy_version": 1, "available_actions": ["answer"]})

        monkeypatch.setattr(quiz, "start_assessment", start_legacy)

        monkeypatch.setattr(quiz, "_load_mastery", mastery)
        monkeypatch.setattr("memory.short_term.store_quiz_session", no_redis)

        def new_app(graph):
            app = FastAPI()
            app.state.graph = graph
            app.dependency_overrides[current_user] = user
            app.include_router(quiz.router, prefix="/quiz")
            return app

        graph = PausedAssessmentGraph()
        app = new_app(graph)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
            base_url="http://assessment.test",
        ) as client:
            yield SimpleNamespace(
                client=client,
                factory=factory,
                graph=graph,
                concept=concept,
                owner=owner,
                schema=schema,
                new_app=new_app,
            )
    finally:
        await engine.dispose()
        try:
            if created_schema:
                async with admin_engine.begin() as connection:
                    await connection.execute(DropSchema(schema, cascade=True))
        finally:
            await admin_engine.dispose()


async def wait_for_postgres_lock(fixture):
    """Assert real overlapping transactions, rather than incidental task ordering."""
    deadline = asyncio.get_running_loop().time() + 3
    while asyncio.get_running_loop().time() < deadline:
        async with fixture.factory() as session:
            blocked = await session.scalar(
                text(
                    "SELECT count(*) FROM pg_stat_activity "
                    "WHERE datname = current_database() AND application_name = :application "
                    "AND pid <> pg_backend_pid() AND wait_event_type = 'Lock'"
                ),
                {"application": fixture.schema},
            )
        if blocked:
            return
        await asyncio.sleep(0.01)
    pytest.fail("The competing submission never waited on a PostgreSQL row lock")


async def overlapping_submissions(fixture, first_body, second_body):
    first = asyncio.create_task(fixture.client.post("/quiz/submit", json=first_body))
    tasks = [first]
    try:
        await asyncio.wait_for(fixture.graph.score_entered.wait(), timeout=3)
        second = asyncio.create_task(fixture.client.post("/quiz/submit", json=second_body))
        tasks.append(second)
        await wait_for_postgres_lock(fixture)
        assert fixture.graph.scoring_calls == 1
        assert not second.done()
    finally:
        fixture.graph.release_score.set()
        responses = await asyncio.wait_for(asyncio.gather(*tasks), timeout=10)
    return responses


async def assert_single_committed_effect(fixture, body):
    async with fixture.factory() as session:
        for model in (
            models.QuizAttempt,
            models.AssessmentSubmission,
            models.MasteryEvent,
        ):
            assert await session.scalar(select(func.count()).select_from(model)) == 1
        score = await session.scalar(select(models.MasteryScore))
        assert score.n_attempts == 1
        assert score.mastery == pytest.approx(0.6125)
        event = await session.scalar(select(models.MasteryEvent))
        assert event.submission_id == uuid.UUID(body["submission_id"])
        assert event.concept_id == fixture.concept.id
        recorded = await session.get(models.AssessmentSubmission, uuid.UUID(body["submission_id"]))
        assert recorded.quiz_session_id == uuid.UUID(body["quiz_session_id"])
        assert recorded.student_id == fixture.owner.id
        assert str(recorded.question_id) == body["question_id"]
        assert recorded.attempt_index == 0


async def test_concurrent_duplicate_submission_replays_one_committed_effect(
    isolated_assessment_http,
):
    fixture = isolated_assessment_http
    body = submission(await start(fixture.client, fixture.concept))
    responses = await overlapping_submissions(fixture, body, dict(body))

    assert [response.status_code for response in responses] == [200, 200]
    assert responses[0].json() == responses[1].json()
    assert responses[0].json()["quiz_complete"] is True
    assert fixture.graph.scoring_calls == 1
    await assert_single_committed_effect(fixture, body)


async def test_concurrent_new_submission_for_same_completed_question_is_rejected(
    isolated_assessment_http,
):
    fixture = isolated_assessment_http
    body = submission(await start(fixture.client, fixture.concept))
    competing = {**body, "submission_id": str(uuid.uuid4())}
    responses = await overlapping_submissions(fixture, body, competing)

    assert [response.status_code for response in responses] == [200, 409]
    assert fixture.graph.scoring_calls == 1
    await assert_single_committed_effect(fixture, body)


async def test_committed_submission_replays_after_app_and_graph_restart(
    isolated_assessment_http,
):
    fixture = isolated_assessment_http
    body = submission(await start(fixture.client, fixture.concept))
    fixture.graph.release_score.set()
    original = await fixture.client.post("/quiz/submit", json=body)
    assert original.status_code == 200, original.text

    app = fixture.new_app(UnavailableAssessmentGraph())
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://assessment-restarted.test",
    ) as restarted_client:
        replay = await restarted_client.post("/quiz/submit", json=body)
        changed = await restarted_client.post("/quiz/submit", json={**body, "student_answer": "B"})

    assert replay.status_code == 200, replay.text
    assert replay.json() == original.json()
    assert changed.status_code == 409, changed.text
    await assert_single_committed_effect(fixture, body)


async def test_concurrent_quizzes_for_one_student_preserve_both_mastery_updates(
    isolated_assessment_http,
):
    fixture = isolated_assessment_http
    first_body = submission(await start(fixture.client, fixture.concept))
    second_body = submission(await start(fixture.client, fixture.concept))
    responses = await overlapping_submissions(fixture, first_body, second_body)

    assert [response.status_code for response in responses] == [200, 200]
    assert fixture.graph.scoring_calls == 2
    async with fixture.factory() as session:
        for model in (
            models.QuizAttempt,
            models.AssessmentSubmission,
            models.MasteryEvent,
        ):
            assert await session.scalar(select(func.count()).select_from(model)) == 2
        events = (
            await session.scalars(
                select(models.MasteryEvent).order_by(models.MasteryEvent.created_at)
            )
        ).all()
        assert events[0].mastery_before == pytest.approx(0.5)
        assert events[1].mastery_before == pytest.approx(events[0].mastery_after)
        score = await session.scalar(select(models.MasteryScore))
        assert score.n_attempts == 2
        assert score.mastery == pytest.approx(events[1].mastery_after)
        assert score.mastery > events[0].mastery_after


async def v2_start(fixture, *, kind="assessment"):
    opened = await start(fixture.client, fixture.concept, count=2)
    async with fixture.factory() as db:
        row = await db.get(models.QuizSession, uuid.UUID(opened["quiz_session_id"]))
        row.assessment_state = {
            **row.assessment_state,
            "quiz_policy_version": 2,
            "assessment_kind": kind,
        }
        await db.commit()
    return opened


async def test_v2_submit_vs_advance_closes_only_one_question(isolated_assessment_http):
    fixture = isolated_assessment_http
    opened = await v2_start(fixture)
    first = asyncio.create_task(fixture.client.post("/quiz/submit", json=submission(opened, "B")))
    await asyncio.wait_for(fixture.graph.score_entered.wait(), timeout=3)
    second = asyncio.create_task(
        fixture.client.post(
            f"/quiz/{opened['quiz_session_id']}/actions",
            json={
                "action_id": str(uuid.uuid4()),
                "question_id": opened["first_question"]["question_id"],
                "action": "advance",
            },
        )
    )
    try:
        await wait_for_postgres_lock(fixture)
    finally:
        fixture.graph.release_score.set()
        responses = await asyncio.gather(first, second)
    assert [r.status_code for r in responses] == [200, 200], [r.text for r in responses]
    assert responses[1].json()["current_question"]["order_index"] == 1
    async with fixture.factory() as db:
        assert await db.scalar(select(func.count()).select_from(models.QuizQuestionOutcome)) == 1
        assert await db.scalar(select(func.count()).select_from(models.MasteryEvent)) == 1
        row = await db.get(models.QuizSession, uuid.UUID(opened["quiz_session_id"]))
        assert row.assessment_state["current_question_index"] == 1


async def test_v2_concurrent_answers_have_one_outcome(isolated_assessment_http):
    fixture = isolated_assessment_http
    body = submission(await v2_start(fixture), "B")
    responses = await overlapping_submissions(
        fixture, body, {**body, "submission_id": str(uuid.uuid4())}
    )
    assert [r.status_code for r in responses] == [200, 409]
    async with fixture.factory() as db:
        assert await db.scalar(select(func.count()).select_from(models.QuizQuestionOutcome)) == 1
        assert await db.scalar(select(func.count()).select_from(models.MasteryEvent)) == 1


async def test_v2_review_receipt_survives_restart(isolated_assessment_http):
    fixture = isolated_assessment_http
    body = submission(await v2_start(fixture), "B")
    fixture.graph.release_score.set()
    original = await fixture.client.post("/quiz/submit", json=body)
    assert original.status_code == 200
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=fixture.new_app(UnavailableAssessmentGraph())),
        base_url="http://restart",
    ) as client:
        assert (await client.post("/quiz/submit", json=body)).json() == original.json()
        recovered = (await client.get(f"/quiz/sessions/{body['quiz_session_id']}")).json()
        assert recovered["question_state"] == "review"
        assert recovered["last_review"] == original.json()["last_review"]


async def test_v2_two_sessions_keep_independent_points_and_both_mastery_events(
    isolated_assessment_http,
):
    fixture = isolated_assessment_http
    first = submission(await v2_start(fixture))
    second = submission(await v2_start(fixture))
    results = await overlapping_submissions(fixture, first, second)
    assert [r.status_code for r in results] == [200, 200]
    assert all(r.json()["score_summary"]["points_earned"] == 100 for r in results)
    async with fixture.factory() as db:
        assert await db.scalar(select(func.count()).select_from(models.MasteryEvent)) == 2
        assert (await db.scalar(select(models.MasteryScore))).n_attempts == 2

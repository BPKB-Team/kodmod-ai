from contextlib import asynccontextmanager
from datetime import UTC, datetime
from types import SimpleNamespace as Row

from analytics import aggregator
from api.routes import analytics as analytics_routes
from database import models
from tests.unit.test_guided_learning import action_body, open_lesson
from tests.unit.test_guided_learning import learning_http as learning_http


def test_today_uses_browser_timezone():
    from analytics.aggregator import _window_start

    now = datetime(2026, 10, 19, 17, 1, tzinfo=UTC)
    assert _window_start("today", timezone="Asia/Jakarta", now=now) == datetime(
        2026, 10, 19, 17, tzinfo=UTC
    )
    assert _window_start("today", timezone="UTC", now=now) == datetime(2026, 10, 19, tzinfo=UTC)


def test_official_outcomes_do_not_count_support_retry_as_a_new_question():
    from analytics.progress_projection import official_practice_totals

    sessions = [
        Row(id="v2", assessment_state={"quiz_policy_version": 2}),
        Row(id="v1", assessment_state={}),
    ]
    attempts = [
        Row(quiz_session_id="v2", score=0, is_correct=False),
        Row(quiz_session_id="v2", score=1, is_correct=True),
        Row(quiz_session_id="v1", score=1, is_correct=True),
    ]
    outcomes = [Row(first_score=0, status="answered", assisted=False)]
    result = official_practice_totals(sessions, attempts, outcomes)
    assert result["score_sum"] == 1 and result["denominator"] == 2
    assert result["n_support_attempts"] == 1


def test_private_or_assisted_evidence_cannot_change_public_mastery_or_hash():
    from analytics.progress_projection import visible_concept_projection

    events = [
        {
            "id": "visible",
            "concept_id": "c",
            "concept_name": "Pecahan",
            "score": 1,
            "confidence": 1,
            "session_id": "s",
            "question_id": "q",
            "at": datetime(2026, 10, 19, tzinfo=UTC),
            "visible": True,
            "assisted": False,
        }
    ]
    hidden = {**events[0], "id": "hidden", "visible": False, "score": 0}
    first = visible_concept_projection([*events, hidden])
    second = visible_concept_projection([*events, {**hidden, "score": 1}])
    assert first == second
    assisted = {**events[0], "id": "assisted", "assisted": True, "score": 0}
    assert visible_concept_projection([*events, assisted]) == visible_concept_projection(events)
    assert first["weak_concepts"] == [] and first["strong_concepts"] == []
    assert first["mastery_available"]


async def prepare_rollup(learning_http, monkeypatch):
    client, factory, controls, *_ = learning_http
    names = {"assignment_mastery_events", "material_concepts", "misconceptions", "recommendations"}
    pending = list(names)
    while pending:
        for fk in models.Base.metadata.tables[pending.pop()].foreign_keys:
            name = fk.column.table.name
            if name not in names:
                names.add(name)
                pending.append(name)
    async with factory.kw["bind"].begin() as conn:
        await conn.run_sync(
            lambda c: models.Base.metadata.create_all(
                c, tables=[t for t in models.Base.metadata.sorted_tables if t.name in names]
            )
        )

    @asynccontextmanager
    async def tx():
        async with factory() as db:
            yield db

    monkeypatch.setattr(aggregator, "async_session", tx)
    monkeypatch.setattr("memory.long_term.async_session", tx)
    client._transport.app.include_router(analytics_routes.router, prefix="/analytics")


async def test_tutor_completion_reaches_self_rollup_without_mastery(learning_http, monkeypatch):
    await prepare_rollup(learning_http, monkeypatch)
    client, factory, controls, material, *_ = learning_http
    state = await open_lesson(client, material)
    while "continue" in state["available_actions"]:
        state = (
            await client.post(
                f"/learning/sessions/{state['session_id']}/actions",
                json=action_body(state, "continue"),
            )
        ).json()
    finished = await client.post(
        f"/learning/sessions/{state['session_id']}/actions", json=action_body(state, "finish")
    )
    assert finished.status_code == 200, finished.text
    response = await client.get("/analytics/me?window=all&timezone=Asia/Jakarta")
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["materials_completed"] == 1
    assert data["completed_units"] == state["total_units"]
    assert not data["mastery_available"] and data["assessed_concepts"] == 0
    assert data["unmapped_materials"] == 1 and data["duration_kind"] == "session_elapsed"
    assert data["timezone"] == "Asia/Jakarta" and data["last_activity_at"]
    assert (await client.get("/analytics/me?timezone=Not/AZone")).status_code == 422
    again = (await client.get("/analytics/me?window=all")).json()
    assert again["completed_units"] == data["completed_units"]
    assert again["last_activity_at"] == data["last_activity_at"]


async def test_old_legacy_activity_remains_in_all_not_recent_week(learning_http, monkeypatch):
    await prepare_rollup(learning_http, monkeypatch)
    client, factory, controls, *_ = learning_http
    async with factory() as db:
        row = models.QuizSession(
            student_id=controls["actor"].id,
            assessment_state={},
            total_questions=1,
            started_at=datetime(2026, 10, 4, tzinfo=UTC),
            ended_at=datetime(2026, 10, 5, tzinfo=UTC),
            status="completed",
        )
        db.add(row)
        await db.flush()
        question = models.QuizQuestion(
            quiz_session_id=row.id,
            order_index=0,
            question="Contoh",
            question_type="spoken",
            correct_answer="A",
        )
        db.add(question)
        await db.flush()
        db.add(
            models.QuizAttempt(
                quiz_session_id=row.id,
                quiz_question_id=question.id,
                student_answer="A",
                score=1,
                is_correct=True,
                answered_at=datetime(2026, 10, 5, tzinfo=UTC),
            )
        )
        await db.commit()
    all_data = await aggregator.StudentAggregator().summarise(
        student_id=controls["actor"].id, window="all", include_recommendations=False
    )
    recent = await aggregator.StudentAggregator().summarise(
        student_id=controls["actor"].id, window="week", include_recommendations=False
    )
    assert all_data["n_practice_answers"] == 1 and recent["n_practice_answers"] == 0


def test_concept_labels_require_independent_questions_in_multiple_sessions():
    from analytics.progress_projection import visible_concept_projection

    events = [
        {
            "id": str(i),
            "concept_id": "c",
            "concept_name": "Pecahan",
            "score": 0,
            "confidence": 1,
            "session_id": "s1" if i < 2 else "s2",
            "question_id": str(i),
            "at": datetime(2026, 10, 18 + i // 2, tzinfo=UTC),
        }
        for i in range(3)
    ]
    assert not visible_concept_projection(events[:2])["weak_concepts"]
    enough = visible_concept_projection(events)
    assert enough["weak_concepts"][0]["evidence_count"] == 3
    assert len(enough["concept_evidence"][0]["history"]) == 2
    repeated = [{**e, "question_id": "same"} for e in events]
    assert not visible_concept_projection(repeated)["weak_concepts"]

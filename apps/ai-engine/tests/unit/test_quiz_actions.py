"""HTTP behavior, persistence and replay for policy-v2 quizzes."""

import uuid

import pytest
from database import models
from sqlalchemy import func, select

from tests.assessment_test import assessment_http, start, submission
from tests.unit.test_guided_learning import learning_http as learning_http


async def setup(assessment_http, kind="assessment", count=2):
    client, factory, controls, graph, concept, _ = assessment_http
    opened = await start(client, concept, count)
    async with factory() as db:
        row = await db.get(models.QuizSession, uuid.UUID(opened["quiz_session_id"]))
        row.assessment_state = {
            **row.assessment_state,
            "quiz_policy_version": 2,
            "assessment_kind": kind,
        }
        await db.commit()
    return opened


async def act(client, opened, action, **overrides):
    return await client.post(
        f"/quiz/{opened['quiz_session_id']}/actions",
        json={
            "action_id": str(uuid.uuid4()),
            "question_id": opened["first_question"]["question_id"],
            "action": action,
            **overrides,
        },
    )


async def test_independent_wrong_review_recovery_and_advance(assessment_http):
    client, factory, _, graph, _, _ = assessment_http
    opened = await setup(assessment_http)
    body = submission(opened, "B")
    response = await client.post("/quiz/submit", json=body)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["question_state"] == "review"
    assert result["review_question"]["question_id"] == body["question_id"]
    assert result["available_actions"] == ["advance"]
    assert "A" in result["last_review"]
    assert (await client.get(f"/quiz/sessions/{opened['quiz_session_id']}")).json()[
        "last_review"
    ] == result["last_review"]
    calls = graph.calls
    assert (await client.post("/quiz/submit", json=body)).json() == result
    assert graph.calls == calls
    assert (
        await client.post("/quiz/submit", json={**body, "submission_id": str(uuid.uuid4())})
    ).status_code == 409
    action_id = str(uuid.uuid4())
    advanced = await act(client, opened, "advance", action_id=action_id)
    assert advanced.status_code == 200, advanced.text
    assert advanced.json()["current_question"]["order_index"] == 1
    assert (await act(client, opened, "advance", action_id=action_id)).json() == advanced.json()
    assert (await act(client, opened, "hint", action_id=action_id)).status_code == 409
    async with factory() as db:
        assert await db.scalar(select(func.count()).select_from(models.QuizQuestionOutcome)) == 1
        assert await db.scalar(select(func.count()).select_from(models.MasteryEvent)) == 1


async def test_tutor_empty_skip_has_no_attempt_or_mastery(assessment_http):
    client, factory, _, _, _, _ = assessment_http
    opened = await setup(assessment_http, "tutor")
    response = await act(client, opened, "advance")
    assert response.status_code == 200, response.text
    assert response.json()["current_question"]["order_index"] == 1
    assert response.json()["score_summary"]["skipped_questions"] == 1
    async with factory() as db:
        assert await db.scalar(select(func.count()).select_from(models.QuizAttempt)) == 0
        assert await db.scalar(select(func.count()).select_from(models.MasteryEvent)) == 0
        outcome = await db.scalar(select(models.QuizQuestionOutcome))
        assert outcome.status == "skipped"
        assert outcome.first_score == 0


async def test_tutor_retry_uses_first_score_once(assessment_http):
    client, factory, _, _, _, _ = assessment_http
    opened = await setup(assessment_http, "tutor", count=1)
    wrong = await client.post("/quiz/submit", json=submission(opened, "B"))
    assert wrong.json()["available_actions"] == ["answer", "hint", "advance"]
    right = await client.post("/quiz/submit", json=submission(opened, "A"))
    assert right.status_code == 200, right.text
    assert right.json()["cumulative_score"] == 0
    assert right.json()["score_summary"]["points_earned"] == 0
    async with factory() as db:
        assert await db.scalar(select(func.count()).select_from(models.MasteryEvent)) == 1
        assert (await db.scalar(select(models.MasteryEvent))).score == 0
        assert (await db.scalar(select(models.QuizQuestionOutcome))).first_score == 0


async def test_hint_before_answer_excludes_mastery(assessment_http, monkeypatch):
    monkeypatch.setattr("agents.tutoring_agent.generate_quiz_hint", _hint)
    client, factory, _, _, _, _ = assessment_http
    opened = await setup(assessment_http, "tutor", count=1)
    assert (await act(client, opened, "hint")).status_code == 200
    result = await client.post("/quiz/submit", json=submission(opened))
    assert result.status_code == 200, result.text
    assert result.json()["question_state"] == "review"
    assert not result.json()["quiz_complete"]
    assert (await act(client, opened, "advance")).json()["question_state"] == "complete"
    async with factory() as db:
        assert await db.scalar(select(func.count()).select_from(models.MasteryEvent)) == 0
        assert (await db.scalar(select(models.QuizQuestionOutcome))).assisted


async def _hint(*args, **kwargs):
    return "Pisahkan informasi yang diketahui."


@pytest.mark.parametrize("changed", ["mapping_version", "content_version"])
async def test_new_mutation_checks_versions_but_authorized_replay_survives(learning_http, changed):
    client, factory, controls, material, _, outsider = learning_http
    started = await client.post(
        "/quiz/start",
        json={
            "class_id": str(material.class_id),
            "material_id": str(material.id),
            "n_questions": 2,
        },
    )
    assert started.status_code == 200, started.text
    opened = started.json()
    assert opened["policy_version"] == 2
    assert "expected_answer" not in started.text and "rubric" not in started.text
    body = submission(opened, "B")
    accepted = await client.post("/quiz/submit", json=body)
    assert accepted.status_code == 200, accepted.text
    async with factory() as db:
        row = await db.get(models.ClassMaterial, material.id)
        setattr(row, changed, getattr(row, changed) + 1)
        await db.commit()
    replay = await client.post("/quiz/submit", json=body)
    assert replay.status_code == 200 and replay.json() == accepted.json()
    assert (await act(client, opened, "advance")).status_code == 409
    controls["actor"] = outsider
    assert (await client.post("/quiz/submit", json=body)).status_code in (403, 404)

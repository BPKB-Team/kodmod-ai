"""Stage 4 §7 - /quiz endpoints.

Spec: docs/assessment-api.md and docs/testplan/04-api.md §7.
"""

from __future__ import annotations

import uuid

import pytest

pytestmark = [pytest.mark.api, pytest.mark.asyncio(loop_scope="session")]


async def test_km_api_070_quiz_start(
    client, student_factory, material_source_factory, auth_headers
) -> None:  # type: ignore[no-untyped-def]
    st, tok = await student_factory()
    source = await material_source_factory(st)
    r = await client.post(
        "/quiz/start",
        headers=auth_headers(tok),
        json={
            **source,
            "n_questions": 3,
            "difficulty": "easy",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert {"quiz_session_id", "first_question", "total_questions"} <= set(body)


async def test_km_api_071_quiz_start_load_mastery_ok(
    client, student_factory, material_source_factory, auth_headers
) -> None:  # type: ignore[no-untyped-def]
    st, tok = await student_factory()
    source = await material_source_factory(st)
    r = await client.post(
        "/quiz/start",
        headers=auth_headers(tok),
        json={**source, "n_questions": 2},
    )
    assert r.status_code != 500


async def test_km_api_072_quiz_submit(client, student_factory, auth_headers) -> None:  # type: ignore[no-untyped-def]
    _st, tok = await student_factory()
    r = await client.post(
        "/quiz/submit",
        headers=auth_headers(tok),
        json={
            "quiz_session_id": str(uuid.uuid4()),
            "question_id": str(uuid.uuid4()),
            "submission_id": str(uuid.uuid4()),
            "student_answer": "A",
        },
    )
    assert r.status_code == 404


async def test_km_api_073_quiz_submit_reviews_then_advance_completes(
    client, student_factory, material_source_factory, auth_headers
) -> None:  # type: ignore[no-untyped-def]
    st, tok = await student_factory()
    source = await material_source_factory(st)
    start = await client.post(
        "/quiz/start",
        headers=auth_headers(tok),
        json={**source, "n_questions": 1},
    )
    assert start.status_code == 200, start.text
    sess = start.json()["quiz_session_id"]
    sub = await client.post(
        "/quiz/submit",
        headers=auth_headers(tok),
        json={
            "quiz_session_id": sess,
            "question_id": start.json()["first_question"]["question_id"],
            "submission_id": str(uuid.uuid4()),
            "student_answer": "A",
        },
    )
    assert sub.status_code == 200, sub.text
    reviewed = sub.json()
    question_id = start.json()["first_question"]["question_id"]
    assert reviewed["question_state"] == "review"
    assert reviewed["review_question"]["question_id"] == question_id
    assert "Jawaban benar" in reviewed["last_review"]
    assert reviewed["available_actions"] == ["advance"]

    advanced = await client.post(
        f"/quiz/{sess}/actions",
        headers=auth_headers(tok),
        json={
            "action_id": str(uuid.uuid4()),
            "question_id": question_id,
            "action": "advance",
        },
    )
    assert advanced.status_code == 200, advanced.text
    assert advanced.json()["question_state"] == "complete"
    assert advanced.json()["final_summary"]


async def test_km_api_074_quiz_start_rejects_forged_body_student_id(
    client, student_factory, concept_ids, auth_headers
) -> None:  # type: ignore[no-untyped-def]
    """Ownership comes from the token; an unrecognized student_id is rejected."""
    _st, tok = await student_factory()
    r = await client.post(
        "/quiz/start",
        headers=auth_headers(tok),
        json={
            "student_id": str(uuid.uuid4()),
            "concept_id": concept_ids["pecahan"],
            "n_questions": 1,
        },
    )
    assert r.status_code == 422

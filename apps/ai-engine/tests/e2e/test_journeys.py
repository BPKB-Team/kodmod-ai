"""Live HTTP journeys: source-led Tutor, independent assessment and analytics."""

from __future__ import annotations

import pytest

from tests._fakes.accessibility_asserts import assert_accessible

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio(loop_scope="session"), pytest.mark.timeout(60)]


# --------------------------------------------------------------------------- #
# KM-E2E-001 - onboarding + tutoring
# --------------------------------------------------------------------------- #
async def test_km_e2e_001_onboarding_tutoring(
    client, material_source_factory, auth_headers, db_cleanup
) -> None:  # type: ignore[no-untyped-def]
    import uuid

    create = await client.post(
        "/auth/register",
        json={
            "username": "e2e-" + uuid.uuid4().hex[:16],
            "full_name": "Onboarding E2E",
            "password": "proof-password-123",
            "role": "student",
        },
    )
    assert create.status_code == 201
    account = create.json()
    sid = uuid.UUID(account["user"]["id"])
    db_cleanup.append(("users", str(sid)))
    hdr = auth_headers(account["access_token"])
    source = await material_source_factory(sid)

    r1 = await client.post(
        "/learning/start",
        headers=hdr,
        json={
            "class_id": source["class_id"],
            "material_id": source["material_id"],
            "language": "id",
        },
    )
    assert r1.status_code == 200
    body = r1.json()
    assert body["text"] and body["phase"] == "learning"
    assert_accessible(body["text"])

    r2 = await client.post(
        f"/learning/sessions/{body['session_id']}/actions",
        headers=hdr,
        json={"action": "repeat", "revision": body["revision"], "request_id": str(uuid.uuid4())},
    )
    assert r2.status_code == 200
    assert r2.json()["text"] == body["text"]


# --------------------------------------------------------------------------- #
# KM-E2E-002 - full quiz cycle  (the "siap dipakai" milestone)
# --------------------------------------------------------------------------- #
async def test_km_e2e_002_full_quiz_cycle(
    client, student_factory, material_source_factory, auth_headers
) -> None:  # type: ignore[no-untyped-def]
    sid, tok = await student_factory()
    hdr = auth_headers(tok)
    source = await material_source_factory(sid)

    start = await client.post(
        "/quiz/start",
        headers=hdr,
        json={
            **source,
            "n_questions": 3,
            "difficulty": "easy",
        },
    )
    assert start.status_code == 200, start.text
    s = start.json()
    session_id, total = s["quiz_session_id"], s["total_questions"]
    assert total == 3

    last = None
    last_advance = None
    for _ in range(total):
        import uuid

        recovered = await client.get(f"/quiz/sessions/{session_id}", headers=hdr)
        assert recovered.status_code == 200
        question = recovered.json()["current_question"]
        last = await client.post(
            "/quiz/submit",
            headers=hdr,
            json={
                "quiz_session_id": session_id,
                "question_id": question["question_id"],
                "submission_id": str(uuid.uuid4()),
                "student_answer": "A",
            },
        )
        assert last.status_code == 200
        assert last.json()["question_state"] == "review"
        last_advance = await client.post(
            f"/quiz/{session_id}/actions",
            headers=hdr,
            json={
                "action_id": str(uuid.uuid4()),
                "question_id": question["question_id"],
                "action": "advance",
            },
        )
        assert last_advance.status_code == 200, last_advance.text
    assert last is not None and last_advance is not None
    assert last_advance.json()["question_state"] == "complete"
    assert last_advance.json()["final_summary"]

    an = await client.get(f"/analytics/student/{sid}", headers=hdr)
    assert an.json()["n_quiz_attempts"] >= 3


# --------------------------------------------------------------------------- #
# KM-E2E-003 - student analytics  (works today)
# --------------------------------------------------------------------------- #
async def test_km_e2e_003_student_analytics(
    client, student_factory, concept_ids, seed_mastery, auth_headers
) -> None:  # type: ignore[no-untyped-def]
    sid, tok = await student_factory()
    hdr = auth_headers(tok)
    await seed_mastery(sid, {concept_ids["pecahan"]: 0.55, concept_ids["fotosintesis"]: 0.85})

    rollup = await client.get(f"/analytics/student/{sid}", headers=hdr, params={"window": "month"})
    assert rollup.status_code == 200
    r = rollup.json()
    for key in ("overall_mastery", "weak_concepts", "engagement_index", "n_sessions"):
        assert key in r

    spoken = await client.get("/analytics/me/spoken", headers=hdr)
    assert spoken.status_code == 200
    body = spoken.json()
    assert isinstance(body["spoken"], str) and body["spoken"].strip()
    assert "summary" in body
    # KM-E2E-010 - accessibility guarantees on a real produced spoken summary
    assert_accessible(body["spoken"])


# --------------------------------------------------------------------------- #
# KM-E2E-004 - teacher cohort alerts
# --------------------------------------------------------------------------- #
async def test_km_e2e_004_cohort_alerts(client, teacher_factory, auth_headers) -> None:  # type: ignore[no-untyped-def]
    _tid, tok = await teacher_factory()
    r = await client.get("/analytics/cohort/alerts", headers=auth_headers(tok))
    assert r.status_code == 200
    body = r.json()
    assert {"alerts", "summary"} <= set(body)
    assert isinstance(body["summary"]["students"], list)


# --------------------------------------------------------------------------- #
# KM-E2E-005 - RAG-grounded answer
# --------------------------------------------------------------------------- #
async def test_km_e2e_005_rag_grounded(client, student_factory, concept_ids, auth_headers) -> None:  # type: ignore[no-untyped-def]
    sid, tok = await student_factory()
    hdr = auth_headers(tok)

    # Retrieval is a teacher tool now, so a student token must be turned away.
    ret = await client.post(
        "/content/retrieve",
        headers=hdr,
        json={"query": "apa definisi pecahan menurut modul", "top_k": 4, "language": "id"},
    )
    assert ret.status_code == 403

    ans = await client.post(
        "/chat/message", headers=hdr, json={"text": "menurut modul, apa definisi pecahan?"}
    )
    assert ans.status_code == 200
    assert_accessible(ans.json()["text"])


# --------------------------------------------------------------------------- #
# KM-E2E-006 - meta voice commands mid-session
# --------------------------------------------------------------------------- #
async def test_km_e2e_006_meta_commands(client, student_factory, auth_headers) -> None:  # type: ignore[no-untyped-def]
    sid, tok = await student_factory()
    hdr = auth_headers(tok)

    stop = await client.post("/chat/message", headers=hdr, json={"text": "berhenti"})
    assert stop.status_code == 200
    assert stop.json()["text"].strip()

    helpr = await client.post("/chat/message", headers=hdr, json={"text": "bantuan"})
    assert helpr.status_code == 200

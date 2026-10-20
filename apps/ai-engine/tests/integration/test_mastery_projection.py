"""Effective mastery reads and evidence-only writes on isolated PostgreSQL."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from analytics.aggregator import StudentAggregator
from analytics.student_model import StudentModel
from api.routes.student import my_profile
from database.models import MasteryScore
from database.session import async_session
from memory.long_term import fetch_weak_concepts, load_profile

pytestmark = [pytest.mark.integration, pytest.mark.db, pytest.mark.asyncio(loop_scope="session")]


async def test_legacy_tutor_mastery_is_not_promoted_to_public_dashboard(
    db_session, make_student, concept_ids, seed_mastery
):
    student = await make_student()
    concept = concept_ids["pecahan"]
    stale = datetime.now(UTC) - timedelta(days=30, seconds=2)
    await seed_mastery(student.id, {concept: 0.8}, last_seen=stale)
    model = await StudentModel.load(str(student.id))
    profile = await load_profile(student.id)
    summary = await StudentAggregator().summarise(
        student_id=student.id, window="all", include_recommendations=False
    )
    self_profile = await my_profile(student, db_session)
    assert model.overall_mastery() == pytest.approx(0.65)
    assert profile["mastery"][str(concept)] == pytest.approx(0.65)
    # MasteryScore is a mixed legacy snapshot: formal assignment evidence can
    # live there before its teacher-controlled release. Public progress must
    # wait for visible MasteryEvent evidence instead of exposing this row.
    assert summary["mastery_available"] is False
    assert summary["overall_mastery"] == 0
    assert summary["weak_concepts"] == []
    assert summary["concept_evidence"] == []
    assert self_profile["overall_mastery"] == 0
    assert self_profile["mastery"] == {}
    assert self_profile["weak_concepts"] == []
    async with async_session() as session:
        row = await session.scalar(
            select(MasteryScore).where(MasteryScore.student_id == student.id)
        )
        assert row.mastery == 0.8  # Reading does not rewrite the evidence.


async def test_weak_concepts_are_ranked_after_inactivity_adjustment(
    make_student, concept_ids, seed_mastery
):
    student = await make_student()
    old, recent = list(concept_ids.values())[:2]
    await seed_mastery(
        student.id, {old: 0.9}, last_seen=datetime.now(UTC) - timedelta(days=90, seconds=2)
    )
    await seed_mastery(student.id, {recent: 0.6})
    weak = await fetch_weak_concepts(student.id, n=1)
    assert len(weak) == 1
    assert weak[0]["concept_id"] == str(old)
    assert weak[0]["mastery"] == pytest.approx(0.45)


async def test_read_only_legacy_persist_does_not_rewrite_old_evidence(
    make_student, concept_ids, seed_mastery
):
    student = await make_student()
    concept = concept_ids["pecahan"]
    stale = datetime.now(UTC) - timedelta(days=30, seconds=2)
    await seed_mastery(student.id, {concept: 0.8}, n_attempts=8, last_seen=stale)
    model = await StudentModel.load(str(student.id))
    await model.persist()
    async with async_session() as session:
        row = await session.scalar(
            select(MasteryScore).where(MasteryScore.student_id == student.id)
        )
        assert row.mastery == 0.8
        assert row.n_attempts == 8
        assert row.last_seen == stale
    reloaded = await StudentModel.load(str(student.id))
    assert reloaded.overall_mastery() == pytest.approx(0.65)


async def test_practicing_other_concept_preserves_inactive_concept_evidence(
    make_student, concept_ids, seed_mastery
):
    student = await make_student()
    old, practiced = list(concept_ids.values())[:2]
    stale = datetime.now(UTC) - timedelta(days=30, seconds=2)
    await seed_mastery(student.id, {old: 0.8}, n_attempts=8, last_seen=stale)
    model = await StudentModel.load(str(student.id))
    model.update(str(practiced), 1.0)
    await model.persist()
    await model.persist()
    async with async_session() as session:
        rows = {
            row.concept_id: row
            for row in await session.scalars(
                select(MasteryScore).where(MasteryScore.student_id == student.id)
            )
        }
        assert rows[old].mastery == 0.8
        assert rows[old].n_attempts == 8
        assert rows[old].last_seen == stale
        assert rows[practiced].mastery == pytest.approx(0.6125)
        assert rows[practiced].n_attempts == 1
    reloaded = await StudentModel.load(str(student.id))
    assert (await reloaded.mastery_scores())[str(old)] == pytest.approx(0.65)


async def test_practicing_stale_concept_starts_new_evidence_clock(
    make_student, concept_ids, seed_mastery
):
    student = await make_student()
    concept = concept_ids["pecahan"]
    await seed_mastery(
        student.id,
        {concept: 0.8},
        n_attempts=8,
        last_seen=datetime.now(UTC) - timedelta(days=30, seconds=2),
    )
    model = await StudentModel.load(str(student.id))
    model.update(str(concept), 1.0)
    await model.persist()
    reloaded = await StudentModel.load(str(student.id))
    assert reloaded.overall_mastery() == pytest.approx(0.72875)
    assert reloaded._attempts[str(concept)] == 9
    assert (datetime.now(UTC) - reloaded._last_practiced[str(concept)]).total_seconds() < 5

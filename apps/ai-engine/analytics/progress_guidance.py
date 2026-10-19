"""Derive permitted facts and targets before consulting any model."""

import hashlib
import json
import re
import uuid
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from analytics.progress_projection import aware, public_progress
from api.learning_progress import canonical_manifest
from api.learning_service import learning_units
from database.models import ClassMaterial
from models.progress_guidance import GuidanceSnapshot, PlanCandidate, ProgressFact, ProgressInsight


def substantive(text):
    cleaned = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    cleaned = re.sub(r"^\s*#+.*$", "", cleaned, flags=re.M)
    words = re.findall(r"\w+", cleaned.casefold())
    return len(words) >= 35 and len(set(words)) >= 15


async def build_guidance_snapshot(session, *, student, timezone: str) -> GuidanceSnapshot:
    ZoneInfo(timezone)
    now = datetime.now(UTC)
    start = now - timedelta(days=30)
    public, outcomes = await public_progress(session, student.id, start=start, include_events=True)
    recent = [e for e in public.pop("_visible_events") if aware(e["at"]) >= start]
    facts = [
        ProgressFact(
            fact_id="coverage",
            kind="coverage",
            data={
                "assessed_concepts": public["assessed_concepts"],
                "mapped_concepts": public["mapped_concepts"],
                "unmapped_materials": public["unmapped_materials"],
                "materials_completed": public["materials_completed"],
            },
        )
    ]
    facts.append(
        ProgressFact(
            fact_id="practice_activity",
            kind="practice_activity",
            data={
                "question_count": len(outcomes),
                "mean_first_score": round(sum(o.first_score for o in outcomes) / len(outcomes), 3)
                if outcomes
                else None,
                "outcome_hash": hashlib.sha256(
                    json.dumps(
                        sorted((str(o.id), o.first_score, o.status) for o in outcomes)
                    ).encode()
                ).hexdigest(),
            },
        )
    )
    concepts = {}
    for concept in sorted(public["concept_evidence"], key=lambda c: c["concept_id"])[:30]:
        events = [e for e in recent if e["concept_id"] == concept["concept_id"]]
        count, sessions = (
            len({e["question_id"] for e in events}),
            len({e["session_id"] for e in events}),
        )
        enough = count >= 3 and sessions >= 2
        kind = (
            "strong_concept"
            if enough and concept["mastery"] >= 0.8
            else "practice_concept"
            if enough and concept["mastery"] < 0.6
            else "initial_evidence"
        )
        cid = concept["concept_id"]
        concepts[cid] = kind
        facts.append(
            ProgressFact(
                fact_id=f"concept:{cid}",
                kind=kind,
                data={
                    "concept_id": cid,
                    "concept_name": concept["concept_name"],
                    "mastery": concept["mastery"],
                    "question_count": count,
                    "session_count": sessions,
                    "enough_evidence": enough,
                },
            )
        )
    candidates = []
    for row in sorted(
        public["learning_materials"], key=lambda m: (m["status"] != "in_progress", m["id"])
    )[:20]:
        material = await session.get(ClassMaterial, uuid.UUID(row["id"]))
        ready = (
            material.rag_status == "ready"
            and material.content_version == material.indexed_version
            and material.mapping_version == material.indexed_mapping_version
            and material.n_chunks > 0
        )
        units = learning_units(material.content)
        good = [i for i, u in enumerate(units) if substantive(u["text"])]
        ready = ready and bool(good)
        fact_id = f"material:{material.id}"
        facts.append(
            ProgressFact(
                fact_id=fact_id,
                kind="material_progress" if ready else "source_issue",
                data={
                    **row,
                    "mapping_version": material.mapping_version,
                    "ready": ready,
                    "quality": "ready" if ready else "needs_source_review",
                },
            )
        )
        if not ready:
            continue
        manifest = canonical_manifest(material)
        # Use the next substantive canonical unit. A review target never becomes full completion.
        next_index = min(row["completed_units"], len(units) - 1)
        index = next((i for i in good if i >= next_index), good[0])
        cid = next((c for c in row["concept_ids"] if concepts.get(c) == "practice_concept"), None)
        strong_id = next(
            (c for c in row["concept_ids"] if concepts.get(c) == "strong_concept"), None
        )
        choices = [
            ("review_unit", 0 if row["status"] == "in_progress" else 2 if cid else 3),
            ("practice", 1 if not any(c in concepts for c in row["concept_ids"]) else 2),
        ]
        if strong_id and not cid:
            choices.append(("self_explain", 3))
        for kind, priority in choices:
            target_cid = strong_id if kind == "self_explain" else cid
            reason_ids = [fact_id, "coverage"] + ([f"concept:{target_cid}"] if target_cid else [])
            identity = (
                f"{material.id}:{manifest.unit_manifest_hash}:{index}:{kind}:{target_cid or ''}"
            )
            candidates.append(
                PlanCandidate(
                    candidate_id=hashlib.sha256(identity.encode()).hexdigest()[:32],
                    kind=kind,
                    class_id=row["class_id"],
                    material_id=row["id"],
                    material_title=row["title"],
                    concept_id=target_cid,
                    unit_id=manifest.units[index].unit_id,
                    unit_index=index,
                    content_version=material.content_version,
                    mapping_version=material.mapping_version,
                    unit_manifest_hash=manifest.unit_manifest_hash,
                    supported_question_count=0 if kind == "self_explain" else 1,
                    estimated_minutes=3
                    if kind == "practice"
                    else 4
                    if kind == "self_explain"
                    else 5,
                    allowed_reason_fact_ids=reason_ids,
                    priority=priority,
                )
            )
    candidates.sort(key=lambda c: (c.priority, c.material_id, c.kind))
    facts.sort(key=lambda f: f.fact_id)
    payload = {
        "timezone": timezone,
        "policy": "progress-v1",
        "evidence": public["visible_evidence_hash"],
        "facts": [f.model_dump() for f in facts],
        "candidates": [c.model_dump() for c in candidates],
    }
    digest = hashlib.sha256(
        json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()
    return GuidanceSnapshot(
        source_snapshot_hash=digest,
        as_of=now,
        timezone=timezone,
        planning_window={
            "kind": "rolling_30_days",
            "start": start.isoformat(),
            "end": now.isoformat(),
        },
        facts=facts,
        candidates=candidates,
    )


def derive_progress_insights(snapshot: GuidanceSnapshot, *, language="id") -> list[ProgressInsight]:
    english = language == "en"
    insights = []
    coverage = next(f for f in snapshot.facts if f.fact_id == "coverage")
    for fact in snapshot.facts:
        if fact.kind == "source_issue":
            insights.append(
                ProgressInsight(
                    kind="source_issue",
                    fact_ids=[fact.fact_id],
                    title="Source needs review" if english else "Sumber materi perlu ditinjau",
                    body="Ask your teacher to review the material before practising."
                    if english
                    else "Minta guru meninjau sumber materi sebelum berlatih. Ini bukan kekurangan kemampuanmu.",
                )
            )
        elif fact.kind == "practice_concept":
            insights.append(
                ProgressInsight(
                    kind="practice",
                    fact_ids=[fact.fact_id],
                    title="Practise one concept" if english else "Perkuat satu konsep",
                    body=(
                        f"Review {fact.data['concept_name']}, then answer a short check."
                        if english
                        else f"Ulangi konsep {fact.data['concept_name']}, lalu coba latihan singkat."
                    ),
                )
            )
    if coverage.data["unmapped_materials"]:
        insights.append(
            ProgressInsight(
                kind="unmapped",
                fact_ids=["coverage"],
                title="Activity is still recorded" if english else "Aktivitasmu tetap tercatat",
                body="Some materials have no approved concept mapping yet. Their practice does not measure concept mastery."
                if english
                else "Sebagian materi belum dipetakan ke konsep. Latihannya tetap tercatat, tetapi belum menilai penguasaan konsep.",
            )
        )
    if not coverage.data["assessed_concepts"]:
        insights.append(
            ProgressInsight(
                kind="baseline",
                fact_ids=["coverage"],
                title="Start with a short check" if english else "Mulai dari cek pemahaman",
                body="A short practice will collect initial evidence. No concept score is assumed."
                if english
                else "Latihan singkat membantu mengumpulkan bukti awal. Belum ada nilai konsep yang diasumsikan.",
            )
        )
    elif not any(f.kind in {"practice_concept", "strong_concept"} for f in snapshot.facts):
        insights.append(
            ProgressInsight(
                kind="initial_evidence",
                fact_ids=["coverage"],
                title="Early learning evidence" if english else "Data belajar masih awal",
                body="More independent questions across sessions are needed before labelling strengths or weaknesses."
                if english
                else "Perlu beberapa soal mandiri dari sesi berbeda sebelum menyimpulkan konsep kuat atau lemah.",
            )
        )
    return insights[:3]

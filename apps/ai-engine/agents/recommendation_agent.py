"""
KODMOD AI - Recommendation Agent
=================================

Sits at the end of the Analytics cluster. Translates raw analytics into
concrete, actionable next steps spoken to the student (and surfaced on the
teacher dashboard).

Recommendations always come in three flavors:

1. **Next lesson** - what to learn NOW, based on weak concepts + prerequisites.
2. **Practice exercise** - a Content cluster handle the system can call
   directly.
3. **Habit nudge** - encouragement / pacing advice keyed to engagement_index
   and streak_days.

The agent is intentionally conservative: it suggests at most 3 actions per
turn so the audio output stays digestible.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from graphs.state import AnalyticsSummary, KODMODState
from tools.llm_client import get_recommendation_llm, language_instruction

log = logging.getLogger(__name__)


SYSTEM_PROMPT = """\
You are KODMOD's Recommendation Agent. Given a student's analytics summary,
produce 1 to 3 concrete next-step recommendations that will be SPOKEN to a
visually impaired student.

CONSTRAINTS
- Each recommendation: ≤ 18 spoken words.
- Mix: at most one "next lesson", at most one "practice exercise", at most
  one "habit nudge".
- Use second person ("kamu" in Indonesian, "you" in English).
- Friendly, never demanding. Acknowledge effort.

OUTPUT - JSON ONLY:
{
  "recommendations": [
    {"type": "next_lesson|practice|habit", "text": "...", "concept_id": "..."},
    ...
  ],
  "spoken_intro": "1 short sentence to lead into the list"
}
"""


async def recommendation_node(state: KODMODState) -> dict[str, Any]:
    if (
        state.get("assessment_managed")
        and state.get("presentation_context", "session") == "session"
    ):
        return {
            "generated_response": state.get("generated_response", ""),
            "next_action": "accessibility_polish",
            "last_node": "recommendation",
        }
    summary = state.get("analytics_summary", {})
    profile = state.get("learning_profile", {})
    language = profile.get("language", "id")

    user_block = (
        f"Language: {language}\n"
        f"Analytics: {json.dumps(summary, ensure_ascii=False)}\n"
        f"Recent emotional state: {state.get('emotional_state', 'neutral')}\n"
        f"Misconceptions: {state.get('misconceptions_detected', [])}\n"
    )

    llm = get_recommendation_llm()
    response = await llm.ainvoke(
        [
            {
                "role": "system",
                "content": SYSTEM_PROMPT
                + language_instruction(state.get("learning_profile", {}).get("language")),
            },
            {"role": "user", "content": user_block},
        ]
    )
    raw = response.content if hasattr(response, "content") else str(response)

    try:
        cleaned = (
            raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        )
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        log.warning("Recommendation JSON parse failed; using fallback")
        parsed = _fallback(summary)

    recs = _normalize_recs(parsed.get("recommendations", []))
    intro = parsed.get("spoken_intro", "Inilah rekomendasi untukmu.").strip()
    rec_texts = [r["text"].strip() for r in recs if r.get("text")]

    # Build clean structured response with paragraph and line breaks
    parts: list[str] = []
    base_response = state.get("generated_response", "").strip()
    if base_response:
        parts.append(base_response)
    if intro:
        parts.append(intro)
    if rec_texts:
        parts.append("\n".join(f"{i + 1}. {t}" for i, t in enumerate(rec_texts)))

    formatted_response = "\n\n".join(parts)

    log.info("Generated %d recommendations", len(recs))

    return {
        "recommendations": [r.get("text", "") for r in recs],
        "analytics_summary": {
            **summary,
            "structured_recommendations": recs,
        },
        "generated_response": formatted_response.strip(),
        "next_action": "accessibility_polish",
        "last_node": "recommendation",
    }


def recommendations_from_plan(plan, snapshot, language="id"):
    from urllib.parse import urlencode

    from models.progress_guidance import RecommendationView

    candidates = {c.candidate_id: c for c in snapshot.candidates}
    facts = {f.fact_id: f for f in snapshot.facts}
    english = language == "en"
    views = []
    for candidate_id in plan.step_candidate_ids:
        candidate = candidates[candidate_id]
        review = candidate.kind == "review_unit"
        title = (
            ("Review one section" if review else "Check your understanding")
            if english
            else ("Pelajari satu bagian" if review else "Cek pemahamanmu")
        )
        if candidate.kind == "self_explain":
            title = "Explain in your own words" if english else "Jelaskan dengan kata-katamu"
        body = f"{candidate.material_title} — {'section' if english else 'bagian'} {candidate.unit_index + 1}."
        supporting = [
            facts[f]
            for f in candidate.allowed_reason_fact_ids
            if f in plan.reason_fact_ids and f in facts
        ]
        resume = any(
            f.kind == "material_progress" and f.data.get("status") == "in_progress"
            for f in supporting
        )
        weak = any(f.kind == "practice_concept" for f in supporting)
        reason = (
            (
                "Continue material you already started."
                if resume
                else "Independent answers support a short concept review."
                if weak
                else "This available material can provide initial learning evidence."
            )
            if english
            else (
                "Lanjutkan materi yang sudah kamu mulai."
                if resume
                else "Jawaban mandiri mendukung latihan ulang konsep ini."
                if weak
                else "Materi yang tersedia ini membantu mengumpulkan bukti belajar awal."
            )
        )
        if candidate.kind == "self_explain":
            reason = (
                "Use the source to explain your understanding in your own words."
                if english
                else "Gunakan sumber ini untuk menjelaskan pemahamanmu dengan kata-katamu sendiri."
            )
        views.append(
            RecommendationView(
                candidate_id=candidate_id,
                title=title,
                body=body,
                reason_text=reason,
                estimated_minutes=candidate.estimated_minutes,
                href=f"/siswa/{'latihan' if candidate.kind == 'practice' else 'tutor'}?"
                + urlencode({"class_id": candidate.class_id, "material_id": candidate.material_id}),
            )
        )
    return views


def _normalize_recs(raw: Any) -> list[dict[str, Any]]:
    """Coerce ``recommendations`` into ``{type, text, concept_id}`` dicts.

    The LLM (or a stub) may hand back either a list of objects or a plain list
    of strings - tolerate both so the analytics turn never 500s.
    """
    out: list[dict[str, Any]] = []
    for r in raw or []:
        if isinstance(r, str):
            out.append({"type": "habit", "text": r, "concept_id": ""})
        elif isinstance(r, dict):
            out.append(
                {
                    "type": r.get("type", "habit"),
                    "text": r.get("text", ""),
                    "concept_id": r.get("concept_id", ""),
                }
            )
    return out


# ---------------------------------------------------------------------------
# Fallback
# ---------------------------------------------------------------------------


def _fallback(summary: AnalyticsSummary) -> dict:
    weak = summary.get("weak_concepts", [])
    if weak:
        return {
            "recommendations": [
                {
                    "type": "practice",
                    "text": f"Lanjutkan dengan beberapa latihan singkat tentang {weak[0]}.",
                    "concept_id": weak[0],
                }
            ],
            "spoken_intro": "Saran cepat untukmu:",
        }
    return {
        "recommendations": [
            {"type": "habit", "text": "Pertahankan ritme belajarmu hari ini.", "concept_id": ""},
        ],
        "spoken_intro": "Kerja bagus.",
    }

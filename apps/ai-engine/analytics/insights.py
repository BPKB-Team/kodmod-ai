"""
KODMOD AI - Insight Generation
==============================

Converts raw analytics rollups into:

1. A short, spoken-friendly summary in the selected language for the student.
2. Actionable insights for the teacher dashboard.
3. Suggestions consumed by the Recommendation Agent.

This is deliberately rule-based first, with an optional LLM polish pass
when `use_llm=True`. Rule-based generation is deterministic, fast, and
matches the "voice-first" latency budget - LLM polish is reserved for
weekly digests where users will tolerate a couple-second delay.
"""

from __future__ import annotations

import logging

from langchain_core.messages import HumanMessage, SystemMessage

from tools.llm_client import get_recommendation_llm, language_instruction

logger = logging.getLogger(__name__)


# --------------------------------------------------------------- helpers --
def _pct(x: float, language: str = "id") -> str:
    return f"{round(x * 100)} {'percent' if language == 'en' else 'persen'}"


def _format_concept_list(
    items: list[dict], key: str = "concept_name", n: int = 3, *, language: str = "id"
) -> str:
    if not items:
        return "none yet" if language == "en" else "belum ada"
    names = [
        i.get(key) or ("unnamed concept" if language == "en" else "konsep tanpa nama")
        for i in items[:n]
    ]
    if len(names) == 1:
        return names[0]
    return ", ".join(names[:-1]) + f", {'and' if language == 'en' else 'dan'} {names[-1]}"


def _period(analytics: dict, language: str) -> str:
    periods = (
        {
            "today": "Today",
            "week": "In the past 7 days",
            "month": "In the past 30 days",
            "all": "So far",
        }
        if language == "en"
        else {
            "today": "Hari ini",
            "week": "Dalam 7 hari terakhir",
            "month": "Dalam 30 hari terakhir",
            "all": "Sejauh ini",
        }
    )
    return periods.get(analytics.get("window", "week"), periods["week"])


# ------------------------------------------------- student-facing summary --
def generate_student_spoken_summary(analytics: dict, *, language: str = "id") -> str:
    """Produces a deterministic audio-friendly summary in Indonesian or English."""
    english = language == "en"
    if analytics.get("error"):
        return (
            "Your progress data is not available yet."
            if english
            else "Maaf, data analitik belum tersedia."
        )

    name = (analytics.get("student_name") or ("there" if english else "kamu")).split()[0]
    n_sessions = analytics.get("n_sessions", 0)
    accuracy = analytics.get("quiz_accuracy", 0.0)
    overall = analytics.get("overall_mastery", 0.0)
    weak = analytics.get("weak_concepts", [])
    strong = analytics.get("strong_concepts", [])

    parts: list[str] = []
    parts.append(f"Hello {name}." if english else f"Halo {name}.")
    period = _period(analytics, language)

    if n_sessions == 0 and not analytics.get("n_quiz_attempts", 0):
        parts.append(
            f"{period}, you have no learning activity yet. Let's get started!"
            if english
            else f"{period} kamu belum belajar sama sekali. Mari mulai sekarang!"
        )
        return " ".join(parts)

    if weak or strong:
        parts.append(
            f"{period}, you completed {n_sessions} learning sessions with average mastery of {_pct(overall, language)}."
            if english
            else f"{period} kamu sudah belajar {n_sessions} sesi dengan tingkat penguasaan rata-rata {_pct(overall)}."
        )
    else:
        if n_sessions:
            parts.append(
                f"{period}, you completed {n_sessions} learning sessions."
                if english
                else f"{period} kamu tercatat belajar {n_sessions} sesi."
            )
        else:
            parts.append(
                f"{period}, your practice answers have been recorded."
                if english
                else f"{period} jawaban latihanmu sudah tercatat."
            )
        parts.append(
            "Concept mastery will appear when practice is linked to approved concepts."
            if english
            else "Penguasaan konsep akan tampil setelah latihan dikaitkan dengan konsep yang disetujui."
        )

    if accuracy >= 0.8:
        parts.append(
            f"Your quiz and assignment accuracy is excellent at {_pct(accuracy, language)}. Keep it up!"
            if english
            else f"Akurasi kuis dan tugas kamu sangat baik di {_pct(accuracy)}. Pertahankan!"
        )
    elif accuracy >= 0.6:
        parts.append(
            f"Your quiz and assignment accuracy is {_pct(accuracy, language)}. Keep practising."
            if english
            else f"Akurasi kuis dan tugas kamu {_pct(accuracy)}. Teruskan latihan."
        )
    elif accuracy > 0 or analytics.get("n_quiz_attempts", 0):
        parts.append(
            f"Your quiz and assignment accuracy is {_pct(accuracy, language)}. We will work on this together."
            if english
            else f"Akurasi kuis dan tugas kamu masih {_pct(accuracy)}. Jangan khawatir, kita akan kerjakan bersama."
        )

    if strong:
        names = _format_concept_list(strong, language=language)
        parts.append(f"Your strengths are {names}." if english else f"Kamu sudah kuat di {names}.")
    if weak:
        names = _format_concept_list(weak, language=language)
        parts.append(
            f"Let's practise {names} next."
            if english
            else f"Yang masih perlu kita perdalam: {names}."
        )

    return " ".join(parts)


# ----------------------------------------------- teacher-facing summary --
def generate_teacher_summary(analytics: dict, *, language: str = "id") -> dict:
    """Produces a structured summary plus 1-3 alert lines."""
    english = language == "en"
    if analytics.get("error"):
        return {
            "alerts": [],
            "headline": "Data is unavailable." if english else "Data tidak tersedia.",
        }

    alerts: list[dict] = []
    student_name = analytics.get("student_name") or ("Student" if english else "Siswa")

    accuracy = analytics.get("quiz_accuracy", 0.0)
    n_attempts = analytics.get("n_quiz_attempts", 0)
    engagement = analytics.get("engagement_index", 0.0)
    miscons = analytics.get("open_misconceptions", [])

    if n_attempts >= 3 and accuracy < 0.5:
        alerts.append(
            {
                "level": "warning",
                "title": f"{student_name}: low accuracy"
                if english
                else f"{student_name}: akurasi rendah",
                "detail": (
                    f"Accuracy is {int(accuracy * 100)}% across {n_attempts} answers. Consider individual support or targeted practice."
                    if english
                    else f"Akurasi {int(accuracy * 100)}% dari {n_attempts} jawaban. Disarankan sesi 1:1 atau remediasi terarah."
                ),
            }
        )

    if engagement < 0.2 and analytics.get("n_sessions", 0) <= 1:
        alerts.append(
            {
                "level": "warning",
                "title": f"{student_name}: low engagement"
                if english
                else f"{student_name}: keterlibatan rendah",
                "detail": "Few learning sessions recorded. Check in with this student."
                if english
                else "Sesi belajar masih sedikit. Periksa kebutuhan pendampingan siswa.",
            }
        )

    if miscons:
        alerts.append(
            {
                "level": "info",
                "title": f"{student_name}: {len(miscons)} misconceptions detected"
                if english
                else f"{student_name}: {len(miscons)} miskonsepsi terdeteksi",
                "detail": "; ".join(m["description"] for m in miscons[:3]),
            }
        )

    if not alerts and analytics.get("overall_mastery", 0) >= 0.85:
        alerts.append(
            {
                "level": "success",
                "title": f"{student_name}: strong mastery"
                if english
                else f"{student_name}: penguasaan kuat",
                "detail": "Consider more challenging materials."
                if english
                else "Pertimbangkan materi tantangan tingkat lanjut.",
            }
        )

    mastery = int(analytics.get("overall_mastery", 0) * 100)
    period = _period(analytics, language).lower()
    headline = (
        f"{student_name}: mastery {mastery}%, quiz accuracy {int(accuracy * 100)}%, {analytics.get('n_sessions', 0)} sessions {period}."
        if english
        else f"{student_name}: penguasaan {mastery}%, akurasi kuis {int(accuracy * 100)}%, {analytics.get('n_sessions', 0)} sesi {period}."
    )
    return {"headline": headline, "alerts": alerts}


# --------------------------------------------------- cohort-level alerts --
def generate_cohort_alerts(cohort_summary: dict, *, language: str = "id") -> list[dict]:
    """Alerts spanning every student, shown at the top of the teacher dashboard."""
    english = language == "en"
    if cohort_summary.get("error"):
        return []
    alerts: list[dict] = []
    weak = cohort_summary.get("cohort_weak_concepts", [])
    if weak and weak[0]["avg_mastery"] < 0.5:
        alerts.append(
            {
                "level": "warning",
                "title": f"Needs practice: {weak[0]['concept_name']}"
                if english
                else f"Konsep lemah: {weak[0]['concept_name']}",
                "detail": (
                    f"Average mastery is {int(weak[0]['avg_mastery'] * 100)}% across {weak[0]['n_students']} students. Consider teaching this topic again."
                    if english
                    else f"Rata-rata penguasaan hanya {int(weak[0]['avg_mastery'] * 100)}% pada {weak[0]['n_students']} siswa. Pertimbangkan mengajarkan ulang materi ini."
                ),
            }
        )
    if cohort_summary.get("avg_engagement_index", 0) < 0.3:
        alerts.append(
            {
                "level": "info",
                "title": "Low engagement" if english else "Keterlibatan rendah",
                "detail": "The average learning activity is low. Check which students need support."
                if english
                else "Rata-rata sesi per siswa di bawah ambang sehat.",
            }
        )
    return alerts


# ----------------------------------------------------------- LLM polish --
async def generate_insights(
    analytics: dict,
    *,
    audience: str = "student",
    use_llm: bool = False,
    language: str = "id",
) -> dict:
    """
    audience: 'student' | 'teacher'
    Returns: {"spoken": str, "structured": dict}
    """
    if audience == "teacher":
        structured = generate_teacher_summary(analytics, language=language)
        spoken = structured["headline"]
    else:
        structured = {"summary": generate_student_spoken_summary(analytics, language=language)}
        spoken = structured["summary"]

    if not use_llm:
        return {"spoken": spoken, "structured": structured}

    # Optional LLM polish for weekly digests.
    try:
        llm = get_recommendation_llm()
        sys = (
            "Anda adalah pendidik yang ramah. Polish ringkasan berikut agar "
            "lebih hangat dan memotivasi. Jangan tambahkan informasi baru. "
            "Maksimum 3 kalimat. JANGAN gunakan markdown."
            if language == "id"
            else "You are a warm educator. Polish the following summary to be more "
            "encouraging. Add no new information. Maximum 3 sentences. No markdown."
        )
        sys += language_instruction(language)
        resp = await llm.ainvoke([SystemMessage(content=sys), HumanMessage(content=spoken)])
        polished = resp.content if hasattr(resp, "content") else str(resp)
        return {"spoken": polished.strip(), "structured": structured}
    except Exception as exc:  # pragma: no cover
        logger.warning("LLM polish failed, returning rule-based: %s", exc)
        return {"spoken": spoken, "structured": structured}

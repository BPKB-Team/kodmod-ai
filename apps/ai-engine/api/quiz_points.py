"""Presentation points are independent of normalized grading and mastery evidence."""

import math
from decimal import ROUND_HALF_UP, Decimal

from models.quiz import ScoreSummary


def points_for_score(score: float) -> int:
    if not math.isfinite(score) or not 0 <= score <= 1:
        raise ValueError("Score must be finite and between zero and one")
    return int((Decimal(str(score)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def build_score_summary(outcomes, *, total_questions: int) -> ScoreSummary:
    if total_questions < len(outcomes):
        raise ValueError("More outcomes than questions")
    return ScoreSummary(
        points_earned=sum(points_for_score(o.first_score) for o in outcomes),
        points_possible=total_questions * 100,
        answered_questions=sum(o.status == "answered" for o in outcomes),
        total_questions=total_questions,
        skipped_questions=sum(o.status == "skipped" for o in outcomes),
        assisted_questions=sum(o.assisted for o in outcomes),
    )


def session_result_text(summary: ScoreSummary, *, language: str) -> str:
    if language == "en":
        return f"Practice complete. You earned {summary.points_earned} of {summary.points_possible} points. {summary.answered_questions} answered, {summary.skipped_questions} skipped."
    return f"Latihan selesai. Kamu memperoleh {summary.points_earned} dari {summary.points_possible} poin. {summary.answered_questions} soal dijawab, {summary.skipped_questions} dilewati."

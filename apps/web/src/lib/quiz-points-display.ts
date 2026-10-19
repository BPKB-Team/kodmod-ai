import type { ScoreSummary } from "./quiz-types";
import type { MaterialLearningProgress } from "./class-types";

export function quizPointsLabel(summary: ScoreSummary, language: "id" | "en" = "id") {
  return `${summary.points_earned} / ${summary.points_possible} ${language === "en" ? "points" : "poin"}`;
}

export function legacyItemPointsLabel(score: number, language: "id" | "en" = "id") {
  const points = Math.floor(Math.max(0, Math.min(1, score)) * 100 + .5 + 1e-9);
  return `${points} / 100 ${language === "en" ? "points" : "poin"}`;
}

export function materialLearningLabel(progress: MaterialLearningProgress | null | undefined, language: "id" | "en" = "id") {
  if (progress?.status === "completed") return language === "en" ? "Completed with Tutor" : "Selesai bersama Tutor";
  if (progress?.status === "in_progress") return `${progress.completed_units} / ${progress.total_units} ${language === "en" ? "sections completed" : "bagian selesai"}`;
  return language === "en" ? "Not started with Tutor" : "Belum mulai bersama Tutor";
}

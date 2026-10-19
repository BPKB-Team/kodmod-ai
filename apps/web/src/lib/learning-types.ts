import type { QuizRecoveryResponse } from "./quiz-types";
import type { MaterialLearningProgress } from "./class-types";

export type LearningSession = {
  scope?: "full_material" | "planned_review" | "self_explain";
  learning_progress?: MaterialLearningProgress | null;
  session_id: string;
  revision: number;
  phase: "learning" | "quiz" | "completed";
  class_id: string;
  material_id: string;
  material_title: string;
  subject: string;
  source_filename: string | null;
  language: "id" | "en";
  unit_index: number;
  total_units: number;
  unit_title: string | null;
  unit_titles: (string | null)[];
  text: string;
  available_actions: string[];
  quiz: QuizRecoveryResponse | null;
};

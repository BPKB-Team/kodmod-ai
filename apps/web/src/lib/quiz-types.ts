export type QuizQuestion = {
  question_id: string;
  order_index: number;
  question: string;
  question_type: "mcq" | "spoken" | "explain" | "reasoning" | "step_by_step";
  options: string[];
  difficulty: string;
};

export type QuizActionRequest = { action_id:string; question_id:string; action:"hint"|"advance" };
export type QuizInteractionView = {
  policy_version?: 1|2;
  question_state?: "answering"|"review"|"complete";
  available_actions?: ("answer"|"hint"|"advance")[];
  current_question?: QuizQuestion|null;
  review_question?: QuizQuestion|null;
  last_review?: string|null;
  hint_text?: string|null;
};

export type QuizStartResponse = QuizInteractionView & {
  quiz_session_id: string;
  first_question: QuizQuestion;
  total_questions: number;
};

export type QuizSubmitRequest = {
  submission_id: string;
  quiz_session_id: string;
  question_id: string;
  student_answer: string;
  response_latency_ms?: number;
};

export type QuizSubmitResponse = QuizInteractionView & {
  score: number;
  is_correct: boolean;
  feedback: string;
  next_question: QuizQuestion | null;
  quiz_complete: boolean;
  final_summary: string | null;
  cumulative_score: number;
};

export type QuizRecoveryResponse = QuizInteractionView & {
  quiz_session_id: string;
  kind: "assessment" | "tutor";
  status: "in_progress" | "completed";
  class_id: string | null;
  material_id: string | null;
  material_title: string | null;
  language: "id" | "en";
  total_questions: number;
  answered_questions: number;
  current_question: QuizQuestion | null;
  last_result: QuizSubmitResponse | null;
  started_at: string;
};

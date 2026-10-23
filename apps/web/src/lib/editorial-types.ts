import type { ScoreSummary } from "./quiz-types";
export type Option = { id: string; label: string };
export type StudentQuestion = {
  id: string;
  order_index: number;
  prompt: string;
  narration: string;
  options: Option[];
  concept_id: string | null;
};
export type EditableQuestion = Omit<StudentQuestion, "id"> & {
  correct_option_id: string;
  explanation: string;
  difficulty: "easy" | "medium" | "hard";
};
export type StaffQuestion = EditableQuestion & { id: string };
export type QuizSummary = {
  id: string;
  title: string;
  description?: string;
  current_version: number;
  state: string;
  owner_name?: string;
  version_id: string;
  review_revision: number;
};
export type Subject = { id: string; name: string };
export type Reviewer = { id: string; full_name: string };
export type QuizDraft = {
  id: string;
  teacher_id: string;
  current_version: number;
  is_archived: boolean;
  version: {
    id: string;
    version: number;
    subject_id: string;
    title: string;
    description: string;
    state: string;
    reviewer_id: string | null;
    review_revision: number;
    release_policy: "after_submission" | "after_due";
    questions: StaffQuestion[];
  };
  events: {
    kind: string;
    note: string;
    actor_id: string;
    created_at: string;
  }[];
  assignments: Assignment[];
};
export type Assignment = {
  score_summary?: ScoreSummary | null;
  id: string;
  version_id: string;
  version: number;
  title: string;
  description: string;
  class_id: string;
  class_name: string;
  opens_at: string | null;
  due_at: string | null;
  is_closed: boolean;
  release_policy: string;
  total_questions: number;
  attempt_state: string | null;
  score: number | null;
};
export type AssignmentAttempt = {
  id: string;
  assignment: Assignment;
  revision: number;
  state: string;
  questions: StudentQuestion[];
  answers: Record<string, string>;
};
export type AssignmentResult = {
  score_summary?: ScoreSummary | null;
  attempt_id: string;
  assignment_id: string;
  score: number;
  correct_count: number;
  total_questions: number;
  submitted_at: string;
  feedback_released: boolean;
  review: {
    question_id: string;
    prompt: string;
    options: Option[];
    option_id: string;
    correct_option_id: string;
    is_correct: boolean;
    explanation: string;
  }[];
};
export type TeacherResults = {
  assignment: Assignment;
  enrolled_count: number;
  submitted_count: number;
  average_score: number | null;
  results: {
    student_id: string;
    full_name: string;
    state: string;
    score: number | null;
    submitted_at: string | null;
  }[];
};
export type FinalIntent = { key: string; expected_revision: number };

export const quizState: Record<string, string> = {
  draft: "Draf",
  in_review: "Menunggu peninjauan",
  approved: "Disetujui",
  rejected: "Perlu revisi",
  published: "Terbit",
};
export const eventLabel: Record<string, string> = {
  revision_created: "Revisi disimpan",
  reviewer_nominated: "Peninjau dipilih",
  reviewer_reassigned: "Peninjau diganti oleh admin",
  submitted: "Diajukan untuk peninjauan",
  approved: "Peninjauan disetujui",
  rejected: "Diminta revisi",
  published: "Kuis diterbitkan",
};
export const availabilityLabel = {
  open: "Siap dikerjakan",
  scheduled: "Belum dibuka",
  expired: "Tenggat berlalu",
  closed: "Ditutup",
  submitted: "Selesai",
};
export function scheduleLabel(value: string | null, locale: "id-ID" | "en-US" = "id-ID") {
  return value
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Jakarta",
      }).format(new Date(value)) + " WIB"
    : "Tanpa batas waktu";
}

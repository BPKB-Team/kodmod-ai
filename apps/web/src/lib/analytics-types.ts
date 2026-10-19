export type AnalyticsWindow = "today" | "week" | "month" | "all";

export type AnalyticsConcept = {
  concept_id: string;
  concept_name: string;
  mastery: number;
  n_attempts: number;
};

export type AnalyticsRecommendation = {
  id: string;
  kind: string;
  title: string;
  body: string;
  priority: number;
};

export type StudentAnalytics = {
  mastery_available?: boolean; assessed_concepts?: number; mapped_concepts?: number; unmapped_materials?: number;
  materials_started?: number; materials_completed?: number; completed_units?: number; total_units?: number;
  n_official_questions?: number; n_support_attempts?: number; n_assisted_questions?: number;
  timezone?: string; window_start?: string | null; window_end?: string; last_activity_at?: string | null;
  learning_materials?: Array<{id:string;title:string;status:string;completed_units:number;total_units:number}>;
  duration_kind?: string;

  student_id: string;
  student_name: string;
  window: AnalyticsWindow;
  n_sessions: number;
  total_minutes: number;
  interaction_count: number;
  n_quiz_attempts: number;
  n_practice_answers?: number;
  n_assignment_answers?: number;
  n_assignment_submissions?: number;
  quiz_accuracy: number;
  avg_quiz_score: number;
  overall_mastery: number;
  weak_concepts: AnalyticsConcept[];
  strong_concepts: AnalyticsConcept[];
  open_misconceptions: Array<{
    concept_name: string;
    description: string;
    detected_at: string;
  }>;
  engagement_index: number;
  active_recommendations: AnalyticsRecommendation[];
  generated_at: string;
};

export type StudentAnalyticsSpoken = {
  summary: StudentAnalytics;
  spoken: string;
};

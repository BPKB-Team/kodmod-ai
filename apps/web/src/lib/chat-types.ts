export type ChatSessionSummary = {
  id: string;
  title: string;
  subject_id: string | null;
  subject_name: string | null;
  started_at: string | null;
  ended_at: string | null;
  context?: TutorContext | null;
};

export type TutorContext = {
  class_id: string;
  material_id: string;
  subject_name: string;
  material_title: string;
};

export type TutorSource = {
  source?: string;
  section_title?: string | null;
  score?: number;
  class_id?: string;
  material_id?: string;
  title?: string;
};

export type ChatTurn = {
  role: "student" | "assistant" | "tutor" | "system";
  text: string;
  intent?: string | null;
  timestamp?: string | null;
  sources?: TutorSource[];
  quiz_session_id?: string | null;
};

export type ChatSessionDetail = ChatSessionSummary & {
  turns: ChatTurn[];
};

export type ChatMessageResponse = {
  session_id: string;
  text: string;
  intent: string;
  next_action: string;
  sources: TutorSource[];
  context?: TutorContext | null;
  latency_ms: number;
  quiz_progress: { index: number; total: number } | null;
  quiz_session_id?: string | null;
};

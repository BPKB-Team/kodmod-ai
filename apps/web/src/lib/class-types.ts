import type {MaterialDocument} from "./material-document-types";
export type LearningRole = "teacher" | "student";
export type Classroom = {
  id: string;
  name: string;
  subject: string;
  subject_id?: string | null;
  description: string;
  is_archived: boolean;
  teacher_name: string;
  member_count: number;
  material_count: number;
  created_at: string;
};
export type Material = {
  learning_progress?: MaterialLearningProgress | null;
  progress?: ReadingProgress;
  id: string;
  title: string;
  published: boolean;
  created_at: string;
  content?: string;
  document?:MaterialDocument;
  speech_text?:string;
  ai_readiness?:string;
  extraction_review?:string;
  concept_mapping?:string;
  source_filename?: string | null;
  source_import_id?: string | null;
  rag_status?: "pending" | "processing" | "ready" | "failed";
  rag_error?: string | null;
  n_chunks?: number;
  content_version?: number;
  indexed_version?: number;
  mapping_version?: number;
  indexed_mapping_version?: number;
};
export type MaterialLearningProgress = {
  content_version?: number;
  unit_manifest_hash?: string;
  completed_units: number;
  total_units: number;
  status: "not_started" | "in_progress" | "completed";
  completed_at?: string | null;
  last_activity_at?: string | null;
};
export type ReadingProgress = {
  completed: boolean;
  bookmarked: boolean;
  completed_at: string | null;
};
export type StudentMaterial = Material & {
  class_id: string;
  class_name: string;
  subject: string;
  progress: ReadingProgress;
};
export type ClassDetail = Classroom & {
  materials: Material[];
  members: {
    id: string;
    full_name: string;
    username: string;
    is_active: boolean;
  }[];
};

export type TeacherMaterial = Material & {
  class_id: string;
  class_name: string;
  subject: string;
  is_archived: boolean;
};

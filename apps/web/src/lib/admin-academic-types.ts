export type AdminClass = {
  id: string;
  name: string;
  subject: string;
  subject_id: string | null;
  description: string;
  is_archived: boolean;
  teacher_id: string;
  teacher_name: string;
  teacher_username: string;
  member_count: number;
  material_count: number;
  assignment_count: number;
  created_at: string;
};

export type AdminSubject = {
  id: string;
  name: string;
  description: string | null;
  created_by: string | null;
  creator_name: string | null;
  class_count: number;
  concept_count: number;
  document_count: number;
  quiz_count: number;
  created_at: string;
};

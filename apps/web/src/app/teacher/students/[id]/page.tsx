
import { TeacherStudentDetailView } from "@/components/teacher-student-detail";
import type { TeacherSession, TeacherStudentDetail } from "@/lib/teacher-types";
import { requireSession } from "@/lib/session";
import { backend } from "@/lib/server-api";

type Context = { params: Promise<{ id: string }> };

export default async function TeacherStudentPage({ params }: Context) {
  const { token, user } = await requireSession("teacher");
  const { id } = await params;
  const encoded = encodeURIComponent(id);
  const [detail, sessions] = await Promise.all([
    backend<TeacherStudentDetail>(`/teacher/students/${encoded}?window=month`, token),
    backend<TeacherSession[]>(`/teacher/students/${encoded}/sessions?limit=50`, token),
  ]);

  return (
    <TeacherStudentDetailView key={user.preferred_language} initial={detail} initialSessions={sessions} />
  );
}


import { TeacherAnalytics } from "@/components/teacher-analytics";
import type { TeacherCohort } from "@/lib/teacher-types";
import { requireSession } from "@/lib/session";
import { backend } from "@/lib/server-api";

export default async function TeacherAnalyticsPage() {
  const { token } = await requireSession("teacher");
  const cohort = await backend<TeacherCohort>("/teacher/students?window=week", token);

  return <TeacherAnalytics initial={cohort} />;
}

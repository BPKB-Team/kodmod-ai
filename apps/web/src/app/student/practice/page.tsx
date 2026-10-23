import { notFound } from "next/navigation";

import { UiText } from "@/components/language-provider";
import { StudentQuiz } from "@/components/student-quiz";
import { Heading } from "@/components/ui";
import { requireSession } from "@/lib/session";
import { backend } from "@/lib/server-api";
import type { StudentMaterial } from "@/lib/class-types";
import type { QuizRecoveryResponse } from "@/lib/quiz-types";

export default async function StudentQuizPage({searchParams}:{searchParams:Promise<{session_id?:string}>}) {
  const { token } = await requireSession("student");
  const query = await searchParams;
  if (query.session_id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query.session_id)) notFound();
  const [materials, active] = await Promise.all([
    backend<StudentMaterial[]>("/classes/student/materials", token),
    backend<QuizRecoveryResponse[]>("/quiz/active", token),
  ]);
  const requested = query.session_id ? await backend<QuizRecoveryResponse>(`/quiz/sessions/${query.session_id}`, token) : null;
  if (requested && requested.kind !== "assessment") notFound();
  return (
    <>
      <Heading
        title={<UiText>{"Asesmen mandiri"}</UiText>}
        description={<UiText>{"Cek pemahamanmu satu soal demi satu soal, dengan umpan balik yang mudah diikuti."}</UiText>}
      />
      <StudentQuiz key={query.session_id || "active"} materials={materials} initialSession={requested ?? active[0] ?? null} />
    </>
  );
}

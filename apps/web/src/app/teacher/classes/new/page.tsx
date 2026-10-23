import { UiText } from "@/components/language-provider";
import { Heading } from "@/components/ui";
import { BackToClasses } from "@/components/class-pages";
import { ClassForm } from "@/components/class-forms";
import { backend } from "@/lib/server-api";
import { requireSession } from "@/lib/session";
import type { CurriculumSubject } from "@/lib/concept-types";
import { Sparkles } from "lucide-react";

export default async function Page() {
  const { token } = await requireSession("teacher");
  const subjects = await backend<CurriculumSubject[]>("/subjects", token);
  return (
    <>
      <BackToClasses role="teacher" />
      <Heading
        icon={<Sparkles size={24} aria-hidden="true" />}
        title={<UiText>{"Mulai ruang belajar baru."}</UiText>}
        description={<UiText>{"Beri nama kelas, pilih mata pelajaran, dan ceritakan tujuan belajarnya."}</UiText>}
      />
      <ClassForm subjects={subjects} />
    </>
  );
}

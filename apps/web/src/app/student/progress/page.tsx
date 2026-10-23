
import { UiText } from "@/components/language-provider";
import { ProgressFocus } from "@/components/progress-focus";
import type { GuidanceResponse } from "@/lib/progress-guidance-types";
import { StudentAnalytics } from "@/components/student-analytics";
import { Heading } from "@/components/ui";
import type { StudentAnalyticsSpoken } from "@/lib/analytics-types";
import { requireSession } from "@/lib/session";
import { backend } from "@/lib/server-api";

export default async function StudentProgressPage() {
  const { token, user } = await requireSession("student");
  const [spokenPayload, guidance] = await Promise.all([
    backend<StudentAnalyticsSpoken>("/analytics/me/spoken?window=week", token),
    backend<GuidanceResponse>("/analytics/me/guidance", token),
  ]);

  return (
    <>
      <Heading
        title={<UiText>{"Progres belajar"}</UiText>}
        description={<UiText>{"Lihat pola belajar, kekuatan, dan langkah berikutnya yang paling membantu untukmu."}</UiText>}
      />
      <ProgressFocus
        key={`guidance:${user.preferred_language}`}
        initial={guidance}
        analyticsSpoken={spokenPayload.spoken}
      />
      <StudentAnalytics
        key={user.preferred_language}
        initial={spokenPayload.summary}
        initialSpoken={spokenPayload.spoken}
        hideVoiceCard={true}
      />
    </>
  );
}

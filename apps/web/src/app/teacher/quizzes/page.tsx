import { TeacherQuizIndex } from "@/components/editorial-pages";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string; status?: string }>;
}) {
  const params = await searchParams;
  return <TeacherQuizIndex page={params.page} search={params.search} status={params.status} />;
}

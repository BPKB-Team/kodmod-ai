import { QuizReviewIndex } from "@/components/editorial-pages";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string }>;
}) {
  const params = await searchParams;
  return <QuizReviewIndex role="admin" page={params.page} search={params.search} />;
}

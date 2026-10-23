import { ClassIndex } from "@/components/class-pages";

export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<{ search?: string; status?: string }>;
}) {
  const params = await searchParams;
  return <ClassIndex role="teacher" search={params?.search} status={params?.status} />;
}

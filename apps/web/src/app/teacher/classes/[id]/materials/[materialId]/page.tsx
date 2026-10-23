import { MaterialPage } from "@/components/class-pages";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string; materialId: string }>;
}) {
  const { id, materialId } = await params;
  return <MaterialPage role="teacher" id={id} materialId={materialId} />;
}

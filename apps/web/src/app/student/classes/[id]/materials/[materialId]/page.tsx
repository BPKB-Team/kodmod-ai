import {MaterialPage} from "@/components/class-pages";
import { redirect } from "next/navigation";
export default async function Page({
  params,searchParams,
}: {
  params: Promise<{ id: string; materialId: string }>;
  searchParams:Promise<{source?:string}>;
}) {
  const { id, materialId } = await params;
  if((await searchParams).source==="1")return <MaterialPage role="student" id={id} materialId={materialId}/>;
  redirect(`/student/tutor?class_id=${encodeURIComponent(id)}&material_id=${encodeURIComponent(materialId)}`);
}

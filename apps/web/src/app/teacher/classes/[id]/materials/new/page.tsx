
import { UiText } from "@/components/language-provider";
import Link from "next/link";
import { classroomData } from "@/lib/classrooms";
import type { ClassDetail } from "@/lib/class-types";
import { Heading } from "@/components/ui";
import { MaterialForm } from "@/components/class-forms";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const row = await classroomData<ClassDetail>(
    "teacher",
    `/${encodeURIComponent(id)}`,
  );
  return (
    <>
      <Link className="learning-back" href={`/teacher/classes/${id}`}><UiText>{"Kembali ke "}</UiText>{row.name}
      </Link>
      <Heading
        title={<UiText>{"Bagikan pengetahuan baru."}</UiText>}
        description={<UiText>{"Tulis materi atau unggah dokumen, tinjau isinya, lalu tentukan kapan siswa dapat membacanya."}</UiText>}
      />
      {row.is_archived ? (
        <p className="info-note"><UiText>{"Aktifkan kelas kembali untuk menambahkan materi."}</UiText></p>
      ) : (
        <MaterialForm classId={id} />
      )}
    </>
  );
}

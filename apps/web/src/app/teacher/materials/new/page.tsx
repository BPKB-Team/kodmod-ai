import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { UiText } from "@/components/language-provider";
import { Heading } from "@/components/ui";
import { MaterialForm } from "@/components/class-forms";
import { backend } from "@/lib/server-api";
import { requireSession } from "@/lib/session";
import type { Classroom } from "@/lib/class-types";

export default async function Page() {
  const { token } = await requireSession("teacher");
  const classes = await backend<Classroom[]>("/classes", token);
  const active = classes.filter((row) => !row.is_archived);

  return (
    <>
      <Link className="learning-back" href="/teacher/materials">
        <ArrowLeft size={16} aria-hidden="true" />
        <UiText>{"Kembali ke materi saya"}</UiText>
      </Link>
      <Heading
        title={<UiText>{"Unggah Materi Baru"}</UiText>}
        description={<UiText>{"Unggah dokumen pembelajaran, tinjau teks hasil bacaan, dan pilih kelas tujuannya."}</UiText>}
      />
      {!active.length ? (
        <p className="info-note">
          <UiText>{"Buat kelas terlebih dahulu sebelum mengunggah materi."}</UiText>{" "}
          <Link href="/teacher/classes/new"><UiText>{"Buat kelas baru"}</UiText></Link>
        </p>
      ) : (
        <MaterialForm classes={active} />
      )}
    </>
  );
}

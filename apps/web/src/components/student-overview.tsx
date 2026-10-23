
import { UiText } from "@/components/language-provider";
import Link from "next/link";
import { ArrowUpRight, BookOpen, ListChecks, MessageCircle } from "lucide-react";
import { classroomData } from "@/lib/classrooms";
import type { StudentMaterial } from "@/lib/class-types";
import { getServerI18n } from "@/lib/server-language";
import { GameProgress } from "@/components/ui/game-progress";
export async function StudentOverview() {
  const { t } = await getServerI18n();
  const materials = await classroomData<StudentMaterial[]>(
    "student",
    "/student/materials",
  );
  const done = materials.filter((m) => m.learning_progress?.status === "completed").length;
  const next = materials.find((m) => m.learning_progress?.status !== "completed");
  return (
    <section className="panel student-overview" aria-label={t("Ringkasan bacaan")}>
      <div>
        <span className="student-overview-label">
          <BookOpen size={18} aria-hidden="true" /><UiText>{"Perjalanan bacaanmu"}</UiText></span>
        <h2>
          {done}<UiText>{" dari "}</UiText>{materials.length}<UiText>{" materi selesai bersama Tutor"}</UiText></h2>
        <GameProgress
          value={done}
          max={materials.length || 1}
          aria-label={t("{count} dari {total} materi selesai bersama Tutor", { count: done, total: materials.length })}
          subtitle={<UiText>{"Penyelesaian bersama Tutor dicatat per bagian materi. Penguasaan konsep dinilai lewat latihan."}</UiText>}
        />
      </div>
      <div className="student-overview-links">
        {next && (
          <Link
            className="button primary"
            href={`/siswa/tutor?class_id=${next.class_id}&material_id=${next.id}`}
          ><UiText>{"Belajar: "}</UiText>{next.title}
            <ArrowUpRight size={18} aria-hidden="true" />
          </Link>
        )}
        <Link className="button secondary" href="/siswa/materi">
          <BookOpen size={18} aria-hidden="true" /><UiText>{"Daftar materi"}</UiText>
        </Link>
        <Link className="button secondary" href="/siswa/tutor">
          <MessageCircle size={18} aria-hidden="true" /><UiText>{"Tutor AI"}</UiText>
        </Link>
        <Link className="button secondary" href="/siswa/latihan">
          <ListChecks size={18} aria-hidden="true" /><UiText>{"Asesmen mandiri"}</UiText>
        </Link>
      </div>
    </section>
  );
}

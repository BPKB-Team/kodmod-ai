import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  GraduationCap,
  Info,
  Layers,
  UserCheck,
} from "lucide-react";
import { AdminMaterialEditor } from "@/components/admin-material-editor";
import { UiText } from "@/components/language-provider";
import { Badge } from "@/components/ui";
import { requireSession } from "@/lib/session";
import { backend, BackendError } from "@/lib/server-api";
import type { AdminMaterial } from "@/lib/admin-material-types";
import "@/styles/admin-materials.css";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { token } = await requireSession("admin");
  const { id } = await params;
  let material: AdminMaterial;
  try {
    material = await backend<AdminMaterial>(
      `/admin/materials/${encodeURIComponent(id)}`,
      token
    );
  } catch (caught) {
    if (caught instanceof BackendError && caught.status === 404) notFound();
    throw caught;
  }

  const statusKey =
    material.rag_status === "ready" &&
    material.indexed_version === material.content_version
      ? "ready"
      : material.rag_status === "failed"
        ? "failed"
        : material.published
          ? "pending"
          : "unpublished";

  return (
    <>
      <Link className="learning-back" href="/admin/materials">
        <ArrowLeft size={16} aria-hidden="true" />
        <UiText>{"Semua materi"}</UiText>
      </Link>

      <section className="admin-detail-header">
        <div className="admin-detail-header-top">
          <div className="admin-detail-chips">
            <span className="admin-detail-chip">
              <BookOpen size={14} aria-hidden="true" />
              {material.subject}
            </span>
            <span className="admin-detail-chip">
              <GraduationCap size={14} aria-hidden="true" />
              {material.class_name}
            </span>
            <span className="admin-detail-chip">
              <UserCheck size={14} aria-hidden="true" />
              {material.teacher_name}
            </span>
            <span className="admin-detail-chip">
              <Layers size={14} aria-hidden="true" />
              <UiText>{"Versi "}</UiText>
              {material.content_version}
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <span className="admin-material-status" data-status={statusKey}>
              <UiText>
                {statusKey === "ready"
                  ? "Siap untuk Tutor"
                  : statusKey === "failed"
                    ? "Perlu diproses ulang"
                    : statusKey === "pending"
                      ? "Sedang disiapkan"
                      : "Belum diterbitkan"}
              </UiText>
            </span>
            <Badge active={material.published}>
              {material.published ? <UiText>{"Terbit"}</UiText> : <UiText>{"Draf"}</UiText>}
            </Badge>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "44px",
              height: "44px",
              borderRadius: "12px",
              background: "#edf4fd",
              color: "#2565e9",
              flexShrink: 0,
            }}
          >
            <BookOpen size={24} aria-hidden="true" />
          </div>
          <h1>{material.title}</h1>
        </div>

        <div className="admin-detail-callout">
          <Info size={18} style={{ flexShrink: 0, marginTop: "2px", color: "#2565e9" }} aria-hidden="true" />
          <p style={{ margin: 0 }}>
            <UiText>
              {"Materi ini digunakan sebagai sumber penjelasan Tutor dan soal latihan siswa. Perubahan konten akan memicu sinkronisasi ulang pemahaman RAG."}
            </UiText>
          </p>
        </div>

        {material.is_archived && (
          <div
            className="alert"
            style={{
              background: "#fffbeb",
              border: "1px solid #fde68a",
              color: "#92400e",
              margin: 0,
              padding: "0.75rem 1rem",
            }}
          >
            <UiText>
              {"Kelas ini diarsipkan. Materi dapat dibaca, tetapi belum dapat diubah."}
            </UiText>
          </div>
        )}
      </section>

      <AdminMaterialEditor
        key={`${material.id}:${material.content_version}:${material.published}`}
        material={material}
      />
    </>
  );
}

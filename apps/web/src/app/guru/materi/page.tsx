import Link from "next/link";
import { ArrowRight, BookOpen, Plus, RotateCcw, Search } from "lucide-react";
import { UiText } from "@/components/language-provider";
import { Badge, Empty, Heading } from "@/components/ui";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { requireSession } from "@/lib/session";
import { backend } from "@/lib/server-api";
import type { Classroom, TeacherMaterial } from "@/lib/class-types";
import "@/styles/admin-materials.css";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; classId?: string; status?: string }>;
}) {
  const { token } = await requireSession("teacher");
  const query = await searchParams;
  const search = (query.search ?? "").trim().slice(0, 120);
  const classId = (query.classId ?? "").trim();
  const status =
    query.status === "published" || query.status === "draft"
      ? query.status
      : "";

  const [classes, allMaterials] = await Promise.all([
    backend<Classroom[]>("/classes", token),
    backend<TeacherMaterial[]>("/classes/teacher/materials", token),
  ]);
  const activeClasses = classes.filter((row) => !row.is_archived);

  // Filter materials based on search query, class, and status
  const materials = allMaterials.filter((m) => {
    if (search) {
      const q = search.toLowerCase();
      const matchTitle = m.title.toLowerCase().includes(q);
      const matchSubject = (m.subject || "").toLowerCase().includes(q);
      const matchClass = (m.class_name || "").toLowerCase().includes(q);
      if (!matchTitle && !matchSubject && !matchClass) return false;
    }
    if (classId && m.class_id !== classId) {
      return false;
    }
    if (status === "published" && !m.published) {
      return false;
    }
    if (status === "draft" && m.published) {
      return false;
    }
    return true;
  });

  const hasActiveFilters = Boolean(search || classId || status);

  return (
    <>
      <Heading
        icon={<BookOpen size={24} aria-hidden="true" />}
        title={<UiText>{"Materi saya"}</UiText>}
        description={<UiText>{"Upload dokumen, tinjau isinya, lalu terbitkan untuk belajar bersama Tutor."}</UiText>}
      >
        {activeClasses.length > 0 && (
          <Link className="button primary" href="/guru/materi/baru">
            <Plus size={18} aria-hidden="true" />
            <UiText>{"Upload materi"}</UiText>
          </Link>
        )}
      </Heading>

      {!classes.length && (
        <p className="info-note">
          <UiText>{"Buat kelas terlebih dahulu untuk membagikan materi."}</UiText>{" "}
          <Link href="/guru/kelas/baru"><UiText>{"Buat kelas"}</UiText></Link>
        </p>
      )}

      {/* Filter and Search Bar */}
      <form className="filters" action="/guru/materi">
        <div className="field search-field">
          <label htmlFor="search" className="sr-only">
            <UiText>{"Cari judul atau mata pelajaran"}</UiText>
          </label>
          <div className="search-input-wrapper">
            <Search size={18} className="search-input-icon" aria-hidden="true" />
            <Input
              name="search"
              id="search"
              defaultValue={search}
              maxLength={120}
              placeholder="Cari judul materi, mapel, atau kelas..."
              type="search"
              className="search-input-field"
            />
          </div>
        </div>

        {activeClasses.length > 0 && (
          <div className="field filter-select-field">
            <label htmlFor="classId" className="filter-label">
              <UiText>{"Kelas:"}</UiText>
            </label>
            <NativeSelect id="classId" name="classId" defaultValue={classId}>
              <option value=""><UiText>{"Semua kelas"}</UiText></option>
              {activeClasses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.subject})
                </option>
              ))}
            </NativeSelect>
          </div>
        )}

        <div className="field filter-select-field">
          <label htmlFor="status" className="filter-label">
            <UiText>{"Status:"}</UiText>
          </label>
          <NativeSelect id="status" name="status" defaultValue={status}>
            <option value=""><UiText>{"Semua status"}</UiText></option>
            <option value="published"><UiText>{"Terbit"}</UiText></option>
            <option value="draft"><UiText>{"Draft"}</UiText></option>
          </NativeSelect>
        </div>

        <button className="button primary search-submit-btn" type="submit">
          <Search size={15} aria-hidden="true" />
          <UiText>{"Cari"}</UiText>
        </button>

        {hasActiveFilters && (
          <Link href="/guru/materi" className="filter-reset-btn">
            <RotateCcw size={14} aria-hidden="true" />
            <UiText>{"Reset filter"}</UiText>
          </Link>
        )}
      </form>

      <div className="learning-section-heading">
        <h2>
          <UiText>{"Daftar materi"}</UiText>
          <span className="count">{materials.length}</span>
        </h2>
      </div>

      {materials.length ? (
        <div className="admin-material-grid">
          {materials.map((material) => (
            <article className="panel admin-material-card" key={material.id}>
              <header>
                <BookOpen size={22} aria-hidden="true" />
                <Badge active={material.published}>
                  {material.published ? <UiText>{"Terbit"}</UiText> : <UiText>{"Draft"}</UiText>}
                </Badge>
              </header>
              <h2>{material.title}</h2>
              <p>{material.subject} · {material.class_name}</p>
              <div
                className="admin-material-status"
                data-status={
                  material.rag_status === "ready" && material.content_version === material.indexed_version
                    ? "ready"
                    : material.rag_status === "failed"
                      ? "failed"
                      : material.published
                        ? "pending"
                        : "draft"
                }
              >
                <UiText>
                  {material.rag_status === "ready" && material.content_version === material.indexed_version
                    ? "Siap untuk Tutor"
                    : material.rag_status === "failed"
                      ? "Perlu diproses ulang"
                      : material.published
                        ? "Sedang disiapkan"
                        : "Belum diterbitkan"}
                </UiText>
              </div>
              <Link href={`/guru/kelas/${material.class_id}/materi/${material.id}`}>
                <UiText>{"Buka materi"}</UiText>
                <ArrowRight size={17} aria-hidden="true" />
              </Link>
            </article>
          ))}
        </div>
      ) : hasActiveFilters ? (
        <section className="panel">
          <Empty title={<UiText>{"Materi tidak ditemukan"}</UiText>}>
            <div style={{ display: "grid", gap: "1rem", justifyItems: "center" }}>
              <UiText>{"Tidak ada materi yang sesuai dengan pencarian atau filter yang dipilih."}</UiText>
              <Link href="/guru/materi" className="button secondary">
                <RotateCcw size={15} aria-hidden="true" />
                <UiText>{"Hapus filter"}</UiText>
              </Link>
            </div>
          </Empty>
        </section>
      ) : (
        <section className="panel">
          <Empty title={<UiText>{"Materi pertama Anda"}</UiText>}>
            <div style={{ display: "grid", gap: "1rem", justifyItems: "center" }}>
              <UiText>{"Klik tombol Upload materi di atas untuk mengunggah PDF, dokumen, atau menulis materi sendiri."}</UiText>
              {activeClasses.length > 0 && (
                <Link className="button primary" href="/guru/materi/baru">
                  <Plus size={16} aria-hidden="true" />
                  <UiText>{"Upload materi"}</UiText>
                </Link>
              )}
            </div>
          </Empty>
        </section>
      )}
    </>
  );
}

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import Link from "next/link";
import { ArrowLeft, ArrowRight, BookOpen, RotateCcw, Search } from "lucide-react";
import { UiText } from "@/components/language-provider";
import { Badge, Empty, Heading } from "@/components/ui";
import { requireSession } from "@/lib/session";
import { backend } from "@/lib/server-api";
import type { AdminMaterialCatalog } from "@/lib/admin-material-types";
import "@/styles/admin-materials.css";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; page?: string; status?: string }>;
}) {
  const { token } = await requireSession("admin");
  const query = await searchParams;
  const search = (query.search ?? "").slice(0, 120);
  const status =
    query.status === "published" || query.status === "draft"
      ? query.status
      : "";
  const raw = Number(query.page ?? 0);
  const page = Number.isSafeInteger(raw) && raw >= 0 ? Math.min(raw, 10000) : 0;

  let endpoint = `/admin/materials?limit=25&offset=${page * 25}&search=${encodeURIComponent(search)}`;
  if (status === "published") endpoint += "&published=true";
  if (status === "draft") endpoint += "&published=false";

  const catalog = await backend<AdminMaterialCatalog>(endpoint, token);
  const totalPages = Math.max(1, Math.ceil(catalog.total / 25));
  const currentPage = page + 1;

  const buildHref = (value: number) => {
    const sp = new URLSearchParams();
    if (search) sp.set("search", search);
    if (status) sp.set("status", status);
    if (value > 0) sp.set("page", String(value));
    const qs = sp.toString();
    return `/admin/materi${qs ? `?${qs}` : ""}`;
  };

  const hasActiveFilters = Boolean(search || status);

  return (
    <>
      <Heading
        kicker={
          <span className="analytics-kicker">
            <BookOpen size={14} aria-hidden="true" />
            <UiText>{"KATALOG MATERI"}</UiText>
          </span>
        }
        title={<UiText>{"Materi kelas"}</UiText>}
        description={<UiText>{"Lihat materi guru, tinjau isi, dan kelola kesiapan belajar siswa."}</UiText>}
      />
      <form className="filters" action="/admin/materi">
        <div className="field search-field">
          <label htmlFor="search" className="sr-only"><UiText>{"Cari judul materi"}</UiText></label>
          <div className="search-input-wrapper">
            <Search size={18} className="search-input-icon" aria-hidden="true" />
            <Input
              name="search"
              id="search"
              defaultValue={search}
              maxLength={120}
              placeholder="Cari berdasarkan judul materi..."
              type="search"
              className="search-input-field"
            />
          </div>
        </div>
        <div className="field filter-select-field">
          <label htmlFor="status" className="filter-label"><UiText>{"Status:"}</UiText></label>
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
          <Link href="/admin/materi" className="filter-reset-btn">
            <RotateCcw size={14} aria-hidden="true" />
            <UiText>{"Reset filter"}</UiText>
          </Link>
        )}
      </form>
      <div className="learning-section-heading">
        <h2>
          <UiText>{"Daftar materi"}</UiText>
          <span className="count">{catalog.total}</span>
        </h2>
      </div>
      {catalog.items.length ? (
        <div className="admin-material-grid">
          {catalog.items.map((material) => {
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
              <article className="panel admin-material-card" key={material.id}>
                <header>
                  <BookOpen size={22} aria-hidden="true" />
                  <Badge active={material.published}>
                    {material.published ? <UiText>{"Terbit"}</UiText> : <UiText>{"Draft"}</UiText>}
                  </Badge>
                </header>
                <h2>{material.title}</h2>
                <p>{material.subject} · {material.class_name}</p>
                <small>{material.teacher_name}</small>
                <div className="admin-material-status" data-status={statusKey}>
                  <UiText>
                    {statusKey === "ready"
                      ? "Siap untuk Tutor"
                      : statusKey === "failed"
                        ? "Perlu diproses ulang"
                        : statusKey === "pending"
                          ? "Sedang disiapkan"
                          : "Belum diterbitkan"}
                  </UiText>
                </div>
                <Link href={`/admin/materi/${material.id}`}>
                  <UiText>{"Tinjau materi"}</UiText>
                  <ArrowRight size={17} aria-hidden="true" />
                </Link>
              </article>
            );
          })}
        </div>
      ) : (
        <section className="panel">
          <Empty title={<UiText>{"Belum ada materi"}</UiText>}>
            {hasActiveFilters ? (
              <UiText>{"Coba ubah kata kunci atau reset filter jika materi belum ditemukan."}</UiText>
            ) : (
              <UiText>{"Materi yang diunggah guru akan muncul di sini."}</UiText>
            )}
          </Empty>
        </section>
      )}
      <div className="admin-pagination">
        <span>
          <UiText>{"Halaman"}</UiText> {currentPage} <UiText>{"dari"}</UiText> {totalPages} · {catalog.total} <UiText>{"materi"}</UiText>
        </span>
        <div className="pagination-actions">
          {page > 0 ? (
            <Link className="pagination-btn" href={buildHref(page - 1)}>
              <ArrowLeft size={16} aria-hidden="true" />
              <UiText>{"Sebelumnya"}</UiText>
            </Link>
          ) : (
            <span className="pagination-btn disabled" aria-disabled="true">
              <ArrowLeft size={16} aria-hidden="true" />
              <UiText>{"Sebelumnya"}</UiText>
            </span>
          )}
          {(page + 1) * 25 < catalog.total ? (
            <Link className="pagination-btn" href={buildHref(page + 1)}>
              <UiText>{"Berikutnya"}</UiText>
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          ) : (
            <span className="pagination-btn disabled" aria-disabled="true">
              <UiText>{"Berikutnya"}</UiText>
              <ArrowRight size={16} aria-hidden="true" />
            </span>
          )}
        </div>
      </div>
    </>
  );
}

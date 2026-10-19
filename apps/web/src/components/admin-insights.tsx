"use client";
import { LoadingStatus } from "./loading-feedback";
import { UiText, useI18n, UiDate } from "@/components/language-provider";


import { useState } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Clock3,
  GraduationCap,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { notifyResult } from "@/lib/dialogs";
import type { AdminActivity, AdminOverview } from "@/lib/admin-insights-types";

function actionLabel(action: string) {
  return action
    .replaceAll(".", " · ")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function readJson<T>(response: Response, fallback: string) {
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: unknown };
    throw new Error(typeof body.message === "string" ? body.message : fallback);
  }
  return (await response.json()) as T;
}

export function AdminInsights({
  initialOverview,
  initialActivity,
}: {
  initialOverview: AdminOverview;
  initialActivity: AdminActivity;
}) {
  const { t } = useI18n();
  const [overview, setOverview] = useState(initialOverview);
  const [activity, setActivity] = useState(initialActivity);
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [page, setPage] = useState(1);
  const pageSize = 6;
  const totalPages = Math.max(1, Math.ceil(activity.items.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedItems = activity.items.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  async function fetchActivity(cat: string) {
    const url =
      cat === "all"
        ? "/api/admin/activity?limit=40"
        : `/api/admin/activity?limit=40&category=${encodeURIComponent(cat)}`;
    const res = await fetch(url, { cache: "no-store" });
    return readJson<AdminActivity>(res, "Aktivitas belum dapat dimuat.");
  }

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const [overviewResponse, newActivity] = await Promise.all([
        fetch("/api/admin/insights/overview", { cache: "no-store" }),
        fetchActivity(selectedCategory),
      ]);
      setOverview(await readJson<AdminOverview>(overviewResponse, "Overview belum dapat dimuat."));
      setActivity(newActivity);
      setPage(1);
      await notifyResult("Insight operasional sudah diperbarui.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Insight operasional belum dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }

  async function handleFilterChange(cat: string) {
    if (loading || cat === selectedCategory) return;
    setSelectedCategory(cat);
    setLoading(true);
    setError("");
    try {
      const newActivity = await fetchActivity(cat);
      setActivity(newActivity);
      setPage(1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Aktivitas belum dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }

  const categoryFilters = [
    { id: "all", label: "Semua" },
    { id: "account", label: "Akun" },
    { id: "invitation", label: "Undangan" },
    { id: "auth", label: "Autentikasi" },
    { id: "classroom", label: "Kelas & Materi" },
    { id: "learning", label: "Sesi Belajar" },
    { id: "quiz", label: "Kuis" },
  ];

  const provider = overview.providers.elevenlabs;
  return (
    <section className="admin-insights" aria-label={t("Insight operasional admin")}>
      <LoadingStatus active={loading} label="Memuat analitik dan aktivitas…" />
      <div className="admin-insights-heading">
        <div>
          <span className="analytics-kicker"><Activity size={14} aria-hidden="true" /><UiText>{" OPERASIONAL"}</UiText></span>
          <h2><UiText>{"Semua sinyal penting dalam satu pandangan."}</UiText></h2>
          <p><UiText>{"Angka agregat untuk memantau kesehatan ruang belajar dan layanan pendukung."}</UiText></p>
        </div>
        <button type="button" className="button secondary" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw size={16} className={loading ? "spin" : undefined} aria-hidden="true" /><UiText>{"Perbarui"}</UiText></button>
      </div>
      {error && <p className="alert error-message" role="alert">{error}</p>}

      <div className="admin-insight-grid">
        <article className="panel admin-insight-card">
          <span className="admin-insight-icon blue"><Users size={19} aria-hidden="true" /></span>
          <span><UiText>{"Pengguna aktif"}</UiText></span>
          <strong>{overview.users.active}</strong>
          <small>{overview.users.total}<UiText>{" akun · "}</UiText>{overview.users.students}<UiText>{" siswa · "}</UiText>{overview.users.teachers}<UiText>{" guru"}</UiText></small>
        </article>
        <article className="panel admin-insight-card">
          <span className="admin-insight-icon purple"><GraduationCap size={19} aria-hidden="true" /></span>
          <span><UiText>{"Ruang belajar"}</UiText></span>
          <strong>{overview.learning.classrooms}</strong>
          <small>{overview.learning.sessions}<UiText>{" sesi · "}</UiText>{overview.learning.open_sessions}<UiText>{" masih terbuka"}</UiText></small>
        </article>
        <article className="panel admin-insight-card">
          <span className="admin-insight-icon green"><ShieldCheck size={19} aria-hidden="true" /></span>
          <span><UiText>{"Kesiapan suara"}</UiText></span>
            <strong>{!provider.enabled ? <UiText>{"Fallback aktif"}</UiText> : provider.configured ? <UiText>{"Siap"}</UiText> : <UiText>{"Perlu setup"}</UiText>}</strong>
          <small>{provider.tts_backend} · {provider.stt_backend}</small>
        </article>
      </div>

      <div className="admin-insight-columns">
        <article className="panel admin-activity-card">
          <div className="panel-heading">
            <div><h2><UiText>{"Aktivitas terbaru"}</UiText></h2><p><UiText>{"Metadata operasional dan audit log sistem tanpa membocorkan kredensial."}</UiText></p></div>
            <Activity size={20} aria-hidden="true" />
          </div>

          <div
            className="ai-filter-group"
            style={{ margin: "8px 0 16px", flexWrap: "wrap" }}
            role="group"
            aria-label={t("Filter kategori aktivitas")}
          >
            {categoryFilters.map((filter) => (
              <button
                key={filter.id}
                type="button"
                className={`ai-filter-tab ${selectedCategory === filter.id ? "active" : ""}`}
                onClick={() => void handleFilterChange(filter.id)}
                disabled={loading}
              >
                {t(filter.label)}
              </button>
            ))}
          </div>

          {pagedItems.length ? (
            <div className="admin-activity-list">
              {pagedItems.map((item) => (
                <div className="admin-activity-item" key={`${item.type}-${item.id}`}>
                  <span className="admin-activity-dot" aria-hidden="true" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                      <strong>{actionLabel(item.action)}</strong>
                      {item.category && (
                        <span
                          style={{
                            fontSize: "10px",
                            padding: "1px 6px",
                            borderRadius: "4px",
                            background: "#edf3fc",
                            color: "#305d9e",
                            fontWeight: 600,
                          }}
                        >
                          {item.category.toUpperCase()}
                        </span>
                      )}
                    </div>
                    <p style={{ marginTop: "2px" }}>
                      {item.actor_name}
                      {item.actor_role ? ` (${item.actor_role})` : ""} · {item.target_name}
                    </p>
                    <small><UiDate value={item.occurred_at} time empty="Belum tersedia" /></small>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="admin-insight-empty"><Clock3 size={22} aria-hidden="true" /><p><UiText>{"Belum ada aktivitas dalam kategori ini."}</UiText></p></div>
          )}

          {activity.items.length > pageSize && (
            <div className="admin-pagination" style={{ marginTop: "1rem", borderRadius: "10px" }}>
              <span>
                <UiText>{"Halaman"}</UiText> {currentPage} <UiText>{"dari"}</UiText> {totalPages} · {activity.items.length} <UiText>{"aktivitas"}</UiText>
              </span>
              <div className="pagination-actions">
                <button
                  type="button"
                  className={`pagination-btn ${currentPage <= 1 ? "disabled" : ""}`}
                  disabled={currentPage <= 1 || loading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ArrowLeft size={16} aria-hidden="true" />
                  <UiText>{"Sebelumnya"}</UiText>
                </button>
                <button
                  type="button"
                  className={`pagination-btn ${currentPage >= totalPages ? "disabled" : ""}`}
                  disabled={currentPage >= totalPages || loading}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  <UiText>{"Berikutnya"}</UiText>
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
        </article>
        <article className="panel admin-activity-card">
          <div className="panel-heading">
            <div><h2><UiText>{"Status layanan"}</UiText></h2><p><UiText>{"Konfigurasi provider dibaca dari backend dan tidak menampilkan API key."}</UiText></p></div>
            <Sparkles size={20} aria-hidden="true" />
          </div>
          <div className="admin-provider-status">
            <div className={provider.enabled ? (provider.configured ? "ready" : "attention") : "idle"}>
              {provider.enabled && provider.configured ? <CheckCircle2 size={21} aria-hidden="true" /> : <CircleAlert size={21} aria-hidden="true" />}
              <div><strong><UiText>{"ElevenLabs"}</UiText></strong><span>{!provider.enabled ? <UiText>{"Belum dipilih; fallback lokal tetap aktif"}</UiText> : provider.configured ? <UiText>{"TTS dan STT siap digunakan"}</UiText> : <UiText>{"API key atau voice ID belum lengkap"}</UiText>}</span></div>
            </div>
            <dl>
              <div><dt><UiText>{"Text to speech"}</UiText></dt><dd>{provider.tts_backend}</dd></div>
              <div><dt><UiText>{"Speech to text"}</UiText></dt><dd>{provider.stt_backend}</dd></div>
              <div><dt><UiText>{"Kuis tersimpan"}</UiText></dt><dd>{overview.learning.quiz_sessions}</dd></div>
              <div><dt><UiText>{"Guru terdaftar"}</UiText></dt><dd>{overview.users.teachers}</dd></div>
            </dl>
          </div>
        </article>
      </div>
    </section>
  );
}

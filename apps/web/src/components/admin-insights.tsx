"use client";
import { LoadingStatus } from "./loading-feedback";
import { UiText, useI18n, UiDate } from "@/components/language-provider";


import { useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Bot,
  CheckCircle2,
  CircleAlert,
  Clock3,
  GraduationCap,
  Key,
  PieChart,
  Radio,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
  Zap,
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
  isStandalonePage = false,
}: {
  initialOverview: AdminOverview;
  initialActivity: AdminActivity;
  isStandalonePage?: boolean;
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

  // Audit & activity category breakdown
  const authCount = activity.items.filter((item) => item.category === "auth" || item.action.startsWith("auth.")).length;
  const learningCount = activity.items.filter((item) => item.category === "learning" || item.type === "learning_session").length;
  const classroomCount = activity.items.filter((item) => item.category === "classroom" || item.type === "class_activity").length;
  const quizCount = activity.items.filter((item) => item.category === "quiz" || item.type === "quiz_session").length;
  const accountCount = activity.items.filter(
    (item) => item.category === "account" || item.category === "invitation" || item.category === "admin"
  ).length;
  const totalEvents = Math.max(1, activity.items.length);

  const authPct = Math.round((authCount / totalEvents) * 100);
  const learningPct = Math.round((learningCount / totalEvents) * 100);
  const classroomPct = Math.round((classroomCount / totalEvents) * 100);
  const quizPct = Math.round((quizCount / totalEvents) * 100);
  const accountPct = Math.max(0, 100 - (authPct + learningPct + classroomPct + quizPct));

  const learningBars = [
    {
      label: "Total Sesi Belajar",
      value: overview.learning.sessions,
      color: "linear-gradient(180deg, #3b82f6, #1d4ed8)",
      desc: "Sesi dibuka total",
    },
    {
      label: "Sedang aktif langsung",
      value: overview.learning.open_sessions,
      color: "linear-gradient(180deg, #10b981, #047857)",
      desc: "Sedang berjalan",
    },
    {
      label: "Evaluasi & Kuis",
      value: overview.learning.quiz_sessions,
      color: "linear-gradient(180deg, #f59e0b, #b45309)",
      desc: "Latihan terselesaikan",
    },
    {
      label: "Ruang Belajar Terdaftar",
      value: overview.learning.classrooms,
      color: "linear-gradient(180deg, #8b5cf6, #6d28d9)",
      desc: "Kelas terhubung",
    },
  ];

  const maxLearningValue = Math.max(1, ...learningBars.map((b) => b.value));

  return (
    <section className="admin-insights" aria-label={t("Insight operasional admin")}>
      <LoadingStatus active={loading} label="Memuat analitik dan aktivitas…" />
      {isStandalonePage ? (
        <div className="admin-activity-page-header">
          <div className="page-heading-main">
            <div className="heading-icon-badge" aria-hidden="true">
              <Activity size={24} />
            </div>
            <div className="page-heading-text">
              <div className="heading-kicker-wrap">
                <span className="activity-status-kicker">
                  <span className="pulsing-dot" aria-hidden="true" />
                  <UiText>{"OPERASIONAL SISTEM"}</UiText>
                </span>
              </div>
              <h1><UiText>{"Aktivitas & Layanan"}</UiText></h1>
              <p><UiText>{"Pantau kesehatan operasional KODMOD dan status provider pendukung."}</UiText></p>
            </div>
          </div>
          <button type="button" className="button primary refresh-btn" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw size={16} className={loading ? "spin" : undefined} aria-hidden="true" />
            <UiText>{"Perbarui Data"}</UiText>
          </button>
        </div>
      ) : (
        <div className="admin-insights-heading">
          <div className="page-heading-main">
            <div className="heading-icon-badge" aria-hidden="true">
              <Activity size={24} />
            </div>
            <div className="page-heading-text">
              <h2><UiText>{"Semua sinyal penting dalam satu pandangan."}</UiText></h2>
              <p><UiText>{"Angka agregat untuk memantau kesehatan ruang belajar dan layanan pendukung."}</UiText></p>
            </div>
          </div>
          <button type="button" className="button secondary refresh-btn" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw size={16} className={loading ? "spin" : undefined} aria-hidden="true" />
            <UiText>{"Perbarui Data"}</UiText>
          </button>
        </div>
      )}
      {error && <p className="alert error-message" role="alert">{t(error)}</p>}

      <div className="admin-insight-grid admin-insight-grid-4">
        <article className="panel admin-insight-card">
          <span className="admin-insight-icon blue"><Users size={22} aria-hidden="true" /></span>
          <div className="admin-insight-card-content">
            <span><UiText>{"Pengguna aktif"}</UiText></span>
            <strong>{overview.users.active}</strong>
            <small>{overview.users.total}<UiText>{" akun · "}</UiText>{overview.users.students}<UiText>{" siswa · "}</UiText>{overview.users.teachers}<UiText>{" guru"}</UiText></small>
          </div>
        </article>
        <article className="panel admin-insight-card">
          <span className="admin-insight-icon green"><Radio size={22} aria-hidden="true" /></span>
          <div className="admin-insight-card-content">
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span><UiText>{"Sesi berjalan"}</UiText></span>
              <span className="live-dot" aria-hidden="true" />
            </div>
            <strong>{overview.learning.open_sessions}</strong>
            <small><UiText>{"Sesi aktif dari"}</UiText> {overview.learning.sessions} <UiText>{"total sesi"}</UiText></small>
          </div>
        </article>
        <article className="panel admin-insight-card">
          <span className="admin-insight-icon purple"><GraduationCap size={22} aria-hidden="true" /></span>
          <div className="admin-insight-card-content">
            <span><UiText>{"Ruang belajar"}</UiText></span>
            <strong>{overview.learning.classrooms}</strong>
            <small>{overview.learning.quiz_sessions} <UiText>{"latihan kuis tersimpan"}</UiText></small>
          </div>
        </article>
        <article className="panel admin-insight-card">
          <span className="admin-insight-icon amber"><ShieldCheck size={22} aria-hidden="true" /></span>
          <div className="admin-insight-card-content">
            <span><UiText>{"Kesiapan suara"}</UiText></span>
            <strong>{!provider.enabled ? <UiText>{"Cadangan aktif"}</UiText> : provider.configured ? <UiText>{"Siap"}</UiText> : <UiText>{"Perlu disiapkan"}</UiText>}</strong>
            <small>{provider.tts_backend} · {provider.stt_backend}</small>
          </div>
        </article>
      </div>

      {isStandalonePage && (
        <div className="admin-charts-grid" style={{ marginBottom: "1.75rem" }}>
          {/* Chart 1: Distribusi Audit & Aktivitas Sistem */}
          <article className="panel admin-chart-card">
            <div className="panel-heading">
              <div>
                <div className="chart-kicker">
                  <PieChart size={15} aria-hidden="true" />
                  <span><UiText>{"DISTRIBUSI AUDIT & AKTIVITAS"}</UiText></span>
                </div>
                <h2><UiText>{"Komposisi Sinyal & Event Sistem"}</UiText></h2>
                <p><UiText>{"Sebaran aktivitas operasional berdasarkan kategori log audit."}</UiText></p>
              </div>
              <span className="chart-active-pill">
                <span className="pulsing-dot" aria-hidden="true" />
                {activity.items.length} <UiText>{"Aktivitas Tercatat"}</UiText>
              </span>
            </div>

            {/* Proportional Segment Bar */}
            <div className="role-ratio-bar-wrap" aria-label={t("Grafik perbandingan kategori aktivitas")}>
              <div className="role-ratio-bar">
                <div
                  className="segment"
                  style={{ width: `${authPct}%`, background: "linear-gradient(90deg, #3b82f6, #2563eb)" }}
                  title={`${t("Autentikasi")}: ${authCount} (${authPct}%)`}
                />
                <div
                  className="segment"
                  style={{ width: `${learningPct}%`, background: "linear-gradient(90deg, #8b5cf6, #6d28d9)" }}
                  title={`${t("Sesi Belajar")}: ${learningCount} (${learningPct}%)`}
                />
                <div
                  className="segment"
                  style={{ width: `${classroomPct}%`, background: "linear-gradient(90deg, #10b981, #059669)" }}
                  title={`${t("Kelas & Materi")}: ${classroomCount} (${classroomPct}%)`}
                />
                <div
                  className="segment"
                  style={{ width: `${quizPct}%`, background: "linear-gradient(90deg, #f59e0b, #d97706)" }}
                  title={`${t("Kuis")}: ${quizCount} (${quizPct}%)`}
                />
                <div
                  className="segment"
                  style={{ width: `${accountPct}%`, background: "linear-gradient(90deg, #06b6d4, #0891b2)" }}
                  title={`${t("Akun")}: ${accountCount} (${accountPct}%)`}
                />
              </div>
            </div>

            {/* Interactive Legend Grid */}
            <div className="role-legend-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))" }}>
              <button
                type="button"
                className={`role-legend-card ${selectedCategory === "auth" ? "active-legend" : ""}`}
                onClick={() => void handleFilterChange("auth")}
                style={{ textAlign: "left", cursor: "pointer", border: selectedCategory === "auth" ? "1.5px solid #3b82f6" : undefined }}
              >
                <div className="legend-indicator blue" />
                <div>
                  <span className="legend-title"><UiText>{"Autentikasi"}</UiText></span>
                  <strong className="legend-value">{authCount}</strong>
                  <small className="legend-pct">{authPct}%</small>
                </div>
              </button>
              <button
                type="button"
                className={`role-legend-card ${selectedCategory === "learning" ? "active-legend" : ""}`}
                onClick={() => void handleFilterChange("learning")}
                style={{ textAlign: "left", cursor: "pointer", border: selectedCategory === "learning" ? "1.5px solid #8b5cf6" : undefined }}
              >
                <div className="legend-indicator" style={{ background: "#8b5cf6" }} />
                <div>
                  <span className="legend-title"><UiText>{"Sesi Belajar"}</UiText></span>
                  <strong className="legend-value">{learningCount}</strong>
                  <small className="legend-pct" style={{ color: "#7c3aed" }}>{learningPct}%</small>
                </div>
              </button>
              <button
                type="button"
                className={`role-legend-card ${selectedCategory === "classroom" ? "active-legend" : ""}`}
                onClick={() => void handleFilterChange("classroom")}
                style={{ textAlign: "left", cursor: "pointer", border: selectedCategory === "classroom" ? "1.5px solid #10b981" : undefined }}
              >
                <div className="legend-indicator green" />
                <div>
                  <span className="legend-title"><UiText>{"Kelas & Materi"}</UiText></span>
                  <strong className="legend-value">{classroomCount}</strong>
                  <small className="legend-pct" style={{ color: "#059669" }}>{classroomPct}%</small>
                </div>
              </button>
              <button
                type="button"
                className={`role-legend-card ${selectedCategory === "quiz" ? "active-legend" : ""}`}
                onClick={() => void handleFilterChange("quiz")}
                style={{ textAlign: "left", cursor: "pointer", border: selectedCategory === "quiz" ? "1.5px solid #f59e0b" : undefined }}
              >
                <div className="legend-indicator amber" />
                <div>
                  <span className="legend-title"><UiText>{"Kuis"}</UiText></span>
                  <strong className="legend-value">{quizCount}</strong>
                  <small className="legend-pct" style={{ color: "#d97706" }}>{quizPct}%</small>
                </div>
              </button>
              <button
                type="button"
                className={`role-legend-card ${selectedCategory === "account" ? "active-legend" : ""}`}
                onClick={() => void handleFilterChange("account")}
                style={{ textAlign: "left", cursor: "pointer", border: selectedCategory === "account" ? "1.5px solid #06b6d4" : undefined }}
              >
                <div className="legend-indicator" style={{ background: "#06b6d4" }} />
                <div>
                  <span className="legend-title"><UiText>{"Akun"}</UiText></span>
                  <strong className="legend-value">{accountCount}</strong>
                  <small className="legend-pct" style={{ color: "#0891b2" }}>{accountPct}%</small>
                </div>
              </button>
            </div>
          </article>

          {/* Chart 2: Beban Operasional & Ritme Ruang Belajar */}
          <article className="panel admin-chart-card">
            <div className="panel-heading">
              <div>
                <div className="chart-kicker">
                  <BarChart3 size={15} aria-hidden="true" />
                  <span><UiText>{"BEBAN OPERASIONAL & RUANG BELAJAR"}</UiText></span>
                </div>
                <h2><UiText>{"Ritme Pembelajaran & Evaluasi"}</UiText></h2>
                <p><UiText>{"Tingkat partisipasi sesi, kelas aktif, dan penyelesaian evaluasi."}</UiText></p>
              </div>
              {overview.learning.open_sessions > 0 && (
                <span className="chart-active-pill">
                  <span className="pulsing-dot" aria-hidden="true" />
                  {overview.learning.open_sessions} <UiText>{"Sesi Berjalan Langsung"}</UiText>
                </span>
              )}
            </div>

            {/* Visual Column / Bar Chart */}
            <div className="learning-chart-bars">
              {learningBars.map((bar) => {
                const heightPct = Math.round((bar.value / maxLearningValue) * 100);
                return (
                  <div className="learning-bar-col" key={bar.label}>
                    <div className="bar-track">
                      <div
                        className="bar-fill"
                        style={{
                          height: `${Math.max(10, heightPct)}%`,
                          background: bar.color,
                        }}
                      >
                        <span className="bar-val-badge">{bar.value}</span>
                      </div>
                    </div>
                    <div className="bar-info">
                      <strong className="bar-label">{t(bar.label)}</strong>
                      <small className="bar-desc">{t(bar.desc)}</small>
                    </div>
                  </div>
                );
              })}
            </div>
          </article>
        </div>
      )}

      <div className="admin-insight-columns">
        <article className="panel admin-activity-card">
          <div className="panel-heading">
            <div>
              <h2><UiText>{"Aktivitas terbaru"}</UiText></h2>
              <p><UiText>{"Metadata operasional dan audit log sistem tanpa membocorkan kredensial."}</UiText></p>
            </div>
            <Activity size={20} aria-hidden="true" />
          </div>

          <div
            className="ai-filter-group"
            style={{ margin: "10px 0 16px", flexWrap: "wrap" }}
            role="tablist"
            aria-label={t("Filter kategori aktivitas")}
          >
            {categoryFilters.map((filter) => (
              <button
                key={filter.id}
                type="button"
                role="tab"
                aria-selected={selectedCategory === filter.id}
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
                        <span className={`activity-category-badge category-${item.category}`}>
                          {item.category.toUpperCase()}
                        </span>
                      )}
                    </div>
                    <p style={{ margin: "4px 0", fontSize: "0.85rem", color: "#334155" }}>
                      {item.actor_name}
                      {item.actor_role ? ` (${item.actor_role})` : ""} · {item.target_name}
                    </p>
                    <small style={{ color: "#64748b", display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "0.8rem" }}>
                      <Clock3 size={12} aria-hidden="true" />
                      <UiDate value={item.occurred_at} time empty="Belum tersedia" />
                    </small>
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
        <article className="panel admin-activity-card admin-service-status-card">
          <div className="panel-heading">
            <div>
              <h2><UiText>{"Status layanan"}</UiText></h2>
              <p><UiText>{"Konfigurasi provider dibaca dari backend tanpa membocorkan kredensial."}</UiText></p>
            </div>
            <Sparkles size={20} aria-hidden="true" />
          </div>

          <div className="admin-provider-card-box">
            {provider.enabled && provider.configured ? (
              <CheckCircle2 size={24} style={{ color: "#059669", flexShrink: 0, marginTop: "2px" }} aria-hidden="true" />
            ) : (
              <CircleAlert size={24} style={{ color: "#d97706", flexShrink: 0, marginTop: "2px" }} aria-hidden="true" />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
                <strong style={{ fontSize: "0.95rem", color: "#0f2442" }}><UiText>{"ElevenLabs Speech Service"}</UiText></strong>
                <span className={`ai-status-tag ${provider.enabled && provider.configured ? "ready" : "fallback"}`}>
                  {provider.enabled && provider.configured ? <UiText>{"Siap"}</UiText> : <UiText>{"Perlu setup"}</UiText>}
                </span>
              </div>
              <p style={{ margin: "4px 0 0", fontSize: "0.82rem", color: "#475569" }}>
                {!provider.enabled
                  ? <UiText>{"Belum dipilih; layanan cadangan lokal tetap aktif"}</UiText>
                  : provider.configured
                    ? <UiText>{"Pembacaan dan transkripsi suara siap digunakan"}</UiText>
                    : <UiText>{"Kunci API atau pilihan suara belum lengkap"}</UiText>}
              </p>
            </div>
          </div>

          <div className="admin-provider-spec-list">
            <div className="admin-provider-spec-row">
              <span><UiText>{"Teks menjadi suara"}</UiText></span>
              <code>{provider.tts_backend}</code>
            </div>
            <div className="admin-provider-spec-row">
              <span><UiText>{"Suara menjadi teks"}</UiText></span>
              <code>{provider.stt_backend}</code>
            </div>
          </div>

          <div className="admin-service-section">
            <div className="admin-service-section-header">
              <ShieldCheck size={16} aria-hidden="true" />
              <h3><UiText>{"Operasional & Keamanan Langsung"}</UiText></h3>
            </div>
            <div className="admin-telemetry-grid">
              <div className="admin-telemetry-tile">
                <div className="telemetry-top">
                  <span className="live-dot" aria-hidden="true" />
                  <strong>{overview.learning.open_sessions}</strong>
                </div>
                <span><UiText>{"Sesi berjalan"}</UiText></span>
              </div>
              <div className="admin-telemetry-tile">
                <div className="telemetry-top">
                  <Key size={14} aria-hidden="true" />
                  <strong>{overview.invitations.active}</strong>
                </div>
                <span><UiText>{"Undangan aktif"}</UiText></span>
              </div>
              <div className="admin-telemetry-tile">
                <div className="telemetry-top">
                  <GraduationCap size={14} aria-hidden="true" />
                  <strong>{overview.learning.classrooms}</strong>
                </div>
                <span><UiText>{"Kelas aktif"}</UiText></span>
              </div>
            </div>

            <div className="admin-security-checks">
              <div className="security-check-row">
                <ShieldCheck size={15} aria-hidden="true" />
                <span><UiText>{"Proteksi Sesi Aktif"}</UiText></span>
                <span className="security-check-tag"><UiText>{"Cookie sesi terlindungi dari akses skrip dan pengiriman lintas situs."}</UiText></span>
              </div>
              <div className="security-check-row">
                <CheckCircle2 size={15} aria-hidden="true" />
                <span><UiText>{"Audit Trail Non-Repudiasi"}</UiText></span>
                <span className="security-check-tag"><UiText>{"Aktif tanpa bocor rahasia"}</UiText></span>
              </div>
            </div>
          </div>

          <div className="admin-service-section">
            <div className="admin-service-section-header">
              <Zap size={16} aria-hidden="true" />
              <h3><UiText>{"Pintasan Administrasi"}</UiText></h3>
            </div>
            <div className="admin-quick-actions-grid">
              <Link href="/admin/pengguna" className="admin-quick-action-card">
                <div className="quick-action-icon blue">
                  <Users size={16} aria-hidden="true" />
                </div>
                <div className="quick-action-text">
                  <strong><UiText>{"Kelola Pengguna"}</UiText></strong>
                  <small>{overview.users.total} <UiText>{"akun terdaftar"}</UiText></small>
                </div>
                <ArrowUpRight size={14} className="quick-action-arrow" aria-hidden="true" />
              </Link>
              <Link href="/admin/pemantauan-ai" className="admin-quick-action-card">
                <div className="quick-action-icon purple">
                  <Bot size={16} aria-hidden="true" />
                </div>
                <div className="quick-action-text">
                  <strong><UiText>{"Pemantauan AI"}</UiText></strong>
                  <small><UiText>{"Analitik & kuota"}</UiText></small>
                </div>
                <ArrowUpRight size={14} className="quick-action-arrow" aria-hidden="true" />
              </Link>
              <Link href="/admin/materi" className="admin-quick-action-card">
                <div className="quick-action-icon emerald">
                  <BookOpen size={16} aria-hidden="true" />
                </div>
                <div className="quick-action-text">
                  <strong><UiText>{"Katalog Materi"}</UiText></strong>
                  <small><UiText>{"Bank modul"}</UiText></small>
                </div>
                <ArrowUpRight size={14} className="quick-action-arrow" aria-hidden="true" />
              </Link>
              <Link href="/admin/pengguna/baru" className="admin-quick-action-card">
                <div className="quick-action-icon amber">
                  <UserPlus size={16} aria-hidden="true" />
                </div>
                <div className="quick-action-text">
                  <strong><UiText>{"Tambah Pengguna"}</UiText></strong>
                  <small><UiText>{"Buat akun baru"}</UiText></small>
                </div>
                <ArrowUpRight size={14} className="quick-action-arrow" aria-hidden="true" />
              </Link>
            </div>
          </div>

          <div className="admin-status-sync-footer">
            <span className="sync-time">
              <Clock3 size={13} aria-hidden="true" />
              <UiText>{"Pembaruan data:"}</UiText>{" "}
              <UiDate value={overview.generated_at} time empty="Baru saja" />
            </span>
            <span className="sync-status-badge">
              <CheckCircle2 size={13} aria-hidden="true" />
              <UiText>{"Sistem Siap"}</UiText>
            </span>
          </div>
        </article>
      </div>
    </section>
  );
}

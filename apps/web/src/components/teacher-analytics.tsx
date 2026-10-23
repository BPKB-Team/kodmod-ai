"use client";

import { LoadingStatus } from "./loading-feedback";
import { UiText, useI18n } from "@/components/language-provider";
import { Heading } from "./ui";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  PieChart,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import { notifyResult } from "@/lib/dialogs";
import type { AnalyticsWindow } from "@/lib/analytics-types";
import type { TeacherCohort } from "@/lib/teacher-types";
import { GameProgress } from "./ui/game-progress";

const windows: Array<{ value: AnalyticsWindow; label: string }> = [
  { value: "today", label: "Hari ini" },
  { value: "week", label: "7 hari" },
  { value: "month", label: "30 hari" },
  { value: "all", label: "Semua waktu" },
];

function percent(value: number) {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

async function readJson<T>(response: Response, fallback: string) {
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: unknown };
    throw new Error(typeof body.message === "string" ? body.message : fallback);
  }
  return (await response.json()) as T;
}

const PAGE_SIZE = 8;

export function TeacherAnalytics({ initial }: { initial: TeacherCohort }) {
  const { t } = useI18n();
  const [data, setData] = useState(initial);
  const [window, setWindow] = useState<AnalyticsWindow>(initial.window);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Roster search, filter, and pagination states
  const [rosterSearch, setRosterSearch] = useState("");
  const [rosterFilter, setRosterFilter] = useState<"all" | "needs-help" | "low-accuracy" | "most-active">("all");
  const [currentPage, setCurrentPage] = useState(1);

  async function load(next: AnalyticsWindow) {
    if (loading) return false;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/teacher/students?window=${next}`, { cache: "no-store" });
      const payload = await readJson<TeacherCohort>(response, "Data cohort belum dapat dimuat.");
      setData(payload);
      setWindow(next);
      setCurrentPage(1);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Data cohort belum dapat dimuat.");
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function refresh() {
    if (await load(window)) await notifyResult("Data cohort sudah diperbarui.");
  }

  // Visual breakdown stats for Chart 1: Kesiapan Belajar
  const totalStudents = data.students.length;
  const needsHelp = useMemo(() => data.students.filter((s) => s.overall_mastery < 0.5), [data.students]);
  const developing = useMemo(
    () => data.students.filter((s) => s.overall_mastery >= 0.5 && s.overall_mastery < 0.75),
    [data.students]
  );
  const mastering = useMemo(() => data.students.filter((s) => s.overall_mastery >= 0.75), [data.students]);

  const pct = (count: number) => (totalStudents > 0 ? (count / totalStudents) * 100 : 0);
  const needsHelpPct = pct(needsHelp.length);
  const developingPct = pct(developing.length);
  const masteringPct = pct(mastering.length);

  // Visual breakdown for Chart 2: Distribusi Skor Penguasaan Materi (Histogram)
  const brackets = useMemo(() => {
    const b1 = data.students.filter((s) => s.overall_mastery <= 0.25);
    const b2 = data.students.filter((s) => s.overall_mastery > 0.25 && s.overall_mastery <= 0.5);
    const b3 = data.students.filter((s) => s.overall_mastery > 0.5 && s.overall_mastery <= 0.75);
    const b4 = data.students.filter((s) => s.overall_mastery > 0.75);

    return [
      {
        label: "0–25%",
        desc: "Pemahaman Awal",
        count: b1.length,
        color: "linear-gradient(180deg, #f43f5e, #be123c)",
      },
      {
        label: "26–50%",
        desc: "Mulai Menguasai",
        count: b2.length,
        color: "linear-gradient(180deg, #f59e0b, #b45309)",
      },
      {
        label: "51–75%",
        desc: "Berkembang Baik",
        count: b3.length,
        color: "linear-gradient(180deg, #3b82f6, #1d4ed8)",
      },
      {
        label: "76–100%",
        desc: "Mahir & Mandiri",
        count: b4.length,
        color: "linear-gradient(180deg, #10b981, #047857)",
      },
    ];
  }, [data.students]);

  const maxBracketCount = Math.max(1, ...brackets.map((b) => b.count));

  // Filtered & Paginated students
  const filteredStudents = useMemo(() => {
    const list = data.students.filter((student) => {
      if (rosterSearch) {
        const q = rosterSearch.toLowerCase();
        if (!student.student_name.toLowerCase().includes(q)) return false;
      }
      if (rosterFilter === "needs-help" && student.overall_mastery >= 0.5) return false;
      if (rosterFilter === "low-accuracy" && student.quiz_accuracy >= 0.5) return false;
      return true;
    });

    if (rosterFilter === "most-active") {
      return list.sort((a, b) => b.n_sessions - a.n_sessions);
    }
    // Default sort: lowest mastery first (students who need support most appear at top)
    return list.sort((a, b) => a.overall_mastery - b.overall_mastery);
  }, [data.students, rosterSearch, rosterFilter]);

  const totalFiltered = filteredStudents.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * PAGE_SIZE;
  const paginatedStudents = filteredStudents.slice(startIndex, startIndex + PAGE_SIZE);

  return (
    <section className="teacher-analytics-workspace" aria-label={t("Analitik siswa")}>
      <LoadingStatus active={loading} label="Memuat analitik kelas…" />
      <Heading
        icon={<BarChart3 size={24} aria-hidden="true" />}
        title={<UiText>{"Analitik siswa"}</UiText>}
        description={<UiText>{"Pantau pola belajar cohort dan buka detail siswa untuk tindak lanjut yang lebih terarah."}</UiText>}
      >
        <button type="button" className="button secondary" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw size={16} className={loading ? "spin" : undefined} aria-hidden="true" />
          <UiText>{"Perbarui data"}</UiText>
        </button>
      </Heading>

      <div className="analytics-window-tabs" role="tablist" aria-label={t("Rentang waktu cohort")}>
        {windows.map((item) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={window === item.value}
            className={window === item.value ? "active" : ""}
            onClick={() => void load(item.value)}
            disabled={loading}
          >
            {t(item.label)}
          </button>
        ))}
      </div>

      {error && <p className="alert error-message analytics-error" role="alert">{error}</p>}

      {/* Top Level Summary Stat Cards */}
      <div className="analytics-stat-grid">
        <article className="panel analytics-stat-card">
          <span className="analytics-stat-icon blue"><Users size={19} aria-hidden="true" /></span>
          <span className="analytics-stat-label"><UiText>{"Siswa aktif"}</UiText></span>
          <strong>{data.n_students}</strong>
          <small><UiText>{"akun siswa terpantau"}</UiText></small>
        </article>
        <article className="panel analytics-stat-card">
          <span className="analytics-stat-icon purple"><BarChart3 size={19} aria-hidden="true" /></span>
          <span className="analytics-stat-label"><UiText>{"Rata-rata mastery"}</UiText></span>
          <strong>{percent(data.avg_mastery)}</strong>
          <small><UiText>{"penguasaan konsep cohort"}</UiText></small>
        </article>
        <article className="panel analytics-stat-card">
          <span className="analytics-stat-icon green"><ArrowRight size={19} aria-hidden="true" /></span>
          <span className="analytics-stat-label"><UiText>{"Akurasi latihan"}</UiText></span>
          <strong>{percent(data.avg_quiz_accuracy)}</strong>
          <small><UiText>{"jawaban benar rata-rata"}</UiText></small>
        </article>
      </div>

      {/* Interactive Visual Cohort Charts */}
      <div className="admin-charts-grid">
        {/* Chart 1: Distribusi Kesiapan Siswa */}
        <article className="panel admin-chart-card">
          <div className="panel-heading">
            <div>
              <div className="chart-kicker">
                <PieChart size={15} aria-hidden="true" />
                <span><UiText>{"DISTRIBUSI KESIAPAN SISWA"}</UiText></span>
              </div>
              <h2><UiText>{"Komposisi Tingkat Penguasaan"}</UiText></h2>
              <p><UiText>{"Perbandingan siswa yang perlu pendampingan, berkembang, dan mahir."}</UiText></p>
            </div>
            <span className="chart-active-pill">
              <span className="pulsing-dot" aria-hidden="true" />
              {data.n_students} <UiText>{" siswa"}</UiText>
            </span>
          </div>

          {/* Visual Ratio Progress Bar */}
          <div className="role-ratio-bar-wrap" aria-label={t("Grafik perbandingan kesiapan siswa")}>
            <div className="role-ratio-bar">
              <div
                className="segment segment-needs-help"
                style={{ width: `${needsHelpPct}%` }}
                title={`${t("Perlu Bimbingan")}: ${needsHelp.length} (${Math.round(needsHelpPct)}%)`}
              />
              <div
                className="segment segment-developing"
                style={{ width: `${developingPct}%` }}
                title={`${t("Berkembang")}: ${developing.length} (${Math.round(developingPct)}%)`}
              />
              <div
                className="segment segment-mastering"
                style={{ width: `${masteringPct}%` }}
                title={`${t("Mahir")}: ${mastering.length} (${Math.round(masteringPct)}%)`}
              />
            </div>
          </div>

          {/* Legend Cards */}
          <div className="role-legend-grid">
            <div className="role-legend-card">
              <div className="legend-indicator rose" />
              <div>
                <span className="legend-title"><UiText>{"Perlu Bimbingan"}</UiText></span>
                <span className="legend-value">{needsHelp.length}</span>
                <span className="legend-pct">{Math.round(needsHelpPct)}%</span>
              </div>
            </div>
            <div className="role-legend-card">
              <div className="legend-indicator blue" />
              <div>
                <span className="legend-title"><UiText>{"Berkembang"}</UiText></span>
                <span className="legend-value">{developing.length}</span>
                <span className="legend-pct">{Math.round(developingPct)}%</span>
              </div>
            </div>
            <div className="role-legend-card">
              <div className="legend-indicator green" />
              <div>
                <span className="legend-title"><UiText>{"Mahir"}</UiText></span>
                <span className="legend-value">{mastering.length}</span>
                <span className="legend-pct">{Math.round(masteringPct)}%</span>
              </div>
            </div>
          </div>
        </article>

        {/* Chart 2: Sebaran Pemahaman Konsep (Histogram) */}
        <article className="panel admin-chart-card">
          <div className="panel-heading">
            <div>
              <div className="chart-kicker">
                <BarChart3 size={15} aria-hidden="true" />
                <span><UiText>{"SEBARAN PEMAHAMAN KONSEP"}</UiText></span>
              </div>
              <h2><UiText>{"Distribusi Skor Penguasaan Materi"}</UiText></h2>
              <p><UiText>{"Jumlah siswa pada tiap rentang penguasaan cohort."}</UiText></p>
            </div>
            <span className="chart-active-pill">
              <BarChart3 size={13} aria-hidden="true" />
              {percent(data.avg_mastery)}
            </span>
          </div>

          {/* Visual Column / Histogram Bars */}
          <div className="learning-chart-bars" aria-label={t("Grafik distribusi pemahaman siswa")}>
            {brackets.map((item) => {
              const heightPct = Math.max(14, Math.round((item.count / maxBracketCount) * 100));
              return (
                <div className="learning-bar-col" key={item.label}>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{
                        height: `${heightPct}%`,
                        background: item.color,
                      }}
                      title={`${item.desc}: ${item.count} siswa`}
                    >
                      <span className="bar-val-badge">{item.count}</span>
                    </div>
                  </div>
                  <div className="bar-info">
                    <strong className="bar-label">{item.label}</strong>
                    <span className="bar-desc">{t(item.desc)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </article>
      </div>

      {/* Two-Column Workspace: Left = Student Roster with Pagination; Right = Priority Concepts */}
      <div className="teacher-analytics-grid">
        {/* Left Column: Daftar Siswa (Paginated & Filterable) */}
        <article className="panel analytics-card teacher-roster-card">
          <div className="analytics-card-heading">
            <div>
              <h3><UiText>{"Siapa yang perlu kamu dampingi?"}</UiText></h3>
              <p style={{ margin: "2px 0 0", fontSize: "0.82rem", color: "#64748b" }}>
                <UiText>{"Menampilkan "}</UiText>
                {totalFiltered > 0 ? `${startIndex + 1}–${Math.min(startIndex + PAGE_SIZE, totalFiltered)}` : 0}
                <UiText>{" dari "}</UiText>
                {totalFiltered}
                <UiText>{" siswa"}</UiText>
              </p>
            </div>
            <Users size={20} aria-hidden="true" />
          </div>

          {/* Search and Filter Tabs */}
          <div className="teacher-roster-toolbar">
            <div className="roster-search-input-wrap">
              <Search size={15} aria-hidden="true" />
              <input
                type="search"
                className="roster-search-input"
                placeholder={t("Cari nama siswa...")}
                value={rosterSearch}
                onChange={(e) => {
                  setRosterSearch(e.target.value);
                  setCurrentPage(1);
                }}
              />
            </div>
            <div className="roster-filter-tabs">
              <button
                type="button"
                className={`roster-filter-btn ${rosterFilter === "all" ? "active" : ""}`}
                onClick={() => {
                  setRosterFilter("all");
                  setCurrentPage(1);
                }}
              >
                <UiText>{"Semua"}</UiText> ({data.students.length})
              </button>
              <button
                type="button"
                className={`roster-filter-btn ${rosterFilter === "needs-help" ? "active" : ""}`}
                onClick={() => {
                  setRosterFilter("needs-help");
                  setCurrentPage(1);
                }}
              >
                <UiText>{"Perlu Bimbingan"}</UiText> ({needsHelp.length})
              </button>
              <button
                type="button"
                className={`roster-filter-btn ${rosterFilter === "low-accuracy" ? "active" : ""}`}
                onClick={() => {
                  setRosterFilter("low-accuracy");
                  setCurrentPage(1);
                }}
              >
                <UiText>{"Sering Salah"}</UiText>
              </button>
              <button
                type="button"
                className={`roster-filter-btn ${rosterFilter === "most-active" ? "active" : ""}`}
                onClick={() => {
                  setRosterFilter("most-active");
                  setCurrentPage(1);
                }}
              >
                <UiText>{"Paling Aktif"}</UiText>
              </button>
            </div>
          </div>

          {paginatedStudents.length ? (
            <>
              <div className="teacher-student-list">
                {paginatedStudents.map((student) => (
                  <Link
                    href={`/guru/siswa/${encodeURIComponent(student.student_id)}`}
                    className="teacher-student-row"
                    key={student.student_id}
                  >
                    <span className="teacher-student-avatar" aria-hidden="true">
                      {student.student_name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="teacher-student-main">
                      <strong>{student.student_name}</strong>
                      <small>
                        {student.n_sessions}
                        <UiText>{" sesi · akurasi "}</UiText>
                        {percent(student.quiz_accuracy)}
                      </small>
                    </span>
                    <span className={`teacher-risk ${student.overall_mastery < 0.5 ? "needs-help" : ""}`}>
                      {percent(student.overall_mastery)}
                    </span>
                    <ArrowRight size={16} aria-hidden="true" />
                  </Link>
                ))}
              </div>

              {/* Roster Pagination Bar */}
              {totalPages > 1 && (
                <div className="roster-pagination-bar">
                  <span className="roster-pagination-info">
                    <UiText>{"Halaman "}</UiText>
                    {safeCurrentPage} / {totalPages}
                  </span>
                  <div className="roster-pagination-buttons">
                    <button
                      type="button"
                      className="roster-page-btn"
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={safeCurrentPage <= 1}
                      aria-label={t("Halaman sebelumnya")}
                    >
                      <ChevronLeft size={16} aria-hidden="true" />
                    </button>
                    {Array.from({ length: totalPages }, (_, idx) => idx + 1).map((pageNum) => (
                      <button
                        key={pageNum}
                        type="button"
                        className={`roster-page-btn ${pageNum === safeCurrentPage ? "active" : ""}`}
                        onClick={() => setCurrentPage(pageNum)}
                      >
                        {pageNum}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="roster-page-btn"
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={safeCurrentPage >= totalPages}
                      aria-label={t("Halaman berikutnya")}
                    >
                      <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : rosterSearch || rosterFilter !== "all" ? (
            <div style={{ textAlign: "center", padding: "2rem 1rem" }}>
              <p style={{ fontWeight: 700, margin: "0 0 4px", color: "#1e293b" }}>
                <UiText>{"Siswa tidak ditemukan"}</UiText>
              </p>
              <p style={{ color: "#64748b", fontSize: "0.84rem", margin: "0 0 12px" }}>
                <UiText>{"Tidak ada siswa yang sesuai dengan filter pencarian."}</UiText>
              </p>
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setRosterSearch("");
                  setRosterFilter("all");
                  setCurrentPage(1);
                }}
              >
                <UiText>{"Reset filter"}</UiText>
              </button>
            </div>
          ) : (
            <p className="analytics-empty"><UiText>{"Belum ada siswa aktif pada periode ini."}</UiText></p>
          )}
        </article>

        {/* Right Column: Konsep Prioritas */}
        <article className="panel analytics-card">
          <div className="analytics-card-heading">
            <div>
              <h3><UiText>{"Topik yang paling sering tersendat"}</UiText></h3>
            </div>
            <AlertTriangle size={20} aria-hidden="true" />
          </div>
          {data.cohort_weak_concepts.length ? (
            <div className="teacher-weak-list">
              {data.cohort_weak_concepts.map((concept) => (
                <div className="teacher-weak-item" key={concept.concept_name}>
                  <div>
                    <strong>{concept.concept_name}</strong>
                    <span>{concept.n_students}<UiText>{" siswa"}</UiText></span>
                  </div>
                  <GameProgress
                    max={1}
                    value={concept.avg_mastery}
                    size="sm"
                    showPercentage={false}
                    aria-label={`${concept.concept_name} ${percent(concept.avg_mastery)}`}
                    variant="amber"
                  />
                  <small><UiText>{"Rata-rata mastery "}</UiText>{percent(concept.avg_mastery)}</small>
                </div>
              ))}
            </div>
          ) : (
            <div className="teacher-concept-safe-card">
              <ShieldCheck size={26} aria-hidden="true" />
              <p>
                <UiText>
                  {"Semua konsep dalam batas aman. Siswa belum mengalami kesulitan signifikan pada materi latihan saat ini."}
                </UiText>
              </p>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}

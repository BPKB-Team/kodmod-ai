"use client";
import { LoadingStatus } from "./loading-feedback";
import { UiText, useI18n } from "@/components/language-provider";
import { Heading } from "./ui";


import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, ArrowRight, BarChart3, RefreshCw, Users } from "lucide-react";
import { notifyResult } from "@/lib/dialogs";
import type { AnalyticsWindow } from "@/lib/analytics-types";
import type { TeacherCohort } from "@/lib/teacher-types";

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

export function TeacherAnalytics({ initial }: { initial: TeacherCohort }) {
  const { t } = useI18n();
  const [data, setData] = useState(initial);
  const [window, setWindow] = useState<AnalyticsWindow>(initial.window);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load(next: AnalyticsWindow) {
    if (loading) return false;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/teacher/students?window=${next}`, { cache: "no-store" });
      const payload = await readJson<TeacherCohort>(response, "Data cohort belum dapat dimuat.");
      setData(payload);
      setWindow(next);
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

  return (
    <section className="teacher-analytics-workspace" aria-label={t("Analitik siswa")}>
      <LoadingStatus active={loading} label="Memuat analitik kelas…" />
      <Heading
        kicker={
          <span className="analytics-kicker">
            <BarChart3 size={14} aria-hidden="true" />
            <UiText>{"ANALITIK SISWA"}</UiText>
          </span>
        }
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

      <div className="teacher-analytics-grid">
        <article className="panel analytics-card teacher-roster-card">
          <div className="analytics-card-heading">
            <div>
              <span className="analytics-kicker"><UiText>{"DAFTAR SISWA"}</UiText></span>
              <h3><UiText>{"Siapa yang perlu kamu dampingi?"}</UiText></h3>
            </div>
            <Users size={20} aria-hidden="true" />
          </div>
          {data.students.length ? (
            <div className="teacher-student-list">
              {data.students.map((student) => (
                <Link href={`/guru/siswa/${encodeURIComponent(student.student_id)}`} className="teacher-student-row" key={student.student_id}>
                  <span className="teacher-student-avatar" aria-hidden="true">{student.student_name.slice(0, 1).toUpperCase()}</span>
                  <span className="teacher-student-main">
                    <strong>{student.student_name}</strong>
                    <small>{student.n_sessions}<UiText>{" sesi · akurasi "}</UiText>{percent(student.quiz_accuracy)}</small>
                  </span>
                  <span className={`teacher-risk ${student.overall_mastery < 0.5 ? "needs-help" : ""}`}>
                    {percent(student.overall_mastery)}
                  </span>
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
              ))}
            </div>
          ) : (
            <p className="analytics-empty"><UiText>{"Belum ada siswa aktif pada periode ini."}</UiText></p>
          )}
        </article>

        <article className="panel analytics-card">
          <div className="analytics-card-heading">
            <div>
              <span className="analytics-kicker"><UiText>{"KONSEP PRIORITAS"}</UiText></span>
              <h3><UiText>{"Topik yang paling sering tersendat"}</UiText></h3>
            </div>
            <AlertTriangle size={20} aria-hidden="true" />
          </div>
          {data.cohort_weak_concepts.length ? (
            <div className="teacher-weak-list">
              {data.cohort_weak_concepts.map((concept) => (
                <div className="teacher-weak-item" key={concept.concept_name}>
                  <div><strong>{concept.concept_name}</strong><span>{concept.n_students}<UiText>{" siswa"}</UiText></span></div>
                  <progress max={1} value={concept.avg_mastery} aria-label={`${concept.concept_name} ${percent(concept.avg_mastery)}`} />
                  <small><UiText>{"Rata-rata mastery "}</UiText>{percent(concept.avg_mastery)}</small>
                </div>
              ))}
            </div>
          ) : (
            <p className="analytics-empty"><UiText>{"Belum ada topik prioritas dari data ini."}</UiText></p>
          )}
        </article>
      </div>
    </section>
  );
}

"use client";
import { LoadingStatus } from "./loading-feedback";
import { UiText, useI18n } from "@/components/language-provider";


import { useState, useEffect, useSyncExternalStore } from "react";
import {
  AlertTriangle,
  BookOpenCheck,
  Clock3,
  Headphones,
  RefreshCw,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import { notifyResult } from "@/lib/dialogs";
import { masteryLabel, studyTimeLabel } from "@/lib/analytics-display.mjs";
import type {
  AnalyticsWindow,
  StudentAnalytics,
  StudentAnalyticsSpoken,
} from "@/lib/analytics-types";
import { VoiceControls } from "./voice-controls";

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

function subscribeTimezone(listener: () => void) {
  globalThis.window.addEventListener("focus", listener);
  return () => globalThis.window.removeEventListener("focus", listener);
}
function browserTimezone() { return Intl.DateTimeFormat().resolvedOptions().timeZone; }

export function StudentAnalytics({
  initial,
  initialSpoken,
  hideVoiceCard = false,
}: {
  initial: StudentAnalytics;
  initialSpoken: string;
  hideVoiceCard?: boolean;
}) {
  const { t, language } = useI18n();
  const [data, setData] = useState(initial);
  const [spoken, setSpoken] = useState(initialSpoken);
  const [window, setWindow] = useState<AnalyticsWindow>(initial.window);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const hasConceptMastery = data.mastery_available ?? (data.weak_concepts.length > 0 || data.strong_concepts.length > 0);
  const officialAnswers = data.n_official_questions ?? data.n_quiz_attempts;
  const accuracyText = officialAnswers ? percent(data.quiz_accuracy) : t("Belum dinilai");
  const timezone = useSyncExternalStore(subscribeTimezone, browserTimezone, () => initial.timezone ?? "UTC");
  const query = (period: AnalyticsWindow) => new URLSearchParams({window:period, timezone}).toString();
  useEffect(() => {
    if ((data.timezone ?? "UTC") === timezone) return;
    let active = true;
    const params = new URLSearchParams({window, timezone});
    void fetch(`/api/analytics/me/spoken?${params}`, {cache:"no-store"})
      .then(r => readJson<StudentAnalyticsSpoken>(r,"Ringkasan suara belum dapat dimuat."))
      .then(payload => { if (active) { setData(payload.summary); setSpoken(payload.spoken); } })
      .catch(() => { /* Explicit refresh remains available. */ });
    return () => { active = false; };
  }, [data.timezone, window, timezone]);
  const hasLearningActivity = data.n_sessions > 0 || data.n_quiz_attempts > 0;

  async function changeWindow(next: AnalyticsWindow) {
    if (next === window || loading) return;
    setWindow(next);
    setLoading(true);
    setError("");
    try {
      const spokenPayload = await readJson<StudentAnalyticsSpoken>(
        await fetch(`/api/analytics/me/spoken?${query(next)}`, {cache:"no-store"}),
        "Data progres belum dapat dimuat.",
      );
      setData(spokenPayload.summary);
      setSpoken(spokenPayload.spoken);
    } catch (caught) {
      setWindow(data.window);
      setError(caught instanceof Error ? caught.message : "Data progres belum dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const spokenPayload = await readJson<StudentAnalyticsSpoken>(
        await fetch(`/api/analytics/me/spoken?${query(window)}`, {cache:"no-store"}),
        "Data progres belum dapat dimuat.",
      );
      setData(spokenPayload.summary);
      setSpoken(spokenPayload.spoken);
      await notifyResult("Data progres sudah diperbarui.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Data progres belum dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="analytics-workspace" id="statistik-progres" aria-label={t("Progres belajar siswa")}>
      <LoadingStatus active={loading} label="Memuat progres belajar…" />
      <div className="analytics-toolbar">
        <div>
          <h2><UiText>{"Perkembangan belajarmu"}</UiText></h2>
          <p><UiText>{"Lihat hasil latihan dan tugas untuk memilih materi berikutnya."}</UiText></p>
        </div>
        <button type="button" className="button secondary" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw size={16} className={loading ? "spin" : undefined} aria-hidden="true" /><UiText>{"Perbarui data"}</UiText></button>
      </div>

      <div className="analytics-window-tabs" role="tablist" aria-label={t("Rentang waktu progres")}>
        {windows.map((item) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={window === item.value}
            aria-label={`${t("Rentang waktu")} ${t(item.label)}`}
            className={window === item.value ? "active" : ""}
            onClick={() => void changeWindow(item.value)}
            disabled={loading}
          >
            {t(item.label)}
          </button>
        ))}
      </div>

      {error && <p className="alert error-message analytics-error" role="alert">{t(error)}</p>}

      {!hideVoiceCard && (
        <article className="panel analytics-card analytics-voice-card">
          <div className="analytics-card-heading">
            <div>
              <span className="analytics-kicker"><Headphones size={14} aria-hidden="true" /><UiText>{" RINGKASAN SUARA"}</UiText></span>
              <h3><UiText>{"Dengarkan progresmu"}</UiText></h3>
            </div>
          </div>
          <p className="analytics-spoken">{spoken}</p>
          <VoiceControls text={spoken} />
        </article>
      )}

      <div className="analytics-hero panel">
        <div className="analytics-hero-copy">
          <h3>{data.student_name}</h3>
          <p>{hasConceptMastery ? masteryLabel(data.overall_mastery, language) : <UiText>{"Penguasaan konsep belum tersedia"}</UiText>} · {data.n_sessions}<UiText>{" sesi belajar pada periode ini."}</UiText></p>
          {hasConceptMastery && <progress max={1} value={data.overall_mastery} aria-label={t("Penguasaan materi {value}", { value: percent(data.overall_mastery) })} />}
          <div className="analytics-progress-meta">
            <strong>{hasConceptMastery ? percent(data.overall_mastery) : "—"}</strong>
            <span><UiText>{hasConceptMastery ? "penguasaan materi" : "belum ada data konsep"}</UiText></span>
          </div>
        </div>
        <div className="analytics-hero-mark" aria-hidden="true">
          <Target size={44} strokeWidth={1.5} />
          <span><UiText>{"Langkah kecil"}</UiText><br /><UiText>{"tetap berarti."}</UiText></span>
        </div>
      </div>

      <div className="analytics-stat-grid">
        <article className="panel analytics-stat-card" tabIndex={0} aria-label={`${t("Akurasi latihan dan tugas")}: ${accuracyText}. ${officialAnswers} ${t("soal tercatat")}.`}>
          <span className="analytics-stat-icon blue"><BookOpenCheck size={19} aria-hidden="true" /></span>
          <span className="analytics-stat-label"><UiText>{"Akurasi latihan dan tugas"}</UiText></span>
          <strong>{accuracyText}</strong>
          <small>{officialAnswers}<UiText>{" soal tercatat"}</UiText></small>
        </article>
        <article className="panel analytics-stat-card" tabIndex={0} aria-label={`${t("Durasi sesi")}: ${studyTimeLabel(data.total_minutes, language)}. ${data.interaction_count} ${t("interaksi dengan tutor")}.`}>
          <span className="analytics-stat-icon purple"><Clock3 size={19} aria-hidden="true" /></span>
          <span className="analytics-stat-label"><UiText>{"Durasi sesi"}</UiText></span>
          <strong>{studyTimeLabel(data.total_minutes, language)}</strong>
          <small>{data.interaction_count}<UiText>{" interaksi dengan tutor"}</UiText></small>
        </article>
        <article className="panel analytics-stat-card" tabIndex={0} aria-label={`${t("Konsistensi")}: ${percent(data.engagement_index)}. ${t("ritme belajar pada periode ini")}.`}>
          <span className="analytics-stat-icon green"><TrendingUp size={19} aria-hidden="true" /></span>
          <span className="analytics-stat-label"><UiText>{"Konsistensi"}</UiText></span>
          <strong>{percent(data.engagement_index)}</strong>
          <small><UiText>{"ritme belajar pada periode ini"}</UiText></small>
        </article>
        <article className="panel analytics-stat-card" tabIndex={0} aria-label={`${t("Tugas selesai")}: ${data.n_assignment_submissions ?? 0}. ${t("tugas dikumpulkan pada periode ini")}.`}>
          <span className="analytics-stat-icon blue"><BookOpenCheck size={19} aria-hidden="true" /></span>
          <span className="analytics-stat-label"><UiText>{"Tugas selesai"}</UiText></span>
          <strong>{data.n_assignment_submissions ?? 0}</strong>
          <small><UiText>{"tugas dikumpulkan pada periode ini"}</UiText></small>
        </article>
      </div>

      <div className="analytics-answer-breakdown">
        <span><UiText>{"Percobaan bantuan"}</UiText><strong>{data.n_support_attempts ?? 0}</strong></span>
        <span><UiText>{"Jawaban latihan"}</UiText><strong>{data.n_practice_answers ?? data.n_quiz_attempts}</strong></span>
        <span><UiText>{"Jawaban tugas"}</UiText><strong>{data.n_assignment_answers ?? 0}</strong></span>
      </div>

      {data.learning_materials && <article className="panel analytics-card">
        <h3><UiText>{"Progres bersama Tutor"}</UiText></h3>
        <p>{data.materials_completed ?? 0} <UiText>{"materi selesai"}</UiText> · {data.completed_units ?? 0} / {data.total_units ?? 0} <UiText>{"bagian selesai"}</UiText></p>
        <progress value={data.completed_units ?? 0} max={data.total_units || 1} aria-label={t("Bagian materi selesai")} />
        <p>{data.assessed_concepts ?? 0} <UiText>{"konsep memiliki bukti latihan"}</UiText>. {data.mapped_concepts ?? 0} <UiText>{"konsep terpetakan pada materi saat ini"}</UiText>.</p>
        <p className="muted"><UiText>{"Selesai belajar dan penanda baca tidak menambah penguasaan konsep secara otomatis."}</UiText></p>
        {data.last_activity_at && <p><UiText>{"Aktivitas terakhir tercatat"}</UiText>: <time dateTime={data.last_activity_at}>{new Intl.DateTimeFormat(language === "en" ? "en" : "id", {dateStyle:"medium",timeStyle:"short",timeZone:data.timezone??"UTC"}).format(new Date(data.last_activity_at))}</time></p>}
        <small><UiText>{"Penguasaan konsep bersifat kumulatif; aktivitas mengikuti periode yang dipilih."}</UiText> {data.timezone}</small>
      </article>}
      <div className="analytics-columns">
        <article className="panel analytics-card">
          <div className="analytics-card-heading">
            <div>
              <span className="analytics-kicker"><UiText>{"FOKUS BERIKUTNYA"}</UiText></span>
              <h3><UiText>{"Konsep yang perlu dikuatkan"}</UiText></h3>
            </div>
            <AlertTriangle size={20} aria-hidden="true" />
          </div>
          {data.weak_concepts.length ? (
            <div className="analytics-concept-list">
              {data.weak_concepts.map((concept) => (
                <div className="analytics-concept" key={concept.concept_id}>
                  <div className="analytics-concept-top">
                    <strong>{concept.concept_name}</strong>
                    <span>{percent(concept.mastery)}</span>
                  </div>
                  <progress max={1} value={concept.mastery} aria-label={`${concept.concept_name} ${percent(concept.mastery)}`} />
                  <small>{concept.n_attempts}<UiText>{" latihan · coba satu langkah lagi hari ini"}</UiText></small>
                </div>
              ))}
            </div>
          ) : (
            <p className="analytics-empty"><UiText>{hasLearningActivity
              ? "Aktivitasmu tercatat. Label konsep memerlukan setidaknya 3 soal mandiri dari 2 sesi."
              : "Belum ada konsep yang perlu perhatian khusus."}</UiText></p>
          )}
        </article>

        <article className="panel analytics-card">
          <div className="analytics-card-heading">
            <div>
              <span className="analytics-kicker"><UiText>{"KEKUATANMU"}</UiText></span>
              <h3><UiText>{"Konsep yang sudah menguat"}</UiText></h3>
            </div>
            <Sparkles size={20} aria-hidden="true" />
          </div>
          {data.strong_concepts.length ? (
            <div className="analytics-concept-list">
              {data.strong_concepts.map((concept) => (
                <div className="analytics-concept" key={concept.concept_id}>
                  <div className="analytics-concept-top">
                    <strong>{concept.concept_name}</strong>
                    <span>{percent(concept.mastery)}</span>
                  </div>
                  <progress max={1} value={concept.mastery} aria-label={`${concept.concept_name} ${percent(concept.mastery)}`} />
                  <small>{concept.n_attempts}<UiText>{" latihan · pertahankan dengan menjelaskan ulang"}</UiText></small>
                </div>
              ))}
            </div>
          ) : (
            <p className="analytics-empty"><UiText>{hasLearningActivity
              ? "Kumpulkan beberapa jawaban mandiri untuk menilai kekuatan konsep secara lebih andal."
              : "Selesaikan satu latihan untuk melihat kekuatanmu."}</UiText></p>
          )}
        </article>
      </div>


    </section>
  );
}

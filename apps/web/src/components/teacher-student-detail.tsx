"use client";
import { LoadingStatus } from "./loading-feedback";
import { Skeleton } from "./ui/skeleton";
import { UiText, UiDate } from "@/components/language-provider";


import Link from "next/link";
import { useState } from "react";
import {
  ArrowLeft,
  BookOpenCheck,
  ChevronDown,
  ChevronUp,
  Clock3,
  MessageSquareText,
  RefreshCw,
  Target,
} from "lucide-react";
import { notifyResult } from "@/lib/dialogs";
import type { AnalyticsWindow } from "@/lib/analytics-types";
import type {
  TeacherSession,
  TeacherStudentDetail,
  TeacherTranscript,
} from "@/lib/teacher-types";
import { GameProgress } from "./ui/game-progress";
import { analyticsWindowLabel } from "@/lib/analytics-display.mjs";

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

export function TeacherStudentDetailView({
  initial,
  initialSessions,
}: {
  initial: TeacherStudentDetail;
  initialSessions: TeacherSession[];
}) {
  const [data, setData] = useState(initial);
  const [sessions, setSessions] = useState(initialSessions);
  const [window, setWindow] = useState<AnalyticsWindow>(initial.analytics.window);
  const [transcript, setTranscript] = useState<TeacherTranscript | null>(null);
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [error, setError] = useState("");

  async function refresh(next = window) {
    if (loading || loadingTranscript) return;
    setLoading(true);
    setError("");
    try {
      const [detailResponse, sessionsResponse] = await Promise.all([
        fetch(`/api/teacher/students/${encodeURIComponent(data.account.id)}?window=${next}`, { cache: "no-store" }),
        fetch(`/api/teacher/students/${encodeURIComponent(data.account.id)}/sessions?limit=50`, { cache: "no-store" }),
      ]);
      const detail = await readJson<TeacherStudentDetail>(detailResponse, "Detail siswa belum dapat dimuat.");
      const nextSessions = await readJson<TeacherSession[]>(sessionsResponse, "Riwayat sesi belum dapat dimuat.");
      setData(detail);
      setSessions(nextSessions);
      setWindow(next);
      await notifyResult("Data siswa sudah diperbarui.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Data siswa belum dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }

  async function toggleTranscript(id: string) {
    if (loading || loadingTranscript) return;
    if (openSessionId === id) {
      setOpenSessionId(null);
      return;
    }
    setOpenSessionId(id);
    setLoadingTranscript(true);
    setError("");
    try {
      const response = await fetch(`/api/teacher/sessions/${encodeURIComponent(id)}`, { cache: "no-store" });
      setTranscript(await readJson<TeacherTranscript>(response, "Transcript belum dapat dimuat."));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Transcript belum dapat dimuat.");
      setOpenSessionId(null);
    } finally {
      setLoadingTranscript(false);
    }
  }

  const analytics = data.analytics;
  return (
    <section className="teacher-detail-workspace" aria-label={`Detail siswa ${data.account.full_name}`}>
      <LoadingStatus active={loading} label="Memuat progres siswa…" />
      <LoadingStatus active={loadingTranscript} label="Membuka riwayat sesi…" />
      <Link className="learning-back" href="/guru/analitik"><ArrowLeft size={16} aria-hidden="true" /><UiText>{"Kembali ke analitik"}</UiText></Link>
      <div className="teacher-detail-heading">
        <div className="teacher-profile-heading">
          <span className="teacher-profile-avatar" aria-hidden="true">{data.account.full_name.slice(0, 1).toUpperCase()}</span>
          <div>
            <h2>{data.account.full_name}</h2>
            <p>@{data.account.username} · {data.account.is_active ? <UiText>{"Akun aktif"}</UiText> : <UiText>{"Akun nonaktif"}</UiText>}</p>
          </div>
        </div>
        <button type="button" className="button secondary" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw size={16} className={loading ? "spin" : undefined} aria-hidden="true" /><UiText>{"Perbarui"}</UiText></button>
      </div>
      {error && <p className="alert error-message analytics-error" role="alert"><UiText>{error}</UiText></p>}

      <div className="teacher-summary panel">
        <Target size={21} aria-hidden="true" />
        <p>{data.teacher_summary}</p>
      </div>

      <div className="analytics-stat-grid">
        <article className="panel analytics-stat-card">
          <span className="analytics-stat-icon blue"><Target size={19} aria-hidden="true" /></span>
          <span className="analytics-stat-label"><UiText>{"Mastery"}</UiText></span>
          <strong>{percent(analytics.overall_mastery)}</strong>
          <small><UiText>{"periode "}</UiText><UiText>{analyticsWindowLabel(analytics.window)}</UiText></small>
        </article>
        <article className="panel analytics-stat-card">
          <span className="analytics-stat-icon purple"><BookOpenCheck size={19} aria-hidden="true" /></span>
          <span className="analytics-stat-label"><UiText>{"Akurasi"}</UiText></span>
          <strong>{percent(analytics.quiz_accuracy)}</strong>
          <small>{analytics.n_quiz_attempts}<UiText>{" jawaban"}</UiText></small>
        </article>
        <article className="panel analytics-stat-card">
          <span className="analytics-stat-icon green"><Clock3 size={19} aria-hidden="true" /></span>
          <span className="analytics-stat-label"><UiText>{"Waktu belajar"}</UiText></span>
          <strong>{Math.round(analytics.total_minutes)}<UiText>{" mnt"}</UiText></strong>
          <small>{analytics.n_sessions}<UiText>{" sesi"}</UiText></small>
        </article>
      </div>

      <div className="teacher-detail-grid">
        <article className="panel analytics-card">
          <div className="analytics-card-heading"><div><span className="analytics-kicker"><UiText>{"AREA PERHATIAN"}</UiText></span><h3><UiText>{"Konsep yang perlu diperkuat"}</UiText></h3></div></div>
          {analytics.weak_concepts.length ? (
            <div className="analytics-concept-list">
              {analytics.weak_concepts.map((concept) => (
                <div className="analytics-concept" key={concept.concept_id}>
                  <div className="analytics-concept-top"><strong>{concept.concept_name}</strong><span className="game-progress-hud-badge sm"><span className="game-hud-num">{percent(concept.mastery)}</span></span></div>
                  <GameProgress
                    max={1}
                    value={concept.mastery}
                    size="sm"
                    showPercentage={false}
                    aria-label={`${concept.concept_name} ${percent(concept.mastery)}`}
                    variant="amber"
                  />
                  <small>{concept.n_attempts}<UiText>{" latihan tercatat"}</UiText></small>
                </div>
              ))}
            </div>
          ) : <p className="analytics-empty"><UiText>{"Belum ada area perhatian khusus."}</UiText></p>}
        </article>
        <article className="panel analytics-card">
          <div className="analytics-card-heading"><div><span className="analytics-kicker"><UiText>{"SESI TUTOR"}</UiText></span><h3><UiText>{"Riwayat percakapan terbaru"}</UiText></h3></div><MessageSquareText size={20} aria-hidden="true" /></div>
          {sessions.length ? (
            <div className="teacher-session-list">
              {sessions.map((session) => (
                <div className="teacher-session-item" key={session.id}>
                  <button type="button" className="teacher-session-toggle" disabled={loading || loadingTranscript} onClick={() => void toggleTranscript(session.id)} aria-expanded={openSessionId === session.id}>
                    <span><strong>{session.title}</strong><small>{session.subject_name || <UiText>{"Umum"}</UiText>} · {<UiDate value={session.started_at} />}</small></span>
                    {openSessionId === session.id ? <ChevronUp size={17} aria-hidden="true" /> : <ChevronDown size={17} aria-hidden="true" />}
                  </button>
                  {openSessionId === session.id && (
                    <div className="teacher-transcript">
                      {loadingTranscript ? <div aria-hidden="true"><Skeleton className="page-loading-field" /><Skeleton className="page-loading-field" /></div> : transcript?.turns.map((turn, index) => (
                        <div className={`teacher-turn ${turn.role === "student" ? "student" : "assistant"}`} key={`${turn.timestamp || "turn"}-${index}`}>
                          <span>{turn.role === "student" ? <UiText>{"Siswa"}</UiText> : <UiText>{"Tutor"}</UiText>}</span>
                          <p>{turn.text}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : <p className="analytics-empty"><UiText>{"Belum ada sesi percakapan."}</UiText></p>}
        </article>
      </div>
    </section>
  );
}

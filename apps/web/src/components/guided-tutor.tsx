"use client";
import { Textarea } from "@/components/ui/textarea";

import { useRef, useState } from "react";
import { LoadingStatus } from "./loading-feedback";
import { ArrowLeft, ArrowRight, BookOpen, CheckCircle2, Headphones, Library, LoaderCircle, RotateCcw, Send, Sparkles } from "lucide-react";
import type { StudentMaterial } from "@/lib/class-types";
import type { LearningSession } from "@/lib/learning-types";
import { createQuizSubmissionId } from "@/lib/quiz-submission.mjs";
import { confirmAction } from "@/lib/dialogs";
import { UiText, useI18n } from "./language-provider";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { VoiceControls } from "./voice-controls";
import { StudentQuiz } from "./student-quiz";
import "@/styles/guided-learning.css";

async function read<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.message || "Sesi belajar belum dapat dimuat."), { status: response.status });
  return body as T;
}

const actions: Record<string, { label: string; Icon: typeof ArrowRight }> = {
  continue: { label: "Lanjut belajar", Icon: ArrowRight },
  repeat: { label: "Jelaskan lagi", Icon: RotateCcw },
  check: { label: "Cek pemahaman", Icon: CheckCircle2 },
  quiz: { label: "Mini kuis", Icon: Sparkles },
  finish: { label: "Selesaikan belajar", Icon: CheckCircle2 },
};

export function GuidedTutor({ materials, initialSessions, initialMaterialId }: {
  materials: StudentMaterial[];
  initialSessions: LearningSession[];
  initialMaterialId?: string;
}) {
  const { t, language } = useI18n();
  const initial = initialMaterialId ? initialSessions.find((row) => row.material_id === initialMaterialId) : initialSessions[0];
  const [lesson, setLesson] = useState<LearningSession | null>(initial ?? null);
  const [sessions, setSessions] = useState(initialSessions);
  const [materialId, setMaterialId] = useState(initialMaterialId ?? initial?.material_id ?? "");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [autoPlayKey, setAutoPlayKey] = useState<string | null>(null);
  const [lastQuestion, setLastQuestion] = useState("");
  const inFlight = useRef(false);
  const pending = useRef<{ path: string; body: Record<string, unknown> } | null>(null);
  const explanation = useRef<HTMLHeadingElement>(null);
  const locked = lesson?.phase === "quiz";
  const selected = materials.find((row) => row.id === materialId);

  function accept(next: LearningSession, play = false) {
    setLesson(next);
    setMaterialId(next.material_id);
    setSessions((rows) => [next, ...rows.filter((row) => row.session_id !== next.session_id)]);
    if (play && next.phase === "learning") setAutoPlayKey(`${next.session_id}:${next.revision}`);
    requestAnimationFrame(() => explanation.current?.focus());
  }

  async function recover(id: string) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    setBusyLabel("Membuka sesi belajar…"); setBusyAction("resume");
    try { accept(await read<LearningSession>(await fetch(`/api/learning/sessions/${id}`, { cache: "no-store" }))); }
    catch (caught) { setError(caught instanceof Error ? caught.message : t("Sesi belum dapat dibuka.")); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function begin(target?: StudentMaterial) {
    const mat = target ?? selected;
    if (inFlight.current || !mat || locked || uncertain) return;
    const isTargetReady = mat.rag_status === "ready" && mat.indexed_version === mat.content_version && (mat.indexed_mapping_version ?? 0) === (mat.mapping_version ?? 0);
    if (!isTargetReady) return;
    if (!(await confirmAction({ title: "Mulai belajar materi ini?", text: mat.title, confirmText: "Mulai belajar" }))) return;
    inFlight.current = true; setBusy(true); setError("");
    setBusyLabel("Menyiapkan penjelasan Tutor…"); setBusyAction("start");
    try {
      const response = await fetch("/api/learning/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ class_id: mat.class_id, material_id: mat.id }) });
      accept(await read<LearningSession>(response), true); setLastQuestion(""); setDraft("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : t("Belajar belum dapat dimulai.")); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function act(action: string, retry = false) {
    if (!lesson || inFlight.current || (!retry && uncertain)) return;
    const text = draft.trim();
    if (action === "question" && !text && !retry) return;
    if (!retry && ["quiz", "check", "finish"].includes(action) && !(await confirmAction({
      title: action === "finish" ? "Selesaikan sesi belajar?" : "Mulai cek pemahaman?",
      text: action === "finish" ? "Penjelasan dan hasil mini kuis tetap tersimpan." : "Jawaban yang sudah dikirim akan disimpan. Selesaikan mini kuis sebelum melanjutkan materi.",
      confirmText: action === "finish" ? "Selesaikan belajar" : "Mulai",
    }))) return;
    const request = retry && pending.current ? pending.current : {
      path: `/api/learning/sessions/${lesson.session_id}/actions`,
      body: { request_id: createQuizSubmissionId(), revision: lesson.revision, action, language, ...(action === "question" ? { text } : {}) },
    };
    pending.current = request;
    inFlight.current = true; setBusy(true); setError("");
    const requestedAction = String(request.body.action);
    setBusyAction(requestedAction);
    setBusyLabel(requestedAction === "question" ? "Tutor sedang menyiapkan jawaban…" : ["quiz", "check"].includes(requestedAction) ? "Menyiapkan mini kuis…" : requestedAction === "finish" ? "Menyimpan progres belajar…" : "Menyiapkan penjelasan Tutor…");
    try {
      const next = await read<LearningSession>(await fetch(request.path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request.body) }));
      pending.current = null; setUncertain(false); accept(next, true);
      if (request.body.action === "question") { setLastQuestion(String(request.body.text)); setDraft(""); }
      else setLastQuestion("");
    } catch (caught) {
      const status = caught && typeof caught === "object" && "status" in caught ? Number(caught.status) : 503;
      if ([400, 401, 403, 404, 409, 422].includes(status)) { pending.current = null; setUncertain(false); }
      else setUncertain(true);
      setError(caught instanceof Error ? caught.message : t("Tindakan belum dapat dipastikan."));
      if (status === 409) {
        try { accept(await read<LearningSession>(await fetch(`/api/learning/sessions/${lesson.session_id}`, { cache: "no-store" }))); } catch { /* Preserve the error and let the student reopen the source. */ }
      }
    } finally { inFlight.current = false; setBusy(false); }
  }

  return (
    <>
      <LoadingStatus active={busy} label={busyLabel} />
      <div className="guided-workspace">
        <div className="guided-main" aria-busy={busy}>
      {error && <div className="alert error-message" role="alert"><p>{t(error)}</p>{uncertain && <Button type="button" variant="outline" disabled={busy} onClick={() => void act("repeat", true)}><UiText>{"Coba kirim kembali"}</UiText></Button>}</div>}
      {!lesson ? (
        <div className="guided-selection-container">
          <div className="guided-selection-header">
            <span className="guided-symbol"><Headphones size={28} aria-hidden="true" /></span>
            <div>
              <h2><UiText>{"Pilih Materi Belajar"}</UiText></h2>
              <p><UiText>{"Pilih salah satu materi di bawah ini untuk belajar bersama Tutor KODMOD langkah demi langkah."}</UiText></p>
            </div>
          </div>

          {!!sessions.filter((row) => row.phase !== "completed").length && (
            <div className="guided-resume-section">
              <h3><RotateCcw size={18} aria-hidden="true" /><UiText>{"Lanjutkan Sesi yang Sedang Berjalan"}</UiText></h3>
              <div className="guided-resume-grid">
                {sessions.filter((row) => row.phase !== "completed").map((row) => (
                  <article key={row.session_id} className="guided-resume-card">
                    <div>
                      <strong>{row.material_title}</strong>
                      <span>{row.phase === "quiz" ? t("Mini kuis sedang berjalan") : `${t("Bagian")} ${row.unit_index + 1} / ${row.total_units}`}</span>
                    </div>
                    <Button type="button" size="sm" disabled={busy || locked || uncertain} onClick={() => void recover(row.session_id)}>
                      <UiText>{"Lanjutkan"}</UiText> <ArrowRight size={14} aria-hidden="true" />
                    </Button>
                  </article>
                ))}
              </div>
            </div>
          )}

          <div className="guided-materials-section">
            <div className="guided-materials-section-head">
              <h3><BookOpen size={19} aria-hidden="true" /><UiText>{"Daftar Materi Kelasmu"}</UiText></h3>
              <span className="materials-count">{materials.length} <UiText>{"materi tersedia"}</UiText></span>
            </div>

            {!materials.length ? (
              <Card className="guided-empty-materials">
                <BookOpen size={36} aria-hidden="true" />
                <h4><UiText>{"Belum ada materi dari kelasmu"}</UiText></h4>
                <p><UiText>{"Minta guru membagikan materi di kelasmu untuk mulai belajar bersama Tutor AI."}</UiText></p>
              </Card>
            ) : (
              <div className="guided-material-grid" role="list">
                {materials.map((item) => {
                  const isReady = item.rag_status === "ready" && item.indexed_version === item.content_version && (item.indexed_mapping_version ?? 0) === (item.mapping_version ?? 0);
                  const isSelected = item.id === materialId;
                  return (
                    <article
                      key={item.id}
                      role="listitem"
                      className={`guided-material-card ${isSelected ? "is-selected" : ""} ${!isReady ? "is-pending" : ""}`}
                    >
                      <button
                        type="button"
                        className="material-card-select"
                        aria-pressed={isSelected}
                        aria-label={`${item.title}. ${item.subject}. Kelas ${item.class_name}. ${isReady ? "Siap dipelajari." : "Menyiapkan materi."}`}
                        disabled={busy || locked || uncertain}
                        onClick={() => setMaterialId(item.id)}
                      >
                        <div className="material-card-top">
                          <span className="material-subject-badge">{item.subject}</span>
                          <span className="material-class-tag"><Library size={13} aria-hidden="true" />{item.class_name}</span>
                        </div>
                        <h4 className="material-card-title">{item.title}</h4>
                        <div className="material-card-status">
                          {isReady ? (
                            <span className="status-badge ready"><CheckCircle2 size={14} aria-hidden="true" /><UiText>{"Siap dipelajari"}</UiText></span>
                          ) : (
                            <span className="status-badge pending"><LoaderCircle size={14} className="spin" aria-hidden="true" /><UiText>{"Menyiapkan materi"}</UiText></span>
                          )}
                          {item.progress?.completed && (
                            <span className="status-badge done"><CheckCircle2 size={14} aria-hidden="true" /><UiText>{"Selesai"}</UiText></span>
                          )}
                        </div>
                      </button>
                      <div className="material-card-action">
                        <Button
                          type="button"
                          variant={isSelected ? "default" : "outline"}
                          className="material-start-button"
                          aria-label={`${t("Mulai belajar")} ${item.title} ${t("bersama Tutor AI")}`}
                          disabled={busy || !isReady || locked || uncertain}
                          onClick={() => {
                            setMaterialId(item.id);
                            void begin(item);
                          }}
                        >
                          {busy && busyAction === "start" && isSelected ? (
                            <LoaderCircle className="spin" size={16} aria-hidden="true" />
                          ) : (
                            <Headphones size={16} aria-hidden="true" />
                          )}
                          <UiText>{"Mulai belajar"}</UiText>
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : <>
        <button type="button" className="change-material-btn" aria-label={t("Pilih materi lain untuk belajar")} disabled={busy || locked || uncertain} onClick={() => setLesson(null)}>
          <ArrowLeft size={16} aria-hidden="true" />
          <UiText>{"Pilih materi lain"}</UiText>
        </button>
        <Card className="guided-progress"><div><span className="muted">{lesson.subject}</span><h2>{lesson.material_title}</h2></div><strong>{t("Bagian")} {lesson.unit_index + 1} / {lesson.total_units}</strong><progress value={lesson.phase === "completed" ? lesson.total_units : lesson.unit_index + 1} max={lesson.total_units} aria-label={t("Progres belajar")} /></Card>
        {lesson.phase === "quiz" && lesson.quiz ? (
          <div className="guided-quiz-container">
            <div className="guided-quiz-banner" role="status">
              <Sparkles size={18} aria-hidden="true" />
              <span>{t("Mini kuis materi")} · {lesson.material_title}</span>
            </div>
            <StudentQuiz key={lesson.quiz.quiz_session_id} embedded initialSession={lesson.quiz} onReturn={() => void recover(lesson.session_id)} />
          </div>
        ) : <Card className="guided-lesson">
          <header className="guided-lesson-heading"><span className="guided-symbol"><Headphones size={24} aria-hidden="true" /></span><h2 ref={explanation} tabIndex={-1}>{lesson.unit_title || `${t("Bagian")} ${lesson.unit_index + 1}`}</h2></header>
          {lastQuestion && <div className="guided-your-question"><strong><UiText>{"Pertanyaanmu"}</UiText></strong><p>{lastQuestion}</p></div>}
          <div className="guided-explanation" role="region" aria-label={t("Penjelasan Tutor")}><p>{lesson.text}</p></div>
          <VoiceControls text={lesson.text} language={lesson.language} autoPlayKey={autoPlayKey} onTranscript={lesson.phase === "learning" && !busy && !uncertain ? setDraft : undefined} />
          {lesson.quiz?.status === "completed" && <div className="guided-check-result" role="status"><CheckCircle2 size={20} aria-hidden="true" /><div><strong><UiText>{"Mini kuis selesai"}</UiText> · {Math.round((lesson.quiz.last_result?.cumulative_score ?? 0) * 100)}%</strong><p>{lesson.quiz.last_result?.feedback}</p></div></div>}
          {lesson.phase === "learning" ? <>
            <form onSubmit={(event) => { event.preventDefault(); void act("question"); }} className="guided-question-form"><label className="field"><UiText>{"Ada yang belum jelas?"}</UiText><Textarea value={draft} maxLength={4000} rows={3} aria-label={t("Tuliskan pertanyaan materi atau gunakan tombol suara.")} onChange={(event) => setDraft(event.target.value)} disabled={busy || uncertain} placeholder={t("Tuliskan pertanyaan atau gunakan tombol suara.")} /></label><Button type="submit" loading={busy && busyAction === "question"} loadingText={t("Menyiapkan jawaban…")} disabled={busy || uncertain || !draft.trim()}><Send size={17} aria-hidden="true" /><UiText>{"Tanyakan pada Tutor"}</UiText></Button></form>
            <footer className="guided-actions" aria-label={t("Langkah belajar berikutnya")}>{Object.entries(actions).filter(([action]) => lesson.available_actions.includes(action)).map(([action, { label, Icon }]) => <Button key={action} type="button" variant={action === "continue" || action === "finish" ? "default" : "outline"} className="guided-action-button" aria-label={t(label)} loading={busy && busyAction === action} loadingText={t("Memproses…")} disabled={busy || uncertain} onClick={() => void act(action)}><Icon size={17} aria-hidden="true" />{t(label)}</Button>)}</footer>
          </> : <div className="guided-check-result" role="status"><CheckCircle2 size={20} aria-hidden="true" /><UiText>{"Sesi belajar selesai. Pilih materi lain untuk melanjutkan."}</UiText></div>}
        </Card>}
      </>}
        </div>
      </div>
    </>
  );
}

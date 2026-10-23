"use client";
import { LoadingStatus } from "./loading-feedback";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

import { UiText, useI18n, UiDate } from "@/components/language-provider";


import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  Bot,
  BookOpen,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  MessageCircle,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
import { confirmAction, notifyResult } from "@/lib/dialogs";
import type {
  ChatMessageResponse,
  ChatSessionDetail,
  ChatSessionSummary,
  ChatTurn,
  TutorContext,
} from "@/lib/chat-types";
import type { StudentMaterial } from "@/lib/class-types";
import type { QuizRecoveryResponse } from "@/lib/quiz-types";
import { VoiceControls } from "./voice-controls";
import { StudentQuiz } from "./student-quiz";
import { FormattedMathText } from "./formatted-math-text";

const prompts = [
  "Jelaskan materi ini dengan contoh sederhana.",
  "Bantu saya menemukan langkah pertama.",
  "Buatkan latihan singkat dari topik ini.",
];

function textFromResponse(response: Response, fallback: string) {
  return response
    .json()
    .then((body: unknown) => {
      if (typeof body === "object" && body !== null && "message" in body) {
        const message = (body as { message?: unknown }).message;
        if (typeof message === "string" && message) return message;
      }
      return fallback;
    })
    .catch(() => fallback);
}

async function readJson<T>(response: Response, fallback: string) {
  if (!response.ok) throw new Error(await textFromResponse(response, fallback));
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function turnLabel(role: ChatTurn["role"]) {
  return role === "student" ? "Kamu" : role === "system" ? "Info" : "Tutor KODMOD";
}

export function StudentTutor({
  initialSessions,
  materials,
  initialMaterialId,
}: {
  initialSessions: ChatSessionSummary[];
  materials: StudentMaterial[];
  initialMaterialId?: string;
}) {
  const { t } = useI18n();
  const [sessions, setSessions] = useState(initialSessions);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [embeddedQuiz, setEmbeddedQuiz] = useState<QuizRecoveryResponse | null>(null);
  const [draft, setDraft] = useState("");
  const [pendingText, setPendingText] = useState("");
  const [loadingSession, setLoadingSession] = useState(false);
  const [pending, setPending] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [endingId, setEndingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [autoPlayKey, setAutoPlayKey] = useState<string | null>(null);
  const replySequence = useRef(0);
  const initialMaterial = materials.find((item) => item.id === initialMaterialId);
  const [context, setContext] = useState<TutorContext | null>(initialMaterial ? {
    class_id: initialMaterial.class_id, material_id: initialMaterial.id,
    subject_name: initialMaterial.subject, material_title: initialMaterial.title,
  } : null);
  const selectionRef = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const selectedSession = sessions.find((item) => item.id === selectedId);
  const sessionEnded = Boolean(selectedSession?.ended_at);
  const selectedMaterial = materials.find((item) => item.id === context?.material_id && item.class_id === context.class_id);
  const materialUnavailable = Boolean(context && !selectedMaterial);
  const materialNotReady = Boolean(selectedMaterial?.rag_status && selectedMaterial.rag_status !== "ready");
  const busy = pending || loadingSession || Boolean(endingId) || Boolean(deletingId);
  const latestTutorText = [...turns]
    .reverse()
    .find((turn) => turn.role === "assistant" || turn.role === "tutor")?.text ?? "";

  function startNew() {
    setAutoPlayKey(null);
    selectionRef.current += 1;
    setSelectedId(null);
    setTurns([]);
    setEmbeddedQuiz(null);
    setDraft("");
    setError("");
    setNotice("Percakapan baru siap dimulai.");
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function selectMaterial(materialId: string) {
    if (busy) return;
    const material = materials.find((item) => item.id === materialId);
    if ((selectedId || turns.length || draft.trim()) && !(await confirmAction({ title: "Mulai sesi dengan pilihan materi ini?", text: "Pilihan materi berlaku untuk percakapan baru. Riwayat sesi sebelumnya tetap tersimpan, tetapi pertanyaan yang belum dikirim akan dikosongkan.", confirmText: "Ya, mulai sesi baru" }))) return;
    startNew();
    setContext(material ? { class_id: material.class_id, material_id: material.id, subject_name: material.subject, material_title: material.title } : null);
  }

  async function loadSession(id: string) {
    setAutoPlayKey(null);
    setEmbeddedQuiz(null);
    if (busy) return;
    const requestId = selectionRef.current + 1;
    selectionRef.current = requestId;
    setSelectedId(id);
    setLoadingSession(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/chat/sessions/${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      const detail = await readJson<ChatSessionDetail>(
        response,
        "Riwayat percakapan belum dapat dibuka.",
      );
      let recoveredQuiz: QuizRecoveryResponse | null = null;
      const quizId = [...detail.turns].reverse().find((turn) => turn.quiz_session_id)?.quiz_session_id;
      if (quizId) {
        try {
          recoveredQuiz = await readJson<QuizRecoveryResponse>(
            await fetch(`/api/quiz/sessions/${encodeURIComponent(quizId)}`, { cache: "no-store" }),
            "Kuis percakapan belum dapat dipulihkan.",
          );
        } catch {
          recoveredQuiz = null;
        }
      }
      if (selectionRef.current === requestId) {
        setTurns(detail.turns);
        setEmbeddedQuiz(recoveredQuiz);
        setContext(detail.context ?? null);
        setDraft("");
      }
    } catch (caught) {
      if (selectionRef.current === requestId) {
        setTurns([]);
        setSelectedId(null);
        setContext(null);
        setError(caught instanceof Error ? caught.message : "Riwayat belum dapat dibuka.");
      }
    } finally {
      if (selectionRef.current === requestId) setLoadingSession(false);
    }
  }

  async function refreshSessions() {
    const response = await fetch("/api/chat/sessions?limit=50", { cache: "no-store" });
    const next = await readJson<ChatSessionSummary[]>(
      response,
      "Riwayat sesi belum dapat diperbarui.",
    );
    setSessions(next);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy || materialUnavailable || materialNotReady) return;
    setPending(true);
    setPendingText(text);
    setDraft("");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/chat/message", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ text, ...(selectedId ? { session_id: selectedId } : {}), ...(context ? { class_id: context.class_id, material_id: context.material_id } : {}) }),
      });
      const result = await readJson<ChatMessageResponse>(
        response,
        "Pertanyaan belum dapat dikirim.",
      );
      let recoveredQuiz: QuizRecoveryResponse | null = null;
      if (result.quiz_session_id) {
        try {
          recoveredQuiz = await readJson<QuizRecoveryResponse>(
            await fetch(`/api/quiz/sessions/${encodeURIComponent(result.quiz_session_id)}`, { cache: "no-store" }),
            "Kuis belum dapat dibuka.",
          );
        } catch {
          setError("Kuis tersimpan, tetapi belum dapat dibuka. Muat ulang sesi untuk melanjutkan.");
        }
      }
      setTurns((current) => [
        ...current,
        { role: "student", text, timestamp: new Date().toISOString() },
        {
          role: "assistant",
          text: result.quiz_session_id ? t("Cek pemahaman siap dijawab di bawah.") : result.text,
          intent: result.intent,
          timestamp: new Date().toISOString(),
          sources: result.sources,
          quiz_session_id: result.quiz_session_id,
        },
      ]);
      setEmbeddedQuiz(recoveredQuiz);
      setSelectedId(result.session_id);
      setAutoPlayKey(`${result.session_id}:${++replySequence.current}`);
      if (result.context !== undefined) setContext(result.context);
      try {
        await refreshSessions();
        setNotice("Jawaban tutor sudah siap.");
      } catch {
        setNotice("Jawaban tutor sudah siap. Riwayat akan diperbarui saat kamu memuat ulang halaman.");
      }
    } catch (caught) {
      setDraft(text);
      setError(caught instanceof Error ? caught.message : "Pertanyaan belum dapat dikirim.");
    } finally {
      setPending(false);
      setPendingText("");
    }
  }

  async function removeSession(item: ChatSessionSummary) {
    if (
      !(await confirmAction({
        title: "Hapus percakapan ini?",
        text: "Riwayat pertanyaan dan jawaban di sesi ini akan dihapus dari akunmu.",
        confirmText: "Ya, hapus",
        destructive: true,
      }))
    )
      return;

    setDeletingId(item.id);
    try {
      const response = await fetch(`/api/chat/sessions/${encodeURIComponent(item.id)}`, {
        method: "DELETE",
      });
      await readJson<unknown>(response, "Percakapan belum dapat dihapus.");
    } catch (caught) {
      await notifyResult(
        caught instanceof Error ? caught.message : "Percakapan belum dapat dihapus.",
        true,
      );
      setDeletingId(null);
      return;
    }

    setSessions((current) => current.filter((session) => session.id !== item.id));
    if (selectedId === item.id) startNew();
    setDeletingId(null);
    await notifyResult("Percakapan berhasil dihapus.");
  }

  async function endSession() {
    if (!selectedId || sessionEnded || pending) return;
    if (
      !(await confirmAction({
        title: "Akhiri sesi belajar ini?",
        text: "Sesi akan ditandai selesai dan tidak menerima pertanyaan baru.",
        confirmText: "Ya, akhiri sesi",
      }))
    )
      return;

    setEndingId(selectedId);
    try {
      const response = await fetch(
        `/api/chat/sessions/${encodeURIComponent(selectedId)}/end`,
        { method: "POST" },
      );
      await readJson<unknown>(response, "Sesi belum dapat diakhiri.");
      const endedAt = new Date().toISOString();
      setSessions((current) =>
        current.map((item) => (item.id === selectedId ? { ...item, ended_at: endedAt } : item)),
      );
      setDraft("");
      setNotice("Sesi belajar sudah diakhiri. Kamu masih bisa membaca riwayatnya.");
    } catch (caught) {
      await notifyResult(caught instanceof Error ? caught.message : "Sesi belum dapat diakhiri.", true);
    } finally {
      setEndingId(null);
    }
  }

  return (
    <><LoadingStatus active={busy} label={pending ? "Tutor sedang menyiapkan jawaban…" : loadingSession ? "Membuka sesi belajar…" : deletingId ? "Menghapus percakapan…" : "Menyimpan progres belajar…"} />
    <section className="tutor-workspace" aria-label={t("Tutor AI siswa")}>
      <aside className="panel tutor-sidebar" aria-label={t("Riwayat percakapan")}>
        <div className="tutor-sidebar-heading">
          <div>
            <h2><UiText>{"Riwayat tutor"}</UiText></h2>
          </div>
          <button
            type="button"
            className="icon-button tutor-add"
            onClick={startNew}
            disabled={busy}
            aria-label={t("Mulai percakapan baru")}
            title={t("Percakapan baru")}
          >
            <Plus size={19} aria-hidden="true" />
          </button>
        </div>
        <button type="button" className="button primary tutor-new" onClick={startNew} disabled={busy}>
          <MessageCircle size={17} aria-hidden="true" /><UiText>{"Mulai pertanyaan baru"}</UiText></button>
        <div className="tutor-session-list" role="list">
          {sessions.length ? (
            sessions.map((item) => (
              <div
                className={`tutor-session-row ${selectedId === item.id ? "active" : ""}`}
                key={item.id}
                role="listitem"
              >
                <button
                  type="button"
                  className="tutor-session-select"
                  onClick={() => void loadSession(item.id)}
                  disabled={busy}
                  aria-current={selectedId === item.id ? "true" : undefined}
                >
                  <strong>{item.title || <UiText>{"Sesi tanpa judul"}</UiText>}</strong>
                  <span>
                    <Clock3 size={13} aria-hidden="true" /> {<UiDate value={item.started_at} />}
                  </span>
                </button>
                <button
                  type="button"
                  className="icon-button tutor-delete"
                  onClick={() => void removeSession(item)}
                  disabled={deletingId === item.id || busy}
                  aria-label={`${t("Hapus percakapan")} ${item.title || t("tanpa judul")}`}
                  title={t("Hapus percakapan")}
                >
                  {deletingId === item.id ? (
                    <LoaderCircle className="spin" size={16} aria-hidden="true" />
                  ) : (
                    <Trash2 size={16} aria-hidden="true" />
                  )}
                </button>
              </div>
            ))
          ) : (
            <div className="tutor-sidebar-empty">
              <Bot size={22} aria-hidden="true" />
              <p><UiText>{"Belum ada riwayat. Mulai dari pertanyaan sederhana."}</UiText></p>
            </div>
          )}
        </div>
      </aside>

      <section className="panel tutor-thread" aria-label={t("Percakapan")}>
        <header className="tutor-thread-heading">
          <div>
            <h2>{selectedSession?.title || <UiText>{"Mulai dari satu pertanyaan"}</UiText>}</h2>
            <p><UiText>{"Tutor membantu menyusun penjelasan. Kamu tetap memegang kendali atas setiap langkah belajar."}</UiText></p>
          </div>
          <div className="tutor-thread-actions">
            {selectedSession && (
              sessionEnded ? (
                <span className="tutor-ended-badge">
                  <CheckCircle2 size={14} aria-hidden="true" /><UiText>{"Sesi selesai"}</UiText></span>
              ) : (
                <button
                  type="button"
                  className="button secondary tutor-end"
                  onClick={() => void endSession()}
                  disabled={endingId === selectedId || pending}
                >
                  {endingId === selectedId ? (
                    <LoaderCircle className="spin" size={15} aria-hidden="true" />
                  ) : (
                    <CheckCircle2 size={15} aria-hidden="true" />
                  )}<UiText>{" Akhiri sesi"}</UiText></button>
              )
            )}
            <span className="tutor-live-status">
              <span aria-hidden="true" /> {pending ? <UiText>{"Menyiapkan jawaban"}</UiText> : sessionEnded ? <UiText>{"Mode baca"}</UiText> : <UiText>{"Siap membantu"}</UiText>}
            </span>
          </div>
        </header>

        <section className="tutor-material-context" aria-label={t("Materi untuk percakapan")}>
          <div className="tutor-context-copy"><BookOpen size={20} aria-hidden="true" /><div><strong>{context?.material_title || <UiText>{"Belajar topik umum"}</UiText>}</strong><p>{context ? <>{context.subject_name} · {t("Jawaban mengacu pada materi kelasmu.")}</> : <UiText>{"Pilih materi dari guru agar penjelasan mengikuti bacaan yang kamu pelajari."}</UiText>}</p></div></div>
          <label className="field"><UiText>{"Materi belajar"}</UiText><NativeSelect value={selectedMaterial?.id || (context ? "unavailable" : "")} onChange={(event) => void selectMaterial(event.target.value)} disabled={busy}>
              <option value=""><UiText>{"Topik umum"}</UiText></option>
              {materialUnavailable && <option value="unavailable" disabled><UiText>{"Materi tidak lagi tersedia"}</UiText></option>}
              {materials.map((item) => <option key={item.id} value={item.id}>{item.subject} · {item.title}</option>)}
            </NativeSelect>
          </label>
          {materialUnavailable && <p className="tutor-context-warning" role="alert"><UiText>{"Akses materi ini sudah tidak tersedia. Pilih materi lain untuk memulai sesi baru."}</UiText></p>}
          {materialNotReady && <p className="tutor-context-warning" role="status"><UiText>{"Materi belum siap digunakan Tutor. Coba perbarui halaman setelah guru selesai menyiapkannya."}</UiText></p>}
        </section>

        <div className="tutor-messages" role="log" aria-live="polite" aria-label={t("Isi percakapan")}>
          {loadingSession ? (
            <div className="tutor-empty">
              <LoaderCircle className="spin" size={25} aria-hidden="true" />
              <p><UiText>{"Membuka riwayat percakapan…"}</UiText></p>
            </div>
          ) : !turns.length && !pending ? (
            <div className="tutor-empty">
              <span className="tutor-empty-icon" aria-hidden="true">
                <Bot size={27} />
              </span>
              <h3><UiText>{"Apa yang ingin kamu pahami hari ini?"}</UiText></h3>
              <p><UiText>{"Tuliskan pertanyaanmu dengan kata-kata sendiri. Tutor akan membantumu memecahnya menjadi langkah kecil."}</UiText></p>
              <div className="tutor-prompts">
                {prompts.map((prompt) => (
                  <button type="button" className="tutor-prompt" key={prompt} onClick={() => setDraft(t(prompt))}>
                    {t(prompt)}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {turns.map((turn, index) => (
                <article className={`tutor-message ${turn.role === "student" ? "student" : "assistant"}`} key={`${turn.timestamp || "turn"}-${index}`}>
                  <span className="tutor-message-avatar" aria-hidden="true">
                    {turn.role === "student" ? <UiText>{"K"}</UiText> : <Bot size={17} />}
                  </span>
                  <div className="tutor-message-content">
                    <span className="tutor-message-label">{t(turnLabel(turn.role))}</span>
                    <p className="tutor-bubble"><FormattedMathText text={turn.text} /></p>
                    {!!turn.sources?.length && <div className="tutor-sources" aria-label={t("Sumber jawaban")}><strong><UiText>{"Sumber materi"}</UiText></strong><ul>{turn.sources.map((source, sourceIndex) => <li key={`${source.material_id || source.source}-${sourceIndex}`}>{source.class_id && source.material_id && materials.some((item) => item.id === source.material_id && item.class_id === source.class_id) ? <Link href={`/student/classes/${source.class_id}/materials/${source.material_id}`}>{source.title || source.source || <UiText>{"Materi kelas"}</UiText>}{source.section_title ? ` · ${source.section_title}` : ""}</Link> : <span>{source.title || source.source || <UiText>{"Materi pembelajaran"}</UiText>}{source.section_title ? ` · ${source.section_title}` : ""}</span>}</li>)}</ul></div>}
                  </div>
                </article>
              ))}
              {pending && (
                <article className="tutor-message student pending">
                  <span className="tutor-message-avatar" aria-hidden="true"><UiText>{"K"}</UiText></span>
                  <div className="tutor-message-content">
                    <span className="tutor-message-label"><UiText>{"Kamu"}</UiText></span>
                    <p className="tutor-bubble"><FormattedMathText text={pendingText} /></p>
                  </div>
                </article>
              )}
            </>
          )}
        </div>

        {embeddedQuiz && <div className="tutor-inline-quiz" aria-label={t("Mini kuis percakapan")}>
          <StudentQuiz
            key={embeddedQuiz.quiz_session_id}
            embedded
            initialSession={embeddedQuiz}
            onReturn={() => { setEmbeddedQuiz(null); requestAnimationFrame(() => inputRef.current?.focus()); }}
          />
        </div>}

        <VoiceControls text={latestTutorText} onTranscript={setDraft} autoPlayKey={autoPlayKey} />

        <form className="tutor-composer" onSubmit={(event) => void submit(event)}>
          <label className="sr-only" htmlFor="tutor-question"><UiText>{"Tulis pertanyaan untuk tutor"}</UiText></label>
          <Textarea
            ref={inputRef}
            id="tutor-question"
            value={draft}
            maxLength={4_000}
            rows={3}
            placeholder={t("Contoh: Kenapa satu per dua sama dengan dua per empat?")}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            disabled={busy || sessionEnded || embeddedQuiz?.status === "in_progress" || materialUnavailable || materialNotReady}
          />
          <div className="tutor-composer-footer">
            <span>
              {sessionEnded
                ? <UiText>{"Sesi selesai · mulai pertanyaan baru untuk melanjutkan"}</UiText>
                : `${draft.length}${t("/4.000 karakter · Shift + Enter untuk baris baru")}`}
            </span>
            <button className="button primary" type="submit" disabled={busy || sessionEnded || embeddedQuiz?.status === "in_progress" || materialUnavailable || materialNotReady || !draft.trim()}>
              {pending ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : <Send size={17} aria-hidden="true" />}
              {pending ? <UiText>{"Mengirim…"}</UiText> : <UiText>{"Kirim pertanyaan"}</UiText>}
            </button>
          </div>
        </form>
        {error && <p className="alert error-message tutor-feedback" role="alert">{t(error)}</p>}
        {notice && !error && <p className="tutor-feedback" role="status">{t(notice)}</p>}
      </section>
    </section></>
  );
}

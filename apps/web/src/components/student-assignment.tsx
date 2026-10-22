"use client";
import { quizPointsLabel } from "@/lib/quiz-points-display";
import { UiText, useI18n, UiDate } from "@/components/language-provider";


import { useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Check,
  CheckCircle2,
  Lightbulb,
  ListChecks,
  RotateCcw,
  Save,
  Send,
  Volume2,
  X,
} from "lucide-react";
import { speechOutput } from "@/lib/browser-speech";
import { RefreshButton } from "./refresh-button";
import { confirmAction, notifyResult } from "@/lib/dialogs";
import { EditorialError, editorialRequest } from "@/lib/editorial-client";
import {
  assignmentAvailability,
  finalIntent,
  isAssignmentReceipt,
} from "@/lib/editorial-contract.mjs";
import { createQuizSubmissionId } from "@/lib/quiz-submission.mjs";
import {
  availabilityLabel,
  type Assignment,
  type AssignmentAttempt,
  type AssignmentResult,
  type FinalIntent,
} from "@/lib/editorial-types";
import { VoiceControls } from "./voice-controls";
import { useQuizExitGuard } from "./use-quiz-exit-guard";
import { Badge } from "./ui";
import { LoadingStatus } from "./loading-feedback";
import { Spinner } from "./ui/spinner";
import "@/styles/editorial.css";

const pendingMemory = new Map<string, string | null>();
const pendingEvent = "kodmod-assignment-pending";
function subscribePending(listener: () => void) {
  window.addEventListener(pendingEvent, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(pendingEvent, listener);
    window.removeEventListener("storage", listener);
  };
}
function readPending(id?: string): string | null {
  if (!id) return null;
  try {
    return (
      sessionStorage.getItem(`kodmod:assignment-final:${id}`) ??
      pendingMemory.get(id) ??
      null
    );
  } catch {
    return pendingMemory.get(id) ?? null;
  }
}
function writePending(id: string, intent: FinalIntent | null) {
  const raw = intent ? JSON.stringify(intent) : null;
  pendingMemory.set(id, raw);
  try {
    if (raw) sessionStorage.setItem(`kodmod:assignment-final:${id}`, raw);
    else sessionStorage.removeItem(`kodmod:assignment-final:${id}`);
  } catch {
    /* In-memory retry remains available if storage is denied. */
  }
  window.dispatchEvent(new Event(pendingEvent));
}
function parsePending(raw: string | null): FinalIntent | null {
  try {
    const p = JSON.parse(raw || "null");
    return p &&
      typeof p.key === "string" &&
      /^[0-9a-f-]{36}$/i.test(p.key) &&
      Number.isSafeInteger(p.expected_revision) &&
      p.expected_revision >= 0
      ? p
      : null;
  } catch {
    return null;
  }
}

export function StudentAssignment({
  assignment,
  initialAttempt,
  initialResult,
}: {
  assignment: Assignment;
  initialAttempt: AssignmentAttempt | null;
  initialResult: AssignmentResult | null;
}) {
  const { t, language } = useI18n();
  const [attempt, setAttempt] = useState(initialAttempt);
  const [result, setResult] = useState(initialResult);
  const [index, setIndex] = useState(0);
  const [activeRule, setActiveRule] = useState<number | null>(null);

  function playRule(idx: number, text: string) {
    setActiveRule(idx);
    void speechOutput.play({
      owner: `quiz-rule-${idx}`,
      text,
      engine: "app",
      language,
    });
  }
  const [selected, setSelected] = useState(
    initialAttempt
      ? (initialAttempt.answers[initialAttempt.questions[0].id] ?? "")
      : "",
  );
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const pending = parsePending(
    useSyncExternalStore(
      subscribePending,
      () => readPending(attempt?.id),
      () => null,
    ),
  );
  const question = attempt?.questions[index];
  const availability = assignmentAvailability(
    attempt?.assignment ?? assignment,
  );
  const saved = attempt && question ? (attempt.answers[question.id] ?? "") : "";
  const dirty = selected !== saved;
  useQuizExitGuard(Boolean(attempt && !result), dirty);
  const answeredCount = Object.keys(attempt?.answers ?? {}).length;
  const base = `/student/assignments/${assignment.id}`;

  async function start() {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      if (
        !(await confirmAction({
          title: "Mulai tugas ini?",
          text: "Kamu mendapat satu percobaan. Jawaban yang disimpan bisa dilanjutkan sebelum batas pengumpulan.",
          confirmText: "Mulai mengerjakan",
        }))
      )
        return;
      setBusy(true);
      setBusyLabel("Menyiapkan tugas…");
      setError("");
      const next = await editorialRequest<AssignmentAttempt>(
        base + "/start",
        "POST",
      );
      if (next.state === "submitted") {
        setResult(await editorialRequest<AssignmentResult>(base + "/result"));
        return;
      }
      setAttempt(next);
      setIndex(0);
      setSelected(next.answers[next.questions[0].id] ?? "");
      setMessage(
        "Tugas dimulai. Pilih jawaban, lalu simpan untuk melanjutkan.",
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Tugas belum dapat dimulai.",
      );
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }
  async function save() {
    if (!attempt || !question || !selected || inFlight.current || pending)
      return;
    inFlight.current = true;
    try {
      if (
        !(await confirmAction({
          title: "Simpan pilihan jawaban?",
          text: "Pilihan ini disimpan sebagai progres. Kamu masih bisa mengubahnya sebelum mengirim semua jawaban.",
          confirmText: "Simpan & lanjut",
        }))
      )
        return;
      setBusy(true);
      setBusyLabel("Menyimpan jawaban…");
      setError("");
      const next = await editorialRequest<AssignmentAttempt>(
        `${base}/answers/${question.id}`,
        "PUT",
        { option_id: selected, expected_revision: attempt.revision },
      );
      const nextIndex = Math.min(index + 1, next.questions.length - 1);
      setAttempt(next);
      setIndex(nextIndex);
      setSelected(next.answers[next.questions[nextIndex].id] ?? "");
      setMessage(
        t("Jawaban soal {number} tersimpan. {count} dari {total} soal sudah dijawab.", { number: question.order_index, count: Object.keys(next.answers).length, total: next.questions.length }),
      );
      requestAnimationFrame(() => heading.current?.focus());
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Jawaban belum tersimpan. Muat ulang progres sebelum mencoba kembali.",
      );
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }
  async function navigate(nextIndex: number) {
    if (!attempt || busy || pending) return;
    if (
      dirty &&
      !(await confirmAction({
        title: "Tinggalkan pilihan yang belum disimpan?",
        text: "Pilihan terbaru pada soal ini belum tersimpan. Jawaban yang sebelumnya disimpan tetap ada.",
        destructive: true,
      }))
    )
      return;
    setIndex(nextIndex);
    setSelected(attempt.answers[attempt.questions[nextIndex].id] ?? "");
    requestAnimationFrame(() => heading.current?.focus());
  }
  async function submit() {
    if (!attempt || inFlight.current) return;
    inFlight.current = true;
    try {
      if (
        !pending &&
        !(await confirmAction({
          title: "Kirim semua jawaban?",
          text: "Setelah dikirim, jawaban dinilai dan tidak dapat diubah lagi.",
          confirmText: "Ya, kirim jawaban",
        }))
      )
        return;
      const intent = finalIntent(
        pending,
        attempt.revision,
        createQuizSubmissionId(),
      );
      writePending(attempt.id, intent);
      setBusy(true);
      setBusyLabel("Menilai hasil tugas…");
      setError("");
      const next = await editorialRequest<AssignmentResult>(
        base + "/submit",
        "POST",
        { expected_revision: intent.expected_revision },
        intent.key,
      );
      if (!isAssignmentReceipt(next, attempt.id, assignment.id)) {
        throw new Error(
          "Hasil pengiriman belum dapat dibaca. Coba kirim kembali untuk mengambil nilai yang sama.",
        );
      }
      setResult(next);
      writePending(attempt.id, null);
      setMessage("Jawaban berhasil dikirim dan nilai tersimpan.");
      await notifyResult(
        "Tugas selesai. Nilai dan progresmu berhasil tersimpan.",
      );
    } catch (caught) {
      if (
        caught instanceof EditorialError &&
        [400, 401, 403, 404, 409, 422].includes(caught.status)
      )
        writePending(attempt.id, null);
      setError(
        caught instanceof Error
          ? caught.message
          : "Hasil pengiriman belum pasti. Coba kirim kembali.",
      );
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }

  if (result) {
    const totalQuestions = result.total_questions;
    const correctCount = result.correct_count;
    const incorrectCount = Math.max(0, totalQuestions - correctCount);
    const accuracyPercent =
      totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;

    const scoreText = result.score_summary
      ? quizPointsLabel(result.score_summary, language)
      : `${correctCount} ${t("dari")} ${totalQuestions} ${t("jawaban benar")}`;

    const recapSpoken =
      language === "en"
        ? `Assignment results recap for ${assignment.title}. Your score is ${scoreText}, with ${correctCount} of ${totalQuestions} correct answers. ${
            correctCount === totalQuestions
              ? "All your answers are correct, great job!"
              : `${incorrectCount} questions need review in the answer explanation below.`
          }`
        : `Rekap hasil tugas ${assignment.title}. Nilaimu ${scoreText}, dengan ${correctCount} dari ${totalQuestions} jawaban benar. ${
            correctCount === totalQuestions
              ? "Semua jawabanmu tepat, kerja sangat bagus!"
              : `${incorrectCount} soal perlu dipelajari lagi pada pembahasan jawaban di bawah.`
          }`;

    return (
      <div className="editorial-result">
        <section className="panel editorial-result-hero">
          <CheckCircle2 size={36} aria-hidden="true" />
          <span className="editorial-kicker"><UiText>{"TUGAS SELESAI"}</UiText></span>
          <h2><UiText>{"Terima kasih sudah mencoba."}</UiText></h2>
          <div className="editorial-final-score">
            {result.score_summary ? quizPointsLabel(result.score_summary, language) : `${result.correct_count} / ${result.total_questions} ${t("jawaban benar")}`}
          </div>
          <p>
            {result.correct_count}<UiText>{" dari "}</UiText>{result.total_questions}<UiText>{" jawaban benar."}</UiText>
          </p>
          <small><UiText>{"Dikirim "}</UiText>{<UiDate value={result.submitted_at} time empty="Tanpa batas waktu" />}</small>

          <div className="editorial-recap-grid" role="region" aria-label={t("Rekapitulasi hasil tugas")}>
            <div className="editorial-recap-item">
              <span className="editorial-recap-label"><UiText>{"Total soal"}</UiText></span>
              <strong className="editorial-recap-value">{totalQuestions}</strong>
            </div>
            <div className="editorial-recap-item is-success">
              <span className="editorial-recap-label"><UiText>{"Jawaban benar"}</UiText></span>
              <strong className="editorial-recap-value">{correctCount}</strong>
            </div>
            <div className="editorial-recap-item is-warning">
              <span className="editorial-recap-label"><UiText>{"Perlu dipelajari"}</UiText></span>
              <strong className="editorial-recap-value">{incorrectCount}</strong>
            </div>
            <div className="editorial-recap-item is-info">
              <span className="editorial-recap-label"><UiText>{"Akurasi"}</UiText></span>
              <strong className="editorial-recap-value">{accuracyPercent}%</strong>
            </div>
          </div>

          <div className="editorial-recap-voice">
            <VoiceControls
              text={recapSpoken}
              autoPlayKey={`recap-${assignment.id}-${result.submitted_at || correctCount}`}
            />
          </div>
        </section>

        {result.feedback_released ? (
          <section className="panel editorial-section">
            <div className="editorial-section-header">
              <h2><UiText>{"Pembahasan jawaban"}</UiText></h2>
              <p className="editorial-section-subtitle">
                <UiText>{"Pelajari pembahasan di bawah ini untuk memperdalam pemahaman materimu."}</UiText>
              </p>
            </div>
            <div className="editorial-review-list">
              {result.review.map((r, i) => {
                const userOption = r.options.find((o) => o.id === r.option_id);
                const correctOption = r.options.find((o) => o.id === r.correct_option_id);
                const questionNarration = `${t("Soal")} ${i + 1}. ${r.prompt}. ${
                  r.is_correct
                    ? `${t("Jawaban benar:")} ${correctOption?.label ?? ""}.`
                    : `${t("Jawabanmu:")} ${userOption?.label ?? t("Tidak dijawab")}. ${t("Jawaban benar:")} ${correctOption?.label ?? ""}.`
                } ${r.explanation || ""}`;

                return (
                  <article
                    key={r.question_id}
                    className={`editorial-review-card editorial-review-question ${r.is_correct ? "is-correct" : "is-incorrect"}`}
                  >
                    <div className="editorial-review-card-header">
                      <div className="editorial-review-badges">
                        <span className="editorial-question-number">
                          <UiText>{"Soal"}</UiText> {i + 1}
                        </span>
                        <Badge active={r.is_correct}>
                          {r.is_correct ? <UiText>{"Benar"}</UiText> : <UiText>{"Perlu dipelajari lagi"}</UiText>}
                        </Badge>
                      </div>
                    </div>

                    <h3 className="editorial-review-prompt">
                      {r.prompt}
                    </h3>

                    <div className="editorial-answer-comparison">
                      <div className={`editorial-answer-box ${r.is_correct ? "is-correct" : "is-incorrect"}`}>
                        <div className="editorial-answer-header">
                          <span className="editorial-answer-icon" aria-hidden="true">
                            {r.is_correct ? <Check size={14} /> : <X size={14} />}
                          </span>
                          <span className="editorial-answer-label"><UiText>{"Jawabanmu:"}</UiText></span>
                        </div>
                        <div className="editorial-answer-text">
                          {userOption?.label || <span className="muted"><UiText>{"Tidak dijawab"}</UiText></span>}
                        </div>
                      </div>

                      <div className="editorial-answer-box is-key">
                        <div className="editorial-answer-header">
                          <span className="editorial-answer-icon" aria-hidden="true">
                            <CheckCircle2 size={14} />
                          </span>
                          <span className="editorial-answer-label"><UiText>{"Kunci jawaban:"}</UiText></span>
                        </div>
                        <div className="editorial-answer-text">
                          {correctOption?.label || "—"}
                        </div>
                      </div>
                    </div>

                    <div className="editorial-explanation-box">
                      <div className="editorial-explanation-header">
                        <Lightbulb size={16} className="editorial-explanation-icon" aria-hidden="true" />
                        <strong><UiText>{"Pembahasan:"}</UiText></strong>
                      </div>
                      <p className="editorial-explanation-content">
                        {r.explanation || (
                          <span className="muted">
                            <UiText>{"Guru belum menambahkan pembahasan untuk soal ini."}</UiText>
                          </span>
                        )}
                      </p>
                    </div>

                    <div className="editorial-review-voice">
                      <VoiceControls
                        key={r.question_id}
                        text={questionNarration}
                      />
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ) : (
          <section className="panel editorial-section">
            <h2><UiText>{"Pembahasan menyusul"}</UiText></h2>
            <p><UiText>{"Guru akan membuka pembahasan setelah batas pengumpulan:"}</UiText>{" "}
              {<UiDate value={assignment.due_at} time empty="Tanpa batas waktu" />}.
            </p>
            <RefreshButton label="Periksa pembahasan" />
          </section>
        )}
      </div>
    );
  }

  return (
    <>
      <LoadingStatus active={busy} label={busyLabel} />
      <div className="editorial-status-bar">
        <Badge active={availability === "open"}>
          {<UiText>{availabilityLabel[availability]}</UiText>}
        </Badge>
        <span><UiText>{"Tenggat: "}</UiText>{<UiDate value={assignment.due_at} time empty="Tanpa batas waktu" />}</span>
      </div>
      {error && (
        <p role="alert" className="editorial-error">
          {t(error)}{" "}
          <RefreshButton label="Muat ulang progres" size="sm" disabled={busy} />
        </p>
      )}
      <p className="editorial-live" role="status" aria-live="polite">
        {t(message)}
      </p>
      {!attempt ? (
        <section className="panel editorial-start">
          <span className="class-symbol">
            <CheckCircle2 size={27} aria-hidden="true" />
          </span>
          <h2><UiText>{"Siap untuk mulai?"}</UiText></h2>
          <p>
            {assignment.description ||
              <UiText>{"Kerjakan sesuai ritmemu. Simpan setiap pilihan untuk melanjutkan dari progres yang sama."}</UiText>}
          </p>

          <div className="editorial-rules-grid" role="region" aria-label={t("Persyaratan dan petunjuk kuis")}>
            <div
              className={`editorial-rule-card ${activeRule === 0 ? "active" : ""}`}
              tabIndex={0}
              role="button"
              data-voice-menu="quiz-rule-1"
              aria-label={`${t("Aturan kuis 1")}: ${assignment.total_questions} ${t("soal pilihan ganda, satu percobaan.")}`}
              onClick={() => playRule(0, `${t("Aturan kuis 1")}: ${assignment.total_questions} ${t("soal pilihan ganda, satu percobaan.")}`)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  playRule(0, `${t("Aturan kuis 1")}: ${assignment.total_questions} ${t("soal pilihan ganda, satu percobaan.")}`);
                }
              }}
            >
              <div className="editorial-rule-icon questions" aria-hidden="true">
                <ListChecks size={22} />
              </div>
              <div className="editorial-rule-content">
                <strong className="editorial-rule-title"><UiText>{"Format & Percobaan"}</UiText></strong>
                <p className="editorial-rule-desc">
                  {assignment.total_questions}{" "}<UiText>{"soal pilihan ganda, satu percobaan."}</UiText>
                </p>
              </div>
              <span className="editorial-rule-badge" aria-hidden="true">
                <Volume2 size={13} /> <UiText>{"Dengarkan"}</UiText>
              </span>
            </div>

            <div
              className={`editorial-rule-card ${activeRule === 1 ? "active" : ""}`}
              tabIndex={0}
              role="button"
              data-voice-menu="quiz-rule-2"
              aria-label={`${t("Aturan kuis 2")}: ${t("Jawaban dapat ditinjau kembali sebelum dikirim.")}`}
              onClick={() => playRule(1, `${t("Aturan kuis 2")}: ${t("Jawaban dapat ditinjau kembali sebelum dikirim.")}`)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  playRule(1, `${t("Aturan kuis 2")}: ${t("Jawaban dapat ditinjau kembali sebelum dikirim.")}`);
                }
              }}
            >
              <div className="editorial-rule-icon review" aria-hidden="true">
                <RotateCcw size={22} />
              </div>
              <div className="editorial-rule-content">
                <strong className="editorial-rule-title"><UiText>{"Tinjau & Simpan"}</UiText></strong>
                <p className="editorial-rule-desc">
                  <UiText>{"Jawaban dapat ditinjau kembali sebelum dikirim."}</UiText>
                </p>
              </div>
              <span className="editorial-rule-badge" aria-hidden="true">
                <Volume2 size={13} /> <UiText>{"Dengarkan"}</UiText>
              </span>
            </div>

            <div
              className={`editorial-rule-card ${activeRule === 2 ? "active" : ""}`}
              tabIndex={0}
              role="button"
              data-voice-menu="quiz-rule-3"
              aria-label={`${t("Aturan kuis 3")}: ${t("Tersedia pembacaan soal dan pilihan melalui kontrol suara.")}`}
              onClick={() => playRule(2, `${t("Aturan kuis 3")}: ${t("Tersedia pembacaan soal dan pilihan melalui kontrol suara.")}`)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  playRule(2, `${t("Aturan kuis 3")}: ${t("Tersedia pembacaan soal dan pilihan melalui kontrol suara.")}`);
                }
              }}
            >
              <div className="editorial-rule-icon voice" aria-hidden="true">
                <AudioLines size={22} />
              </div>
              <div className="editorial-rule-content">
                <strong className="editorial-rule-title"><UiText>{"Bantuan Audio"}</UiText></strong>
                <p className="editorial-rule-desc">
                  <UiText>{"Tersedia pembacaan soal dan pilihan melalui kontrol suara."}</UiText>
                </p>
              </div>
              <span className="editorial-rule-badge" aria-hidden="true">
                <Volume2 size={13} /> <UiText>{"Dengarkan"}</UiText>
              </span>
            </div>
          </div>

          <button
            type="button"
            className="button primary editorial-start-button"
            onClick={() => void start()}
            disabled={busy || availability !== "open"}
            data-voice-menu="start-assignment"
          >
            {busy ? <UiText>{"Menyiapkan…"}</UiText> : <UiText>{"Mulai tugas"}</UiText>}
            {busy ? <Spinner /> : <ArrowRight size={17} aria-hidden="true" />}
          </button>
        </section>
      ) : (
        question && (
          <div className="editorial-attempt-grid">
            <aside className="panel editorial-section editorial-progress editorial-progress-top">
              <div className="editorial-progress-header">
                <div className="editorial-progress-info">
                  <h2><UiText>{"Progres tugas"}</UiText></h2>
                  <strong>
                    {answeredCount}
                    <span> / {attempt.questions.length}<UiText>{" soal tersimpan"}</UiText></span>
                  </strong>
                </div>
                <nav
                  className="editorial-question-nav"
                  aria-label={t("Pilih nomor soal")}
                >
                  {attempt.questions.map((q, i) => (
                    <button
                      type="button"
                      key={q.id}
                      onClick={() => void navigate(i)}
                      disabled={busy || !!pending}
                      aria-current={index === i ? "step" : undefined}
                      className={attempt.answers[q.id] ? "answered" : ""}
                      aria-label={t("Soal {number}", { number: q.order_index }) + t(attempt.answers[q.id] ? ", jawaban tersimpan" : ", belum dijawab")}
                    >
                      {q.order_index}
                    </button>
                  ))}
                </nav>
              </div>
              <progress
                value={answeredCount}
                max={attempt.questions.length}
                aria-label={t("{count} dari {total} jawaban tersimpan", { count: answeredCount, total: attempt.questions.length })}
              />
              <p className="editorial-progress-hint"><UiText>{"Jawaban tersimpan saat kamu menekan Simpan & lanjut."}</UiText></p>
            </aside>
            <div className="editorial-main">
              <section className="panel editorial-section">
                <span className="editorial-kicker"><UiText>{"SOAL "}</UiText>{question.order_index}<UiText>{" DARI "}</UiText>{attempt.questions.length}
                </span>
                <h2
                  ref={heading}
                  tabIndex={-1}
                  className="editorial-student-question"
                >
                  {question.prompt}
                </h2>
                <fieldset
                  className="quiz-options editorial-student-options"
                  disabled={busy || !!pending || availability !== "open"}
                >
                  <legend><UiText>{"Pilih satu jawaban"}</UiText></legend>
                  {question.options.map((o, i) => (
                    <label
                      key={o.id}
                      className={`quiz-option ${selected === o.id ? "selected" : ""}`}
                    >
                      <input
                        type="radio"
                        name={`answer-${question.id}`}
                        value={o.id}
                        checked={selected === o.id}
                        onChange={() => setSelected(o.id)}
                        aria-label={`${t("Pilihan {letter}", { letter: String.fromCharCode(65 + i) })}, ${o.label}`}
                      />
                      <span className="quiz-option-key">
                        {String.fromCharCode(65 + i)}
                      </span>
                      <span>{o.label}</span>
                    </label>
                  ))}
                </fieldset>
                <p className="editorial-help">
                  {dirty
                    ? <UiText>{"Pilihan terbaru belum disimpan."}</UiText>
                    : saved
                      ? <UiText>{"Pilihan pada soal ini sudah tersimpan."}</UiText>
                      : <UiText>{"Pilih jawaban, lalu simpan untuk melanjutkan."}</UiText>}
                </p>
                <div className="editorial-question-footer">
                  <button
                    type="button"
                    className="button secondary"
                    disabled={index === 0 || busy || !!pending}
                    onClick={() => void navigate(index - 1)}
                  >
                    <ArrowLeft size={16} aria-hidden="true" /><UiText>{"Sebelumnya"}</UiText></button>
                  <button
                    type="button"
                    className="button primary"
                    disabled={
                      !selected || busy || !!pending || availability !== "open"
                    }
                    onClick={() => void save()}
                  >
                    {busy && busyLabel === "Menyimpan jawaban…" ? <Spinner /> : <Save size={16} aria-hidden="true" />}<UiText>{"Simpan & lanjut"}</UiText></button>
                </div>
              </section>
              <VoiceControls
                key={question.id}
                autoPlayKey={question.id}
                text={`${t("Soal {number}", { number: question.order_index })}. ${question.narration || question.prompt}. ${question.options.map((o, i) => `${t("Pilihan {letter}", { letter: String.fromCharCode(65 + i) })}: ${o.label}`).join(". ")}`}
              />
              <section className="panel editorial-section editorial-final-submit">
                <div>
                  <h2><UiText>{"Tinjau sebelum mengirim"}</UiText></h2>
                  <p>
                    {pending
                      ? <UiText>{"Hasil pengiriman belum pasti. Pilihan dikunci sampai pengiriman ulang selesai; permintaan yang sama tidak akan dinilai dua kali."}</UiText>
                      : <UiText>{"Pastikan semua jawaban sudah tersimpan. Setelah dikirim, jawaban tidak dapat diubah."}</UiText>}
                  </p>
                </div>
                <button
                  type="button"
                  className="button primary"
                  disabled={
                    busy ||
                    (!pending &&
                      (dirty ||
                        answeredCount !== attempt.questions.length ||
                        availability !== "open"))
                  }
                  onClick={() => void submit()}
                >
                  {busy && busyLabel === "Menilai hasil tugas…" ? <Spinner /> : <Send size={17} aria-hidden="true" />}{" "}
                  {busy && busyLabel === "Menilai hasil tugas…"
                    ? <UiText>{"Mengirim…"}</UiText>
                    : pending
                      ? <UiText>{"Coba kirim kembali"}</UiText>
                      : <UiText>{"Kirim semua jawaban"}</UiText>}
                </button>
              </section>
            </div>
          </div>
        )
      )}
    </>
  );
}

"use client";
import { quizPointsLabel } from "@/lib/quiz-points-display";
import { UiText, useI18n, UiDate } from "@/components/language-provider";


import { useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Save,
  Send,
} from "lucide-react";
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

  if (result)
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
            {result.correct_count}<UiText>{" dari "}</UiText>{result.total_questions}<UiText>{" jawaban benar."}</UiText></p>
          <small><UiText>{"Dikirim "}</UiText>{<UiDate value={result.submitted_at} time empty="Tanpa batas waktu" />}</small>
        </section>
        {result.feedback_released ? (
          <section className="panel editorial-section">
            <h2><UiText>{"Pembahasan jawaban"}</UiText></h2>
            {result.review.map((r, i) => (
              <article
                key={r.question_id}
                className="editorial-review-question"
              >
                <Badge active={r.is_correct}>
                  {r.is_correct ? <UiText>{"Benar"}</UiText> : <UiText>{"Perlu dipelajari lagi"}</UiText>}
                </Badge>
                <h3>
                  {i + 1}. {r.prompt}
                </h3>
                <p><UiText>{"Jawabanmu:"}</UiText>{" "}
                  <strong>
                    {r.options.find((o) => o.id === r.option_id)?.label}
                  </strong>
                </p>
                <p><UiText>{"Jawaban benar:"}</UiText>{" "}
                  <strong>
                    {r.options.find((o) => o.id === r.correct_option_id)?.label}
                  </strong>
                </p>
                <p className="editorial-feedback">
                  {r.explanation ||
                    <UiText>{"Guru belum menambahkan pembahasan untuk soal ini."}</UiText>}
                </p>
                <VoiceControls
                  key={r.question_id}
                  text={`${r.prompt}. ${t("Jawaban benar:")} ${r.options.find((o) => o.id === r.correct_option_id)?.label}. ${r.explanation}`}
                />
              </article>
            ))}
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
          <ul>
            <li>
              {assignment.total_questions}<UiText>{" soal pilihan ganda, satu percobaan."}</UiText></li>
            <li><UiText>{"Jawaban dapat ditinjau kembali sebelum dikirim."}</UiText></li>
            <li><UiText>{"Tersedia pembacaan soal dan pilihan melalui kontrol suara."}</UiText></li>
          </ul>
          <button
            type="button"
            className="button primary"
            onClick={() => void start()}
            disabled={busy || availability !== "open"}
          >
            {busy ? <UiText>{"Menyiapkan…"}</UiText> : <UiText>{"Mulai tugas"}</UiText>}
            {busy ? <Spinner /> : <ArrowRight size={17} aria-hidden="true" />}
          </button>
        </section>
      ) : (
        question && (
          <div className="editorial-attempt-grid">
            <aside className="panel editorial-section editorial-progress">
              <h2><UiText>{"Progres tugas"}</UiText></h2>
              <strong>
                {answeredCount}
                <span> / {attempt.questions.length}<UiText>{" soal tersimpan"}</UiText></span>
              </strong>
              <progress
                value={answeredCount}
                max={attempt.questions.length}
                aria-label={t("{count} dari {total} jawaban tersimpan", { count: answeredCount, total: attempt.questions.length })}
              />
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
              <p><UiText>{"Jawaban tersimpan saat kamu menekan Simpan & lanjut."}</UiText></p>
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
                      className={selected === o.id ? "selected" : ""}
                    >
                      <input
                        type="radio"
                        name={`answer-${question.id}`}
                        value={o.id}
                        checked={selected === o.id}
                        onChange={() => setSelected(o.id)}
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

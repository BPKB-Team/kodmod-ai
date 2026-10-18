"use client";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

import { UiText, useI18n } from "@/components/language-provider";


import { useEffect, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, Lightbulb, LoaderCircle, RefreshCw, Send, Sparkles, XCircle } from "lucide-react";
import { confirmAction, notifyResult } from "@/lib/dialogs";
import type { QuizQuestion, QuizStartResponse, QuizSubmitRequest, QuizRecoveryResponse } from "@/lib/quiz-types";
import type { StudentMaterial } from "@/lib/class-types";
import { useQuizExitGuard } from "./use-quiz-exit-guard";
import { prepareQuizSubmission, quizProgress, readQuizSubmissionResponse, submissionFailureAction } from "@/lib/quiz-submission.mjs";
import { VoiceControls } from "./voice-controls";
import { LoadingStatus } from "./loading-feedback";

type Phase = "idle" | "starting" | "active" | "submitting" | "review" | "complete";

async function errorText(response: Response, fallback: string) {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "message" in body) {
      const message = (body as { message?: unknown }).message;
      if (typeof message === "string" && message) return message;
    }
  } catch {
    // Keep the safe fallback when the upstream response is not JSON.
  }
  return fallback;
}

async function readJson<T>(response: Response, fallback: string) {
  if (!response.ok) throw new Error(await errorText(response, fallback));
  return (await response.json()) as T;
}

export function StudentQuiz({ materials = [], initialSession = null, embedded = false, onReturn }: {
  materials?: StudentMaterial[];
  initialSession?: QuizRecoveryResponse | null;
  embedded?: boolean;
  onReturn?: () => void;
}) {
  const { t, language } = useI18n();
  const [phase, setPhase] = useState<Phase>(initialSession ? initialSession.status === "completed" ? "complete" : "active" : "idle");
  const [question, setQuestion] = useState<QuizQuestion | null>(initialSession?.current_question ?? null);
  const [nextQuestion, setNextQuestion] = useState<QuizQuestion | null>(null);
  const [quizSessionId, setQuizSessionId] = useState(initialSession?.quiz_session_id ?? "");
  const [totalQuestions, setTotalQuestions] = useState(initialSession?.total_questions ?? 0);
  const [materialId, setMaterialId] = useState(initialSession?.material_id ?? "");
  const [contentLanguage] = useState(initialSession?.language);
  const [submissionPending, setSubmissionPending] = useState(false);
  const [restartRequired, setRestartRequired] = useState(false);
  const [answerAttempt, setAnswerAttempt] = useState(0);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState("");
  const [isCorrect, setIsCorrect] = useState(false);
  const [score, setScore] = useState(0);
  const [cumulativeScore, setCumulativeScore] = useState(initialSession?.last_result?.cumulative_score ?? 0);
  const [summary, setSummary] = useState("");
  const [count, setCount] = useState("5");
  const [difficulty, setDifficulty] = useState("adaptive");
  const [error, setError] = useState("");
  const questionStartedAt = useRef(0);
  const pendingSubmission = useRef<Readonly<QuizSubmitRequest> | null>(null);
  const requestInFlight = useRef(false);
  const acceptingAnswer = useRef(Boolean(initialSession?.current_question));
  const answerAttemptRef = useRef(0);
  const activeQuiz = ["active", "submitting", "review"].includes(phase);
  useQuizExitGuard(activeQuiz);
  useEffect(() => { questionStartedAt.current = performance.now(); }, []);

  function beginAnswer() {
    pendingSubmission.current = null;
    setSubmissionPending(false);
    setRestartRequired(false);
    answerAttemptRef.current += 1;
    setAnswerAttempt(answerAttemptRef.current);
    acceptingAnswer.current = true;
    questionStartedAt.current = performance.now();
  }

  function changeAnswer(value: string) {
    if (!acceptingAnswer.current || requestInFlight.current || pendingSubmission.current || answerAttemptRef.current !== answerAttempt) return;
    setAnswer(value);
  }

  async function startQuiz(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (activeQuiz || embedded) return;
    const selectedMaterial = materials.find((item) => item.id === materialId);
    if (!selectedMaterial) { setError(t("Pilih materi untuk menyiapkan asesmen.")); return; }
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    try {
      if (phase !== "idle") {
        const confirmed = await confirmAction({
          title: "Mulai latihan baru?",
          text: "Hasil latihan sebelumnya tetap tersimpan. Soal baru akan dibuat dari materi yang dipilih.",
          confirmText: "Ya, mulai baru",
        });
        if (!confirmed) return;
      }
      acceptingAnswer.current = false;
      pendingSubmission.current = null;
      setSubmissionPending(false);
      setRestartRequired(false);
      setPhase("starting");
      setError("");
      setFeedback("");
      setSummary("");
      setAnswer("");
      setNextQuestion(null);
      setCumulativeScore(0);
      const payload: Record<string, number | string> = { n_questions: Number(count) };
      payload.class_id = selectedMaterial.class_id;
      payload.material_id = selectedMaterial.id;
      payload.language = language;
      if (difficulty !== "adaptive") payload.difficulty = difficulty;
      const response = await fetch("/api/quiz/start", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await readJson<QuizStartResponse>(response, "Latihan belum dapat dimulai.");
      setQuizSessionId(result.quiz_session_id);
      setQuestion(result.first_question);
      setTotalQuestions(result.total_questions);
      beginAnswer();
      setPhase("active");
    } catch (caught) {
      setPhase("idle");
      setError(caught instanceof Error ? caught.message : "Latihan belum dapat dimulai.");
    } finally {
      requestInFlight.current = false;
    }
  }

  async function submitAnswer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!question || !answer.trim() || phase !== "active" || restartRequired || requestInFlight.current) return;
    requestInFlight.current = true;
    acceptingAnswer.current = false;
    setPhase("submitting");
    setError("");
    let completionMessage: string | null = null;
    try {
      const payload = prepareQuizSubmission(pendingSubmission.current, {
        quiz_session_id: quizSessionId,
        question_id: question.question_id,
        student_answer: answer,
        response_latency_ms: Math.min(3600000, Math.max(0, Math.round(performance.now() - questionStartedAt.current))),
      });
      pendingSubmission.current = payload;
      setSubmissionPending(true);
      const response = await fetch("/api/quiz/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await readQuizSubmissionResponse(response);
      pendingSubmission.current = null;
      setSubmissionPending(false);
      setScore(result.score);
      setCumulativeScore(result.cumulative_score);
      setFeedback(result.feedback);
      setIsCorrect(result.is_correct);
      setNextQuestion(result.next_question);
      setSummary(result.final_summary || "");
      setPhase(result.quiz_complete ? "complete" : "review");
      if (result.quiz_complete) {
        completionMessage = result.final_summary || "Latihan selesai. Terima kasih sudah mencoba.";
      }
    } catch (caught) {
      const action = pendingSubmission.current ? submissionFailureAction(caught) : "edit";
      if (action === "edit") {
        beginAnswer();
      } else if (action === "restart") {
        setRestartRequired(true);
      }
      setPhase("active");
      setError(caught instanceof Error ? caught.message : "Hasil jawaban belum dapat dipastikan. Coba kirim kembali.");
    } finally {
      requestInFlight.current = false;
    }
    if (completionMessage) {
      await notifyResult(completionMessage);
    }
  }

  function continueQuiz() {
    if (!nextQuestion) return;
    setQuestion(nextQuestion);
    setNextQuestion(null);
    setAnswer("");
    setFeedback("");
    setError("");
    beginAnswer();
    setPhase("active");
  }

  const { questionNumber, answeredQuestions } = quizProgress(question, totalQuestions, phase === "complete");
  const answerLocked = phase !== "active" || submissionPending || restartRequired;

  return (
    <div className="quiz-shell">
      <LoadingStatus active={phase === "starting" || phase === "submitting"} label={phase === "starting" ? "Menyiapkan soal dari materi…" : "Memeriksa jawabanmu…"} />
      {(phase === "idle" || phase === "starting") && (
        <section className="panel quiz-start-card">
          <div className="quiz-start-icon" aria-hidden="true">
            <Sparkles size={28} />
          </div>
          <h2><UiText>{"Asesmen mandiri"}</UiText></h2>
          <p><UiText>{"Jawab dengan kata-katamu sendiri. Tutor akan memberi umpan balik di setiap langkah, bukan sekadar nilai akhir."}</UiText></p>
          <form className="quiz-settings" onSubmit={(event) => void startQuiz(event)}>
            <label className="field"><UiText>{"Materi belajar"}</UiText><NativeSelect value={materialId} onChange={(event) => setMaterialId(event.target.value)} disabled={phase === "starting"} required>
              <option value=""><UiText>{"Pilih materi"}</UiText></option>
              {materials.map((item) => <option value={item.id} key={item.id} disabled={item.rag_status !== "ready" || item.content_version !== item.indexed_version}>{item.subject} · {item.title}</option>)}
            </NativeSelect></label>
            <label className="field"><UiText>{"Jumlah soal"}</UiText><NativeSelect value={count} onChange={(event) => setCount(event.target.value)} disabled={phase === "starting"}>
                <option value="3"><UiText>{"3 soal · cepat"}</UiText></option>
                <option value="5"><UiText>{"5 soal · seimbang"}</UiText></option>
                <option value="10"><UiText>{"10 soal · mendalam"}</UiText></option>
              </NativeSelect>
            </label>
            <label className="field"><UiText>{"Tingkat tantangan"}</UiText><NativeSelect value={difficulty} onChange={(event) => setDifficulty(event.target.value)} disabled={phase === "starting"}>
                <option value="adaptive"><UiText>{"Adaptif sesuai progres"}</UiText></option>
                <option value="easy"><UiText>{"Santai"}</UiText></option>
                <option value="medium"><UiText>{"Seimbang"}</UiText></option>
                <option value="hard"><UiText>{"Menantang"}</UiText></option>
              </NativeSelect>
            </label>
            <button className="button primary quiz-start-button" type="submit" disabled={phase === "starting" || !materialId}>
              {phase === "starting" ? <LoaderCircle className="spin" size={18} aria-hidden="true" /> : <Lightbulb size={18} aria-hidden="true" />}
              {phase === "starting" ? <UiText>{"Menyiapkan soal…"}</UiText> : <UiText>{"Mulai latihan"}</UiText>}
            </button>
          </form>
          <ul className="quiz-benefits">
            <li><CheckCircle2 size={17} aria-hidden="true" /><UiText>{" Bisa menjawab lewat teks atau suara."}</UiText></li>
            <li><CheckCircle2 size={17} aria-hidden="true" /><UiText>{" Feedback diberikan setelah setiap jawaban."}</UiText></li>
            <li><CheckCircle2 size={17} aria-hidden="true" /><UiText>{" Hasil membantu membentuk rekomendasi belajar."}</UiText></li>
          </ul>
        </section>
      )}

      {question && phase !== "idle" && phase !== "starting" && (
        <>
          <section className="panel quiz-progress" aria-label={t("Progres latihan")}>
            <div>
              <span className="muted"><UiText>{embedded ? "Mini kuis Tutor" : "Asesmen mandiri"}</UiText></span>
              <strong><UiText>{"Soal "}</UiText>{questionNumber}<UiText>{" dari "}</UiText>{totalQuestions}
              </strong>
            </div>
            <span className="quiz-score-label"><UiText>{"Skor sementara "}</UiText>{Math.round(cumulativeScore * 100)}%</span>
            <progress value={answeredQuestions} max={totalQuestions || 1} aria-label={`${answeredQuestions} dari ${totalQuestions} soal selesai`} />
            {!embedded && phase === "complete" && <button type="button" className="button secondary small" onClick={() => void startQuiz()}>
              <RefreshCw size={16} aria-hidden="true" /><UiText>{"Latihan baru"}</UiText></button>
            }
          </section>

          <section className="panel quiz-question-card">
            <div className="quiz-question-meta">
              <span><UiText>{"Soal "}</UiText>{questionNumber}</span>
              <span>{question.difficulty === "medium" ? <UiText>{"Seimbang"}</UiText> : question.difficulty}</span>
            </div>
            <h2>{question.question}</h2>
            <VoiceControls
              key={`${answerAttempt}:${answerLocked ? "read" : "answer"}`}
              text={feedback || [question.question, ...question.options.map((option, index) => `${t("Pilihan {letter}", { letter: String.fromCharCode(65 + index) })}: ${option}`)].join(". ")}
              language={contentLanguage}
              autoPlayKey={phase === "submitting" ? null : `${quizSessionId}:${question.question_id}:${phase}:${answerAttempt}`}
              onTranscript={answerLocked ? undefined : changeAnswer}
            />

            {phase === "active" || phase === "submitting" ? (
              <form className="quiz-answer-form" onSubmit={(event) => void submitAnswer(event)}>
                {question.options.length ? (
                  <fieldset className="quiz-options">
                    <legend><UiText>{"Pilih atau ucapkan jawaban"}</UiText></legend>
                    {question.options.map((option, index) => (
                      <label className={`quiz-option ${answer === option ? "selected" : ""}`} key={option}>
                        <input
                          type="radio"
                          name="quiz-answer"
                          value={option}
                          checked={answer === option}
                          onChange={() => changeAnswer(option)}
                          disabled={answerLocked}
                        />
                        <span className="quiz-option-key">{String.fromCharCode(65 + index)}</span>
                        <span>{option}</span>
                      </label>
                    ))}
                  </fieldset>
                ) : (
                  <label className="field quiz-answer-field"><UiText>{"Jawabanmu"}</UiText><Textarea rows={4} maxLength={4000} value={answer} onChange={(event) => changeAnswer(event.target.value)} disabled={answerLocked} placeholder={t("Jelaskan dengan kata-katamu sendiri…")} />
                  </label>
                )}
                <div className="quiz-answer-footer">
                  <span>{answer.length}<UiText>{"/4.000 karakter"}</UiText></span>
                  <button className="button primary" type="submit" disabled={phase === "submitting" || restartRequired || !answer.trim()}>
                    {phase === "submitting" ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : <Send size={17} aria-hidden="true" />}
                    {phase === "submitting" ? <UiText>{"Menilai…"}</UiText> : submissionPending ? <UiText>{"Coba kirim kembali"}</UiText> : <UiText>{"Kirim jawaban"}</UiText>}
                  </button>
                </div>
                {submissionPending && phase === "active" && !restartRequired && (
                  <p role="status"><UiText>{"Jawaban dikunci sampai hasil diterima. Kirim kembali untuk memeriksa hasil jawaban yang sama."}</UiText></p>
                )}
              </form>
            ) : (
              <section className={`quiz-feedback ${isCorrect ? "correct" : "incorrect"}`} aria-live="polite">
                <div className="quiz-feedback-heading">
                  {isCorrect ? <CheckCircle2 size={22} aria-hidden="true" /> : <XCircle size={22} aria-hidden="true" />}
                  <strong>{isCorrect ? <UiText>{"Jawabanmu tepat"}</UiText> : <UiText>{"Mari kita periksa lagi"}</UiText>}</strong>
                  <span>{Math.round(score * 100)}<UiText>{" poin"}</UiText></span>
                </div>
                <p>{feedback}</p>
                {phase === "complete" ? (
                  <div className="quiz-complete-summary">
                    <strong>{summary || <UiText>{"Latihan selesai."}</UiText>}</strong>
                    {embedded ? <button type="button" className="button primary" onClick={onReturn}><UiText>{"Kembali belajar"}</UiText></button> : <button type="button" className="button primary" onClick={() => void startQuiz()}>
                      <RefreshCw size={17} aria-hidden="true" /><UiText>{"Coba lagi"}</UiText></button>}
                  </div>
                ) : (
                  <button type="button" className="button primary" onClick={continueQuiz}>
                    {nextQuestion?.order_index === question.order_index ? <UiText>{"Coba jawab lagi"}</UiText> : <UiText>{"Lanjut ke soal berikutnya"}</UiText>}
                  </button>
                )}
              </section>
            )}
          </section>
        </>
      )}

      {error && <p className="alert error-message quiz-feedback-alert" role="alert">{t(error)}</p>}
      {initialSession && phase === "active" && <p className="info-note" role="status"><UiText>{"Sesi dilanjutkan. Jawaban yang sudah dikirim tetap tersimpan."}</UiText>{initialSession.last_result?.feedback ? ` ${initialSession.last_result.feedback}` : ""}</p>}
    </div>
  );
}

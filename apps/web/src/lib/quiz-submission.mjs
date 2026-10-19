const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUESTION_TYPES = new Set(["mcq", "spoken", "explain", "reasoning", "step_by_step"]);
const INVALID_SUBMISSION = "Data jawaban tidak valid. Periksa jawaban lalu kirim kembali.";
const UNKNOWN_RESULT = "Hasil jawaban belum dapat dipastikan. Coba kirim kembali jawaban yang sama.";

export class QuizSubmissionError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = "QuizSubmissionError";
    this.status = status;
  }
}

export function createQuizSubmissionId(cryptoSource = globalThis.crypto) {
  if (typeof cryptoSource?.randomUUID === "function") return cryptoSource.randomUUID();
  if (typeof cryptoSource?.getRandomValues !== "function") {
    throw new QuizSubmissionError("Peramban belum dapat menyiapkan ID jawaban. Muat ulang lalu coba lagi.", 400);
  }
  const bytes = cryptoSource.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function parseQuizSubmission(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new QuizSubmissionError(INVALID_SUBMISSION, 400);
  }
  const submissionId = typeof input.submission_id === "string" ? input.submission_id.trim() : "";
  const sessionId = typeof input.quiz_session_id === "string" ? input.quiz_session_id.trim() : "";
  const questionId = typeof input.question_id === "string" ? input.question_id.trim() : "";
  const answer = typeof input.student_answer === "string" ? input.student_answer.trim() : "";
  if (!UUID.test(submissionId) || !UUID.test(sessionId) || !UUID.test(questionId) || !answer || answer.length > 4000) {
    throw new QuizSubmissionError(INVALID_SUBMISSION, 400);
  }
  const payload = {
    submission_id: submissionId,
    quiz_session_id: sessionId,
    question_id: questionId,
    student_answer: answer,
  };
  if (input.response_latency_ms !== undefined) {
    if (!Number.isInteger(input.response_latency_ms) || input.response_latency_ms < 0 || input.response_latency_ms > 3600000) {
      throw new QuizSubmissionError(INVALID_SUBMISSION, 400);
    }
    payload.response_latency_ms = input.response_latency_ms;
  }
  return payload;
}

export function prepareQuizSubmission(pending, input, createId = createQuizSubmissionId) {
  if (pending) {
    for (const field of ["quiz_session_id", "question_id", "student_answer"]) {
      if (typeof input[field] !== "string" || input[field].trim() !== pending[field]) {
        throw new QuizSubmissionError("Jawaban yang sedang menunggu hasil tidak dapat diubah.", 409);
      }
    }
    return pending;
  }
  return Object.freeze(parseQuizSubmission({ ...input, submission_id: createId() }));
}

export function quizProgress(question, totalQuestions, complete = false) {
  const total = Number.isInteger(totalQuestions) ? Math.max(0, totalQuestions) : 0;
  const order = Number.isInteger(question?.order_index) ? Math.max(0, question.order_index) : 0;
  return {
    questionNumber: total ? Math.min(order + 1, total) : 0,
    answeredQuestions: complete ? total : Math.min(order, total),
  };
}

export function submissionFailureAction(error) {
  if (error instanceof QuizSubmissionError) {
    if (error.status === 400 || error.status === 422) return "edit";
    if ([401, 403, 404, 409].includes(error.status)) return "restart";
  }
  return "retry";
}

function isQuestion(value) {
  return value && typeof value === "object"
    && typeof value.question_id === "string" && value.question_id.trim().length > 0
    && Number.isInteger(value.order_index) && value.order_index >= 0
    && typeof value.question === "string" && value.question.trim().length > 0
    && QUESTION_TYPES.has(value.question_type)
    && Array.isArray(value.options) && value.options.every((option) => typeof option === "string")
    && typeof value.difficulty === "string";
}

function isScore(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export async function readQuizSubmissionResponse(response) {
  let body;
  try {
    body = await response.json();
  } catch {
    throw new QuizSubmissionError(UNKNOWN_RESULT, response.ok ? null : response.status);
  }
  if (!response.ok) {
    throw new QuizSubmissionError(typeof body?.message === "string" ? body.message : UNKNOWN_RESULT, response.status);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)
    || !isScore(body.score) || !isScore(body.cumulative_score)
    || typeof body.is_correct !== "boolean" || typeof body.feedback !== "string"
    || typeof body.quiz_complete !== "boolean"
    || !(body.final_summary === null || typeof body.final_summary === "string")
    || (body.policy_version === 2 ?
      !["answering", "review", "complete"].includes(body.question_state) ||
      (body.question_state === "review" ? !isQuestion(body.review_question) : body.question_state === "answering" ? !isQuestion(body.current_question) : false)
      : (body.quiz_complete ? body.next_question !== null : !isQuestion(body.next_question)))) {
    throw new QuizSubmissionError(UNKNOWN_RESULT);
  }
  return body;
}

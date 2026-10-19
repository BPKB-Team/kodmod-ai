import { createQuizSubmissionId, QuizSubmissionError } from "./quiz-submission.mjs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseQuizAction(input) {
  if (!input || !UUID.test(input.action_id) || !UUID.test(input.question_id) || !["hint", "advance"].includes(input.action)
    || Object.keys(input).some(key => !["action_id", "question_id", "action"].includes(key))) throw new QuizSubmissionError("Aksi tidak valid.", 400);
  return { action_id: input.action_id, question_id: input.question_id, action: input.action };
}
export function prepareQuizAction(pending, input, createId = createQuizSubmissionId) {
  if (pending) {
    if (input.question_id !== pending.question_id || input.action !== pending.action) throw new QuizSubmissionError("Aksi sedang menunggu hasil.", 409);
    return pending;
  }
  return Object.freeze(parseQuizAction({ ...input, action_id: createId() }));
}
export function quizUiState(view) {
  const actions = view.available_actions ?? [];
  return { phase: view.question_state === "complete" ? "complete" : view.question_state === "review" ? "review" : "active",
    canAnswer: actions.includes("answer"), canHint: actions.includes("hint"), canAdvance: actions.includes("advance") };
}
export function validInteraction(body) {
  return body?.policy_version === 2 && ["answering", "review", "complete"].includes(body.question_state)
    && Array.isArray(body.available_actions) && body.available_actions.every(a => ["answer", "hint", "advance"].includes(a))
    && (body.question_state !== "answering" || body.current_question?.question_id)
    && (body.question_state !== "review" || (body.review_question?.question_id && typeof body.last_review === "string"));
}
export async function readQuizInteraction(response) {
  let body;
  try { body = await response.json(); } catch { throw new QuizSubmissionError("Respons aksi tidak valid."); }
  if (!response.ok) throw new QuizSubmissionError(body?.message ?? "Aksi belum dapat dipastikan.", response.status);
  if (!validInteraction(body)) throw new QuizSubmissionError("Respons aksi tidak valid.");
  return body;
}

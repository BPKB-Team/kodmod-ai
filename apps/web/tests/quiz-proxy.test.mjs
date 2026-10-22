// Requires Next.js and the disposable api-fixture; never target a real backend.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const origin = process.env.WEB_TEST_ORIGIN;
const api = process.env.API_FIXTURE_ORIGIN;
const enabled = Boolean(origin && api);
const headers = { Cookie: "kodmod_session=fixture-test-student", "Content-Type": "application/json" };
const request = (path, body) => fetch(origin + path, { method: "POST", headers, body: JSON.stringify(body) });

before(async () => {
  if (!enabled) return;
  const response = await fetch(`${api}/auth/me`, { headers: { Authorization: "Bearer fixture-test-admin" } });
  assert.equal((await response.json()).username, "admin.test", "Only use the isolated fixture.");
});

test("quiz proxy forwards the same ID and replays a result after a lost response", { skip: !enabled }, async () => {
  await fetch(`${api}/__fixture/quiz`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ failures: [503] }) });
  const started = await request("/api/quiz/start", { n_questions: 2 });
  assert.equal(started.status, 200);
  const quiz = await started.json();
  const body = { quiz_session_id: quiz.quiz_session_id, question_id: quiz.first_question.question_id,
    submission_id: randomUUID(), student_answer: "A", response_latency_ms: 1200, student_id: "foreign-student" };
  assert.equal((await request("/api/quiz/submit", body)).status, 503);
  const retry = await request("/api/quiz/submit", body);
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).next_question.order_index, 1);
  const recorded = await (await fetch(`${api}/__fixture/quiz`)).json();
  assert.equal(recorded.requests.length, 2);
  assert.deepEqual(recorded.requests[0], recorded.requests[1]);
  assert.equal(recorded.requests[0].submission_id, body.submission_id);
  assert.equal(recorded.requests[0].response_latency_ms, 1200);
  assert.ok(!("student_id" in recorded.requests[0]));
});

test("student can finish a quiz through the authenticated proxy and receive a final result", { skip: !enabled }, async () => {
  const started = await request("/api/quiz/start", { n_questions: 1, difficulty: "easy" });
  assert.equal(started.status, 200);
  const quiz = await started.json();
  assert.equal(quiz.total_questions, 1);

  const completed = await request("/api/quiz/submit", {
    quiz_session_id: quiz.quiz_session_id,
    question_id: quiz.first_question.question_id,
    submission_id: randomUUID(),
    student_answer: "A",
    response_latency_ms: 900,
  });
  assert.equal(completed.status, 200);
  const result = await completed.json();
  assert.equal(result.quiz_complete, true);
  assert.equal(result.is_correct, true);
  assert.match(result.final_summary, /Skor kamu/);
});

test("quiz proxy rejects invalid evidence before forwarding it", { skip: !enabled }, async () => {
  await fetch(`${api}/__fixture/quiz`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const response = await request("/api/quiz/submit", { quiz_session_id: randomUUID(), question_id: randomUUID(), student_answer: "A" });
  assert.equal(response.status, 400);
  const recorded = await (await fetch(`${api}/__fixture/quiz`)).json();
  assert.equal(recorded.requests.length, 0);
});

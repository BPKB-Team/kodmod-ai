import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

globalThis.kodmodGenerationTestRole = "student";
const sessionStub = `export const session = async () => ({ token: "fixture", user: { role: globalThis.kodmodGenerationTestRole, preferred_language: "id" } }); export const requireSession = session;`;
const stubs = new Map([
  ["server-only", "export {};"],
  ["next/server", `export class NextResponse extends Response { static json(body, init) { return new NextResponse(JSON.stringify(body), init); } }`],
  ["@/lib/session", sessionStub],
  ["./session", sessionStub],
  ["next/navigation", "export function notFound() { throw new Error('Not found'); }"],
  ["./server-api", "export class BackendError extends Error { constructor(status, message) { super(message); this.status = status; } }"],
]);
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (stubs.has(specifier)) return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(stubs.get(specifier)) };
    if (specifier.startsWith("@/")) return { shortCircuit: true, url: new URL("../src/" + specifier.slice(2) + ".ts", import.meta.url).href };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith(".ts")) return { shortCircuit: true, format: "module", source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText };
    return next(url, context);
  },
});
const { forwardChat } = await import("../src/lib/chat-proxy.ts");
const { forwardQuiz } = await import("../src/lib/quiz-proxy.ts");
const teacherProposal = await import("../src/app/api/teacher/quizzes/propose/route.ts");
hooks.deregister();

test("a verified generation taking one minute survives while ordinary reads remain bounded", async () => {
  const originalTimeout = AbortSignal.timeout;
  const originalFetch = globalThis.fetch;
  try {
    // Model a one-minute upstream operation without a wall-clock sleep.
    AbortSignal.timeout = milliseconds => {
      const controller = new AbortController();
      if (milliseconds <= 60_000) controller.abort(new DOMException("Timed out", "TimeoutError"));
      return controller.signal;
    };
    globalThis.fetch = async (_url, { signal }) => {
      signal.throwIfAborted();
      return Response.json({ ready: true });
    };
    const generation = { method: "POST", body: JSON.stringify({ language: "id" }) };
    for (const [forward, path] of [[forwardChat, "/chat/message"], [forwardQuiz, "/quiz/start"], [forwardQuiz, "/learning/start"], [forwardQuiz, "/learning/sessions/fixture/actions"]]) {
      const result = await forward(path, generation);
      assert.equal(result.status, 200, path);
      assert.deepEqual(await result.json(), { ready: true });
    }
    assert.equal((await forwardChat("/chat/sessions")).status, 503);
    assert.equal((await forwardQuiz("/quiz/sessions/fixture")).status, 503);
  } finally {
    AbortSignal.timeout = originalTimeout;
    globalThis.fetch = originalFetch;
  }
});

test("source rejection gives a useful message without forwarding provider diagnostics", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const code of ["insufficient_learning_content", "source_quality_failed"]) {
      globalThis.fetch = async () => Response.json({ detail: { code, message: "private provider diagnostics" } }, { status: 409 });
      for (const forward of [forwardChat, forwardQuiz]) {
        const result = await forward("/fixture", { method: "POST" });
        assert.equal(result.status, 409);
        const body = await result.json();
        assert.match(body.message, /pemeriksaan sumber/);
        assert.doesNotMatch(JSON.stringify(body), /private provider/);
      }
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("teacher proposal compatibility URL uses the bounded authenticated editorial handler", async () => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = AbortSignal.timeout;
  const calls = [];
  const request = (origin = "https://school.test") => new Request("https://school.test/api/teacher/quizzes/propose", {
    method: "POST", headers: { Origin: origin, Host: "school.test", "Content-Type": "application/json" },
    body: JSON.stringify({ class_id: "fixture-class", material_id: "fixture-material", n_questions: 3 }),
  });
  try {
    AbortSignal.timeout = milliseconds => {
      const controller = new AbortController();
      if (milliseconds <= 60_000) controller.abort(new DOMException("Timed out", "TimeoutError"));
      return controller.signal;
    };
    globalThis.fetch = async (url, options) => {
      options.signal.throwIfAborted();
      calls.push({ url, options });
      return Response.json({ questions: [], review_required: true });
    };
    globalThis.kodmodGenerationTestRole = "student";
    assert.equal((await teacherProposal.POST(request())).status, 403);
    globalThis.kodmodGenerationTestRole = "teacher";
    assert.equal((await teacherProposal.POST(request("https://untrusted.test"))).status, 403);
    assert.equal(calls.length, 0);
    const result = await teacherProposal.POST(request());
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { questions: [], review_required: true });
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.endsWith("/teacher/quizzes/propose"));
    assert.equal(calls[0].options.headers.Authorization, "Bearer fixture");
  } finally {
    globalThis.fetch = originalFetch;
    AbortSignal.timeout = originalTimeout;
    globalThis.kodmodGenerationTestRole = "student";
  }
});

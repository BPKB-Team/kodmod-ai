import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

const boundary = { current: null, calls: [], status: 200 };
globalThis.kodmodGuidedBoundary = boundary;
const stubs = new Map([
  ["server-only", "export {};"],
  ["next/server", `export class NextResponse extends Response { static json(value, init) { return new NextResponse(JSON.stringify(value), { ...init, headers: { "Content-Type": "application/json" } }); } }`],
  ["@/lib/session", "export const session = async () => globalThis.kodmodGuidedBoundary.current;"],
]);
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (stubs.has(specifier)) return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(stubs.get(specifier)) };
    if (specifier.startsWith("@/")) return { shortCircuit: true, url: new URL("../src/" + specifier.slice(2) + (/\.(ts|mjs)$/.test(specifier) ? "" : ".ts"), import.meta.url).href };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith(".ts")) return { shortCircuit: true, format: "module", source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText };
    return next(url, context);
  },
});
const learning = await import("../src/app/api/learning/[...path]/route.ts");
const quiz = await import("../src/app/api/quiz/start/route.ts");
const quizActions = await import("../src/app/api/quiz/[sessionId]/actions/route.ts");
const guidanceRead=await import("../src/app/api/analytics/me/guidance/route.ts");
const guidanceRefresh=await import("../src/app/api/analytics/me/guidance/refresh/route.ts");
const planSteps=await import("../src/app/api/analytics/me/plans/[...path]/route.ts");
hooks.deregister();
const id = "10000000-0000-4000-8000-000000000001";
const context = (...path) => ({ params: Promise.resolve({ path }) });
const request = body => new Request("http://localhost:3100/api/learning/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const student = language => ({ token: "fixture-only-token", user: { role: "student", preferred_language: language } });
globalThis.fetch = async (url, options) => {
  boundary.calls.push({ url, options });
  return Response.json(boundary.status === 200 ? { ok: true } : { detail: "Private upstream error" }, { status: boundary.status });
};

test("guided learning proxy admits only students and known routes", async () => {
  boundary.calls = [];
  boundary.current = null;
  assert.equal((await learning.GET(new Request("http://localhost/api/learning/active"), context("active"))).status, 401);
  boundary.current = { ...student("id"), user: { role: "teacher" } };
  assert.equal((await learning.POST(request({}), context("start"))).status, 403);
  boundary.current = student("en");
  for (const path of [["..", "auth", "me"], ["sessions", "invalid"], ["sessions", id, "delete"], ["sessions", id, "actions"]])
    assert.equal((await learning.GET(new Request("http://localhost"), context(...path))).status, 404);
  assert.equal(boundary.calls.length, 0);
});

test("learning uses account language and preserves explicit language for an action retry", async () => {
  boundary.current = student("en");
  const body = { class_id: id, material_id: id };
  assert.equal((await learning.POST(request(body), context("start"))).status, 200);
  assert.deepEqual(JSON.parse(boundary.calls.at(-1).options.body), { ...body, language: "en" });
  const intent = { request_id: id, revision: 3, action: "continue", language: "id" };
  assert.equal((await learning.POST(request(intent), context("sessions", id, "actions"))).status, 200);
  const forwarded = boundary.calls.at(-1);
  assert.deepEqual(JSON.parse(forwarded.options.body), intent);
  assert.equal(forwarded.options.headers.get("Authorization"), "Bearer fixture-only-token");
  assert.equal(forwarded.options.headers.has("xi-api-key"), false);
});

test("quiz proxy forwards the chosen material and strips forged ownership", async () => {
  boundary.current = student("en");
  const result = await quiz.POST(request({ class_id: id, material_id: id, n_questions: 3, student_id: "someone-else" }));
  assert.equal(result.status, 200);
  const body = JSON.parse(boundary.calls.at(-1).options.body);
  assert.equal(body.class_id, id); assert.equal(body.material_id, id);
  assert.equal(body.language, "en"); assert.equal(body.student_id, undefined);
});

test("an outdated learning revision offers session recovery without leaking provider errors", async () => {
  boundary.status = 409;
  const response = await learning.POST(request({ request_id: id, revision: 0, action: "continue" }), context("sessions", id, "actions"));
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.match(body.message, /Muat ulang sesi/);
  assert.ok(!body.message.includes("Private upstream error"));
  boundary.status = 200;
});


test("quiz actions preserve action identity and reject injected ownership or paths", async () => {
  boundary.current = student("id");
  const body = {action_id:id,question_id:id,action:"advance"};
  const context = value => ({params:Promise.resolve({sessionId:value})});
  assert.equal((await quizActions.POST(request(body),context(id))).status,200);
  assert.deepEqual(JSON.parse(boundary.calls.at(-1).options.body),body);
  assert.ok(boundary.calls.at(-1).url.endsWith(`/quiz/${id}/actions`));
  assert.equal((await quizActions.POST(request({...body,student_id:id}),context(id))).status,400);
  assert.equal((await quizActions.POST(request(body),context("../auth"))).status,404);
  boundary.current=null;
  assert.equal((await quizActions.POST(request(body),context(id))).status,401);
});


test("guidance routes preserve request IDs, self-only scope and strict step paths",async()=>{
 boundary.current=student("id");
 const body={request_id:id,expected_revision:2};
 const ctx=path=>({params:Promise.resolve({path})});
 assert.equal((await guidanceRead.GET(new Request("http://local?timezone=Asia%2FJakarta"))).status,200);
 assert.match(boundary.calls.at(-1).url,/analytics\/me\/guidance\?timezone=Asia%2FJakarta/);
 assert.equal((await planSteps.POST(request(body),ctx([id,"steps",id,"start"]))).status,200);
 assert.deepEqual(JSON.parse(boundary.calls.at(-1).options.body),body);
 assert.equal((await planSteps.POST(request(body),ctx(["..","steps",id,"start"]))).status,404);
 assert.equal((await planSteps.POST(request({...body,student_id:id}),ctx([id,"steps",id,"skip"]))).status,400);
 assert.equal((await guidanceRefresh.POST(request({...body,timezone:"UTC"}))).status,200);
 boundary.current=null;
 assert.equal((await guidanceRead.GET(new Request("http://local"))).status,401);
});

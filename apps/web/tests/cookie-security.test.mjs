import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const boundary = { writes: [] };
globalThis.kodmodCookieTestBoundary = boundary;
const stubs = new Map([
  ["server-only", "export {};"],
  ["next/headers", `export async function cookies() {
    return { get() { return { value: "id" }; }, set(...args) { globalThis.kodmodCookieTestBoundary.writes.push(args); } };
  }`],
  ["next/navigation", `export function redirect(url) {
    const error = new Error(url); error.name = "TestRedirect"; throw error;
  }`],
  ["next/cache", "export function revalidatePath() {}"],
  ["@/lib/session", `export const SESSION_COOKIE = "kodmod_session";
    export async function requireSession() {
      return { token: "fixture-token", user: { id: "student-1", role: "student" } };
    }`],
  ["@/lib/server-api", `export class BackendError extends Error {}
    export async function backend() {
      return { access_token: "fixture-token", expires_in: 3600,
        user: { id: "student-1", role: "student", is_active: true, preferred_language: "en" } };
    }`],
]);

// Execute the real Server Actions; only Next/backend boundaries are replaced.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (stubs.has(specifier)) {
      return {
        url: `data:text/javascript,${encodeURIComponent(stubs.get(specifier))}#${specifier}`,
        shortCircuit: true,
      };
    }
    if (specifier.startsWith("@/")) {
      return {
        url: new URL(`../src/${specifier.slice(2)}${/\.(?:mjs|ts)$/.test(specifier) ? "" : ".ts"}`, import.meta.url).href,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("file:") && url.endsWith(".ts")) {
      const { outputText } = ts.transpileModule(readFileSync(new URL(url), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      });
      return { format: "module", source: outputText, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
const { login, register } = await import("../src/app/actions.ts");
const { saveReadingSettings } = await import("../src/app/student-actions.ts");
hooks.deregister();

function serverEnvironment(t, nodeEnvironment, cookieSecure) {
  const oldNodeEnvironment = process.env.NODE_ENV;
  const oldCookieSecure = process.env.SESSION_COOKIE_SECURE;
  t.after(() => {
    if (oldNodeEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldNodeEnvironment;
    if (oldCookieSecure === undefined) delete process.env.SESSION_COOKIE_SECURE;
    else process.env.SESSION_COOKIE_SECURE = oldCookieSecure;
    boundary.writes = [];
  });
  if (nodeEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = nodeEnvironment;
  if (cookieSecure === undefined) delete process.env.SESSION_COOKIE_SECURE;
  else process.env.SESSION_COOKIE_SECURE = cookieSecure;
  boundary.writes = [];
}

function submittedForm() {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    username: "student.test", password: "fixture-password", full_name: "Siswa Uji",
    role: "student", size: "24", spacing: "1.95", contrast: "on",
  })) form.set(key, value);
  return form;
}

async function invokeAction(name, action, form) {
  if (name === "reading") {
    assert.equal((await action({}, form)).success.length > 0, true);
  } else {
    await assert.rejects(action({}, form), { name: "TestRedirect" });
  }
  assert.equal(boundary.writes.length, name === "reading" ? 1 : 2);
  const [cookieName, , options] = boundary.writes[0];
  assert.equal(cookieName, name === "reading" ? "kodmod_reading_student-1" : "kodmod_session");
  assert.equal(options.httpOnly, true);
  assert.equal(options.sameSite, "lax");
  assert.equal(options.path, name === "reading" ? "/student" : "/");
  assert.ok(options.maxAge > 0);
  if (name !== "reading") {
    const [languageCookie, language, languageOptions] = boundary.writes[1];
    assert.equal(languageCookie, "kodmod_language");
    assert.equal(language, "en", "Account language takes priority at sign-in.");
    assert.equal(languageOptions.secure, options.secure);
    assert.equal(languageOptions.sameSite, "lax");
  }
  return options;
}

const cases = [
  { label: "production default", node: "production", flag: undefined, expected: true },
  { label: "development default", node: "development", flag: undefined, expected: false },
  { label: "unset environment", node: undefined, flag: undefined, expected: false },
  { label: "local HTTP override", node: "production", flag: "false", expected: false },
  { label: "explicit HTTPS override", node: "development", flag: "true", expected: true },
  { label: "invalid flag keeps production default", node: "production", flag: "0", expected: true },
  { label: "trimmed flag", node: "production", flag: " FALSE ", expected: false },
];

for (const [name, action] of [["login", login], ["register", register], ["reading", saveReadingSettings]]) {
  for (const { label, node, flag, expected } of cases) {
    test(`${name} cookie uses server policy: ${label}`, async (t) => {
      serverEnvironment(t, node, flag);
      const options = await invokeAction(name, action, submittedForm());
      assert.equal(options.secure, expected);
    });
  }

  test(`${name} browser fields cannot override Secure cookies`, async (t) => {
    serverEnvironment(t, "production", "true");
    const form = submittedForm();
    form.set("SESSION_COOKIE_SECURE", "false");
    form.set("secure", "false");
    form.set("NODE_ENV", "development");
    const options = await invokeAction(name, action, form);
    assert.equal(options.secure, true);
  });
}

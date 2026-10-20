import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

const current = { value: { token: "admin-token", user: { role: "admin" } }, urls: [] };
globalThis.kodmodAdminSource = current;
const stubs = new Map([
  ["server-only", "export {};"],
  ["next/server", `export class NextResponse extends Response { static json(value, init) { return new NextResponse(JSON.stringify(value), { ...init, headers: { "Content-Type": "application/json" } }); } }`],
  ["@/lib/session", "export const session = async () => globalThis.kodmodAdminSource.value;"],
  ["@/lib/server-api", `export class BackendError extends Error { constructor(status,message){super(message);this.status=status;} } export const backend=async()=>({});`],
]);
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (stubs.has(specifier)) return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(stubs.get(specifier)) };
    if (specifier.startsWith("@/")) return { shortCircuit: true, url: new URL("../src/" + specifier.slice(2) + ( /\.(ts|mjs)$/.test(specifier) ? "" : ".ts"), import.meta.url).href };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith(".ts")) return { shortCircuit: true, format: "module", source: ts.transpileModule(readFileSync(new URL(url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText };
    return next(url, context);
  },
});
const route = await import("../src/app/api/admin/materials/[...path]/route.ts");
hooks.deregister();

test("admin source preview query stays authenticated and preserves PDF inline headers", async () => {
  const id = "20000000-0000-4000-8000-000000000001";
  globalThis.fetch = async url => {
    current.urls.push(url);
    return new Response("%PDF-source", { headers: { "Content-Type": "application/pdf", "Content-Disposition": "inline; filename=source.pdf" } });
  };
  const context = { params: Promise.resolve({ path: [id, "original"] }) };
  const response = await route.GET(new Request("http://localhost?preview=true"), context);
  assert.equal(response.status, 200);
  assert.match(current.urls.at(-1), new RegExp(`/admin/materials/${id}/original\\?preview=true$`));
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.match(response.headers.get("content-disposition"), /^inline/);
  current.value = null;
  assert.equal((await route.GET(new Request("http://localhost?preview=true"), context)).status, 401);
});

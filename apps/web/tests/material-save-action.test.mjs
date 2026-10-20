import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

const boundary = { current: { token: "teacher-token" }, request: null };
globalThis.kodmodMaterialSave = boundary;
const stubs = new Map([
  ["next/cache", "export const revalidatePath=()=>{};"],
  ["next/navigation", "export const redirect=()=>{};"],
  ["@/lib/session", "export const requireSession=async()=>globalThis.kodmodMaterialSave.current;"],
  ["@/lib/server-api", `export class BackendError extends Error { constructor(status,message){super(message);this.status=status;} } export const backend=async(path,token,init)=>{globalThis.kodmodMaterialSave.request={path,token,init};throw new BackendError(409,"stale revision");};`],
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
const { saveMaterial } = await import("../src/app/class-actions.ts");
hooks.deregister();

test("stale material save reports the conflict while retaining the structured draft payload", async () => {
  const form = new FormData();
  const classId = "10000000-0000-4000-8000-000000000001";
  const materialId = "20000000-0000-4000-8000-000000000001";
  const draft = { schema_version: 1, blocks: [{ id: "chem", type: "paragraph", role: "instruction", review_state: "accepted", review_origin: "teacher", provenance: { method: "teacher", extractor_version: "document-v1", edited: true }, inlines: [{ text: "CO" }, { text: "2", marks: ["subscript"] }] }] };
  form.set("document", JSON.stringify(draft));
  form.set("expected_version", "4");
  form.set("title", "Kimia dasar");
  form.set("published", "yes");
  boundary.request = null;
  const result = await saveMaterial(classId, materialId, {}, form);
  assert.match(result.error, /Draft Anda tetap ada/);
  assert.equal(boundary.request.path, `/classes/${classId}/materials/${materialId}`);
  assert.equal(boundary.request.token, "teacher-token");
  assert.equal(boundary.request.init.method, "PUT");
  const payload = JSON.parse(boundary.request.init.body);
  assert.equal(payload.expected_version, 4);
  assert.deepEqual(payload.document, draft);
});

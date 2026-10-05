import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

const boundary = { state: null, refreshes: 0, events: [] };
globalThis.kodmodLanguageTest = boundary;
globalThis.window = new EventTarget();
globalThis.document = { documentElement: { lang: "id" } };
window.addEventListener("kodmod:language-change", event => boundary.events.push(event.detail));
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "react") return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(`
      export const createContext = () => ({ Provider: "language-context" });
      export const useCallback = fn => fn;
      export const useMemo = fn => fn();
      export const useContext = () => null;
      export const useState = initial => [globalThis.kodmodLanguageTest.state ?? initial, value => { globalThis.kodmodLanguageTest.state = value; }];`) };
    // Keep JSX within the same stub boundary; the real runtime requires CommonJS React.
    if (specifier === "react/jsx-runtime") return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(`export const jsx = (type, props) => ({ type, props });`) };
    if (specifier === "next/navigation") return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(`export const useRouter = () => ({ refresh: () => globalThis.kodmodLanguageTest.refreshes++ });`) };
    if (specifier.startsWith("@/")) return { shortCircuit: true, url: new URL("../src/" + specifier.slice(2), import.meta.url).href };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith(".tsx")) return { shortCircuit: true, format: "module", source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText };
    return next(url, context);
  },
});
const { LanguageProvider } = await import("../src/components/language-provider.tsx");
hooks.deregister();

test("only a saved, different language emits its target for narration", async () => {
  const calls = [];
  globalThis.fetch = async (path, options) => { calls.push([path, JSON.parse(options.body)]); return { ok: true }; };
  const context = LanguageProvider({ initialLanguage: "id", children: null }).props.value;
  await context.changeLanguage("id");
  assert.deepEqual(boundary.events, []);
  await context.changeLanguage("en");
  assert.deepEqual(boundary.events, [{ language: "en" }]);
  assert.equal(document.documentElement.lang, "en");
  assert.deepEqual(boundary.state, { source: "id", value: "en" });
  assert.deepEqual(calls[1], ["/api/preferences/language", { language: "en" }]);
  const english = LanguageProvider({ initialLanguage: "id", children: null }).props.value;
  assert.equal(english.language, "en");
  assert.equal(english.t("Masuk"), "Sign in");
  globalThis.fetch = async () => ({ ok: false });
  await assert.rejects(english.changeLanguage("id"));
  assert.equal(boundary.events.length, 1, "a failed language update must never be announced");
  assert.equal(document.documentElement.lang, "en");
});

import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { JSDOM } from "jsdom";

test("language follows saved cookies across login, logout, restored pages and other tabs", async () => {
  const dom = new JSDOM("<!doctype html><html lang='id'><body><div id='root'></div></body></html>", { url: "https://kodmod.test" });
  const descriptors = new Map();
  for (const key of ["window", "document", "navigator", "Event", "CustomEvent", "localStorage"]) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
  }
  const previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const previousFetch = globalThis.fetch;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const boundary = { refreshes: 0, events: [], context: null };
  boundary.router = { refresh: () => boundary.refreshes++ };
  globalThis.kodmodLanguageTest = boundary;
  window.addEventListener("kodmod:language-change", event => boundary.events.push(event.detail));
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (specifier === "next/navigation") return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent("export const useRouter = () => globalThis.kodmodLanguageTest.router;") };
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
  const { createElement, act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { LanguageProvider, useI18n } = await import("../src/components/language-provider.tsx");
  const root = createRoot(document.getElementById("root"));
  function Consumer() { boundary.context = useI18n(); return createElement("span", null, boundary.context.t("Masuk")); }
  const render = language => root.render(createElement(LanguageProvider, { initialLanguage: language }, createElement(Consumer)));
  try {
    globalThis.fetch = async (_path, options) => {
      document.cookie = `kodmod_language=${JSON.parse(options.body).language}; Path=/; Secure`;
      return { ok: true };
    };
    await act(async () => render("id"));
    await act(async () => boundary.context.changeLanguage("id"));
    assert.deepEqual(boundary.events, []);
    await act(async () => boundary.context.changeLanguage("en"));
    assert.equal(boundary.context.language, "en");
    assert.equal(document.documentElement.lang, "en");
    assert.equal(document.querySelector("span").textContent, "Sign in");
    assert.deepEqual(boundary.events, [{ language: "en" }]);
    // The persistent root layout may still have its old server prop while
    // the authentication action has already updated the shared cookie.
    document.cookie = "kodmod_language=id; Path=/; Secure";
    await act(async () => render("en"));
    assert.equal(boundary.context.language, "id");
    assert.equal(document.documentElement.lang, "id");
    await act(async () => render("id"));
    assert.equal(boundary.context.language, "id", "logout preserves the same browser choice");
    for (const event of ["storage", "pageshow", "focus"]) {
      document.cookie = "kodmod_language=en; Path=/; Secure";
      await act(async () => window.dispatchEvent(new Event(event)));
      assert.equal(boundary.context.language, "en", event);
      document.cookie = "kodmod_language=id; Path=/; Secure";
      await act(async () => window.dispatchEvent(new Event(event)));
      assert.equal(boundary.context.language, "id", event);
    }
    globalThis.fetch = async () => ({ ok: false });
    await assert.rejects(boundary.context.changeLanguage("en"));
    assert.equal(boundary.context.language, "id");
    assert.equal(boundary.events.length, 1, "failed writes cannot announce a language change");
    assert.ok(boundary.refreshes >= 2, "server-rendered copy must refresh with the cookie");
  } finally {
    await act(async () => root.unmount());
    hooks.deregister(); dom.window.close();
    globalThis.fetch = previousFetch;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct;
    delete globalThis.kodmodLanguageTest;
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});

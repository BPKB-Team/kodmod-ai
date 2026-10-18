import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";
import { JSDOM } from "jsdom";

test("first visit shows voice setup; saved users can enable optional swipe navigation", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost", pretendToBeVisual: true });
  const descriptors = new Map();
  for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLFormElement", "HTMLInputElement", "Element", "Node", "MutationObserver", "CustomEvent", "Event", "KeyboardEvent", "localStorage", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"]) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value: ["getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"].includes(key) ? dom.window[key].bind(dom.window) : dom.window[key], configurable: true, writable: true });
  }
  const previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  dom.window.HTMLElement.prototype.getClientRects = function () { return this.closest("dialog:not([open])") ? [] : [{}]; };
  const idle = Object.freeze({ owner: "", status: "idle", message: "" });
  globalThis.kodmodVoiceTest = { idle, plays: [], queued: [] };
  const stubs = new Map([
    ["next/navigation", "export const usePathname = () => '/';"],
    ["@/lib/browser-speech", "export const speechOutput = { subscribe: () => () => {}, getState: () => globalThis.kodmodVoiceTest.idle, play: async request => { globalThis.kodmodVoiceTest.plays.push(request); }, stop() {}, queueMenu(request) { globalThis.kodmodVoiceTest.queued.push(request); }, cancelQueuedMenu() {} };"],
    ["@/lib/speech-audio-cache", "export async function pruneExpiredSpeechAudioCache() {}"],
    ["./language-provider", "export const useI18n = () => ({language: 'id', t: value => value, changeLanguage: async () => {}});"],
    ["@/components/language-provider", "export const useI18n = () => ({language: 'id', t: value => value});"],
  ]);
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (stubs.has(specifier)) return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(stubs.get(specifier)) };
      if (context.parentURL?.startsWith("data:") && specifier === "react") return { shortCircuit: true, url: import.meta.resolve("react") };
      let url;
      if (specifier.startsWith("@/")) url = new URL("../src/" + specifier.slice(2), import.meta.url);
      else if (specifier.startsWith(".") && context.parentURL?.endsWith(".tsx")) url = new URL(specifier, context.parentURL);
      if (url) for (const suffix of ["", ".ts", ".tsx"]) { const candidate = new URL(url.href + suffix); if (existsSync(candidate)) return { shortCircuit: true, url: candidate.href }; }
      return next(specifier, context);
    },
    load(url, context, next) {
      if (/\.tsx?$/.test(url)) return { shortCircuit: true, format: "module", source: ts.transpileModule(readFileSync(new URL(url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText };
      return next(url, context);
    },
  });
  const { createElement, act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { VoicePreferencesProvider, useVoicePreferences } = await import("../src/components/voice-preferences-provider.tsx");
  const { writeVoiceSettings, DEFAULT_VOICE_SETTINGS } = await import("../src/lib/speech-preferences.mjs");
  const root = createRoot(document.getElementById("root"));
  function Controls() {
    const { openVoicePreferences } = useVoicePreferences();
    return createElement("section", { id: "navigation" },
      createElement("button", { id: "first", onClick: openVoicePreferences }, "Pengaturan suara"),
      createElement("button", { id: "second" }, "Materi"),
      createElement("input", { id: "answer", "aria-label": "Jawaban" }),
    );
  }
  const swipe = async (target, dx) => act(async () => {
    for (const [type, property, x] of [["touchstart", "touches", 150], ["touchend", "changedTouches", 150 + dx]]) {
      const event = new Event(type, { bubbles: true });
      Object.defineProperty(event, property, { value: [{ clientX: x, clientY: 100 }] });
      target.dispatchEvent(event);
    }
  });
  try {
    await act(async () => root.render(createElement(VoicePreferencesProvider, null, createElement(Controls))));
    const dialog = document.querySelector("dialog");
    assert.equal(dialog.open, true, "New visitors must see the adjustment menu");
    assert.equal(document.querySelector('input[value="app"]').checked, true);
    assert.ok(globalThis.kodmodVoiceTest.plays.some(request => request.menuKey === "voice-settings"), "The settings popup must announce its purpose");
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
      document.querySelector("#tutor-reader").focus();
    });
    assert.equal(globalThis.kodmodVoiceTest.queued.at(-1)?.menuKey, "tutor-reader-on", "Menu narration must remain enabled inside voice settings");
    await act(async () => document.querySelector(".voice-preferences-actions button").click());
    assert.equal(dialog.open, false);
    await act(async () => root.render(createElement(VoicePreferencesProvider, { key: "returning" }, createElement(Controls))));
    assert.equal(document.querySelector("dialog").open, false, "Saved visitors must not repeat setup");
    const first = document.getElementById("first"), second = document.getElementById("second"), input = document.getElementById("answer");
    first.focus();
    await swipe(first, -100);
    assert.equal(document.activeElement, first, "Swiping is disabled by default");
    await act(async () => { writeVoiceSettings({ ...DEFAULT_VOICE_SETTINGS, guidedNavigation: true }); });
    await swipe(first, -100);
    assert.equal(document.activeElement, second, "Enabled swiping advances between menu controls");
    await swipe(second, 100);
    assert.equal(document.activeElement, first);
    input.focus();
    await swipe(input, 100);
    assert.equal(document.activeElement, input, "Editing an answer must retain native gestures");
    await act(async () => first.click());
    assert.ok(document.querySelector('[role="switch"]#voice-guided'), "Users can choose guided navigation in settings");
  } catch (error) {
    if (error instanceof AggregateError) throw new Error(error.errors.map(item => item.stack || item.message).join("\n"), { cause: error });
    throw error;
  } finally {
    await act(async () => root.unmount());
    hooks.deregister(); dom.window.close();
    for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    if (previousAct === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT; else globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct;
    delete globalThis.kodmodVoiceTest;
  }
});

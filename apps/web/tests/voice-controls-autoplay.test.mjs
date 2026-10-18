import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import ts from "typescript";
import { createSpeechCoordinator } from "../src/lib/speech-output.mjs";

test("question autoplay survives StrictMode cleanup and pauses while voice settings are open", async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true });
  const previous = new Map(["window", "document", "HTMLElement", "IS_REACT_ACT_ENVIRONMENT"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of ["window", "document", "HTMLElement"]) Object.defineProperty(globalThis, key, { value: key === "window" ? dom.window : dom.window[key], configurable: true });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const React = (await import("react")).default;
  const { createRoot } = await import("react-dom/client");
  const played = [];
  const speech = createSpeechCoordinator({ loadAudio: async request => request.text,
    makeAudio: text => ({ play: async () => played.push(text), pause() {}, resume() {}, stop() {}, dispose() {} }), speakDevice() {} });
  const preferences = { engine: "app", tutorEnabled: true, settingsOpen: false, openVoicePreferences() {} };
  const icon = () => null;
  const mocks = {
    "./loading-feedback": { LoadingStatus: icon }, "./ui/spinner": { Spinner: icon },
    "lucide-react": { Headphones: icon, Mic: icon, Pause: icon, Play: icon, Settings2: icon, Square: icon },
    "@/lib/browser-speech": { speechOutput: speech },
    "./voice-preferences-provider": { useVoicePreferences: () => preferences },
    "./language-provider": { useI18n: () => ({ language: "id", t: text => text }) },
  };
  const compiled = ts.transpileModule(readFileSync(new URL("../src/components/voice-controls.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const compiledModule = { exports: {} }, require = createRequire(import.meta.url);
  new Function("require", "module", "exports", compiled)(id => mocks[id] ?? require(id), compiledModule, compiledModule.exports);
  const root = createRoot(document.getElementById("root"));
  const render = () => React.createElement(React.StrictMode, null, React.createElement(compiledModule.exports.VoiceControls, { text: "Soal satu. Pilihan A: satu per empat.", autoPlayKey: "q1" }));
  try {
    await React.act(async () => root.render(render()));
    assert.equal(speech.getState().status, "playing", "StrictMode must not permanently cancel the first question");
    assert.equal(played.length, 1);
    preferences.settingsOpen = true;
    await React.act(async () => root.render(render()));
    assert.equal(speech.getState().status, "idle", "Tutor audio must not run behind voice settings");
    preferences.settingsOpen = false;
    await React.act(async () => root.render(render()));
    assert.equal(speech.getState().status, "playing");
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
});

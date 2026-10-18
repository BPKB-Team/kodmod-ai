import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { attachMenuNarration, announceLanguageChange, announcePageNavigation } from "../src/lib/menu-narration.mjs";
import { createSpeechCoordinator } from "../src/lib/speech-output.mjs";

function fixture() {
  const listeners = new Map(), queued = [], played = [];
  const document = { querySelector: () => null,
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name) { listeners.delete(name); } };
  const speech = { getState: () => ({ owner: null, status: "idle" }),
    queueMenu: (...args) => queued.push(args), cancelQueuedMenu() { queued.length = 0; },
    stop() { queued.length = 0; }, play: async request => played.push(request) };
  const element = { dataset: { voiceMenu: "login" }, textContent: "Masuk", labels: null,
    getAttribute: () => null, matches: () => false,
    closest(selector) { return selector.includes("data-voice-ignore") || selector.includes("data-voice-managed") ? null : this; },
    contains(node) { return node === this || node?.parent === this; } };
  const child = { parent: element, closest: () => element };
  const detach = attachMenuNarration({ document, speech, language: "en", engine: "app", pathname: "/" });
  return { document, speech, element, child, queued, played, listeners, detach,
    emit(name, target = element, rest = {}) { listeners.get(name)?.({ type: name, target, ...rest }); } };
}

test("hover reads once inside a menu and leaving before playback cancels it", () => {
  const f = fixture();
  f.emit("pointerover");
  assert.equal(f.queued.length, 1);
  assert.equal(f.queued[0][0].menuKey, "login");
  assert.equal(f.queued[0][0].language, "en");
  assert.equal(f.queued[0][2], 300);
  f.emit("pointerover", f.child, { relatedTarget: f.element });
  f.emit("pointerout", f.child, { relatedTarget: f.element });
  assert.equal(f.queued.length, 1, "child transitions must not cancel or repeat the label");
  f.emit("pointerout", f.element, { relatedTarget: null });
  assert.equal(f.queued.length, 0);
  f.emit("pointerover");
  assert.equal(f.queued.length, 1, "a cancelled hover can be read on return");
  f.detach();
  assert.equal(f.listeners.size, 0);
});

test("focus and click share a label while touch hover, disabled and modal controls are excluded", () => {
  const f = fixture();
  f.emit("pointerover", f.element, { pointerType: "touch" });
  assert.equal(f.queued.length, 0);
  f.emit("focusin"); f.emit("click");
  assert.equal(f.queued.length, 1);
  assert.equal(f.queued[0][2], 150);
  f.element.matches = () => true;
  f.emit("focusin");
  assert.equal(f.queued.length, 0);
});

test("pointer movement cannot cancel speech queued by keyboard focus or selection", () => {
  const f = fixture();
  f.emit("focusin");
  f.emit("pointerout", f.element, { relatedTarget: null });
  assert.equal(f.queued.length, 1);
  f.detach();
});

test("hovering empty space cannot cancel a deliberate control announcement", () => {
  const f = fixture();
  f.emit("focusin");
  f.emit("pointerover", { closest: () => null });
  assert.equal(f.queued.length, 1);
  f.detach();
});

test("recording and Tutor activity block narration both at hover and delayed playback", () => {
  const f = fixture();
  f.speech.getState = () => ({ owner: "tutor", status: "paused" });
  f.emit("pointerover");
  assert.equal(f.queued.length, 0);
  f.speech.getState = () => ({ owner: null, status: "idle" });
  f.emit("pointerover");
  f.document.querySelector = () => ({});
  assert.equal(f.queued[0][1](), false);
  f.emit("focusin");
  assert.equal(f.queued.length, 0);
});

test("a free-form field never narrates its value and guests cannot synthesise arbitrary labels", () => {
  const f = fixture();
  f.element.dataset = {};
  f.element.value = "private-password";
  f.element.labels = [{ textContent: "Kata sandi" }];
  f.element.textContent = "";
  f.element.getAttribute = name => name === "name" ? "password" : null;
  f.emit("focusin");
  assert.equal(f.queued[0][0].text, "Kata sandi");
  assert.equal(f.queued[0][0].menuKey, "password");
  f.element.getAttribute = () => null;
  f.emit("pointerout", f.element); f.emit("focusin");
  assert.equal(f.queued.length, 0);
});

test("successful language change uses target language and a shared key; OFF and recording stay silent", async () => {
  const f = fixture();
  await announceLanguageChange(f.speech, "en", { engine: "app", enabled: true });
  await announceLanguageChange(f.speech, "id", { engine: "device", enabled: true });
  assert.deepEqual(f.played.map(request => [request.language, request.menuKey, request.text]), [
    ["en", "language-changed", "Language changed to English."],
    ["id", "language-changed", "Bahasa telah berubah ke Bahasa Indonesia."],
  ]);
  await announceLanguageChange(f.speech, "en", { engine: "app", enabled: false });
  await announceLanguageChange(f.speech, "en", { engine: "app", enabled: true, recording: true });
  assert.equal(f.played.length, 2);
});

test("language confirmation cancels old queued hover before the new-language audio plays", async () => {
  const requests = [];
  const speech = createSpeechCoordinator({ loadAudio: async request => { requests.push(request); return "mp3"; },
    makeAudio: () => ({ play: async () => {}, stop() {}, dispose() {} }), speakDevice() {} });
  speech.queueMenu({ text: "Menu lama", language: "id", engine: "app" }, () => true, 5);
  await announceLanguageChange(speech, "en", { engine: "app", enabled: true });
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].language, "en");
  speech.stop();
});

test("dialog announcement dispatched on window reaches menu narration", () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const played = [];
  const speech = {
    getState: () => ({ owner: null, status: "idle" }),
    queueMenu() {},
    cancelQueuedMenu() {},
    stop() {},
    play(request) { played.push(request); },
  };
  const detach = attachMenuNarration({ document: dom.window.document, speech, language: "id", engine: "app", pathname: "/" });
  dom.window.dispatchEvent(new dom.window.CustomEvent("kodmod:dialog-announce", {
    detail: { text: "Yakin ingin keluar?" },
  }));
  assert.deepEqual(played.map(request => request.text), ["Yakin ingin keluar?"]);
  detach();
  dom.window.close();
});

test("clicking a custom option does not replace its selected confirmation", () => {
  const f = fixture();
  f.element.matches = selector => selector === "[role=option]";
  f.emit("click");
  assert.equal(f.queued.length, 0);
  f.detach();
});

test("student page changes focus and announce the new page heading", () => {
  const dom = new JSDOM("<!doctype html><main><h1>Progres belajar</h1></main>", { pretendToBeVisual: true });
  const played = [];
  const heading = dom.window.document.querySelector("h1");
  announcePageNavigation({
    document: dom.window.document,
    speech: { play: request => played.push(request) },
    language: "id",
    engine: "app",
    enabled: true,
    previousPathname: "/siswa/tutor",
    pathname: "/siswa/progres",
  });
  assert.equal(heading.getAttribute("tabindex"), "-1");
  assert.equal(dom.window.document.activeElement, heading);
  assert.deepEqual(played.map(request => request.text), ["Progres belajar"]);
  dom.window.close();
});

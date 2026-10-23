import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";
import { JSDOM } from "jsdom";

test("profile menu supports keyboard selection, Escape, and cancellation focus", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost", pretendToBeVisual: true });
  const descriptors = new Map();
  for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "MutationObserver", "CustomEvent", "Event", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"]) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value: typeof dom.window[key] === "function" && ["getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"].includes(key) ? dom.window[key].bind(dom.window) : dom.window[key], configurable: true, writable: true });
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const boundary = { confirmations: 0, logouts: 0, stops: 0 };
  globalThis.kodmodProfileBoundary = boundary;
  const stubs = new Map([
    ["next/link", `import {createElement} from 'react'; export default function Link(props) { return createElement('a', props); }`],
    ["@/app/actions", "export async function logout() { globalThis.kodmodProfileBoundary.logouts++; }"],
    ["@/lib/dialogs", "export async function confirmAction() { globalThis.kodmodProfileBoundary.confirmations++; return false; }"],
    ["@/lib/browser-speech", "export const speechOutput = {stop() { globalThis.kodmodProfileBoundary.stops++; }};"],
  ]);
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (stubs.has(specifier)) return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(stubs.get(specifier)) };
      if (specifier === "./language-provider") return { shortCircuit: true, url: "data:text/javascript,export const useI18n = () => ({t: value => value});" };
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
  const { UserProfileDropdown } = await import("../src/components/user-profile-dropdown.tsx");
  const root = createRoot(document.getElementById("root"));
  const tick = () => new Promise(resolve => setTimeout(resolve, 40));
  const key = async (target, value) => act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true })); await tick(); });
  try {
    await act(async () => { root.render(createElement(UserProfileDropdown, { user: { full_name: "Siswa Test", username: "test" }, roleLabel: "Siswa" })); });
    const trigger = document.querySelector("button");
    trigger.focus();
    await key(trigger, "ArrowDown");
    assert.equal(trigger.getAttribute("aria-expanded"), "true");
    assert.equal(document.activeElement.getAttribute("href"), "/student/progress");
    await key(document.activeElement, "Escape");
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.equal(document.activeElement, trigger);
    await key(trigger, "ArrowDown");
    await key(document.activeElement, "End");
    assert.match(document.activeElement.textContent, /Keluar dari akun/);
    await key(document.activeElement, "Enter");
    assert.equal(boundary.confirmations, 1);
    assert.equal(boundary.logouts, 0, "Cancelling confirmation must not log out");
    assert.equal(boundary.stops, 1);
    assert.equal(document.activeElement, trigger, "Focus returns to the trigger after cancellation");
  } finally {
    await act(async () => root.unmount()); hooks.deregister(); dom.window.close();
    for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    delete globalThis.kodmodProfileBoundary; delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
});

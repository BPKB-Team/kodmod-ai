import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";
import { JSDOM } from "jsdom";

for (const approved of [false, true]) {
  test(`active-session confirmation ${approved ? "replaces the old session" : "keeps the old session"}`, async () => {
    const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
      url: "http://localhost/login",
      pretendToBeVisual: true,
    });
    const descriptors = new Map();
    for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLFormElement", "HTMLInputElement", "Element", "Node", "Event", "CustomEvent", "requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle"]) {
      descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, {
        value: ["requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle"].includes(key)
          ? dom.window[key].bind(dom.window)
          : dom.window[key],
        configurable: true,
        writable: true,
      });
    }
    const previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const boundary = { confirmations: [], speech: [], submissions: [] };
    globalThis.kodmodLoginBoundary = boundary;
    const translate = (value) => ({
      "Akun ini sedang aktif di perangkat lain. Jika masuk di sini, sesi pada perangkat tersebut akan diakhiri.": "This account is active on another device. Signing in here ends that session.",
      "Jika ini bukan Anda, batalkan dan hubungi administrator.": "If this was not you, cancel and contact an administrator.",
      "Akun aktif di perangkat lain": "Account active on another device",
      "Keluar dari perangkat lain dan masuk di sini": "Sign out the other device and sign in here",
    })[value] ?? value;
    const stubs = new Map([
      ["next/link", `import { createElement } from "react"; export default function Link(props) { return createElement("a", props); }`],
      ["lucide-react", `import { createElement } from "react"; const Icon = () => createElement("span"); export const ArrowLeft=Icon, ArrowRight=Icon, Eye=Icon, EyeOff=Icon;`],
      ["@/components/ui/input", `import { createElement } from "react"; export function Input(props) { return createElement("input", props); }`],
      ["@/components/ui/native-select", `export function NativeSelect() { return null; }`],
      ["./ui/button", `import { createElement } from "react"; export function Button({loading, loadingText, ...props}) { return createElement("button", props); }`],
      ["@/app/actions", `export async function login() {} export async function saveUser() {} export async function toggleUser() {}`],
      ["./action-feedback", `import { createElement, useState } from "react"; export function ActionFeedback() { return null; } export function useConfirmedAction() { const [state] = useState({activeSession:{sessionId:"session-on-other-device",challengeVersion:"challenge-1",changed:false}}); return [state, async () => ({}), false]; }`],
      ["@/components/language-provider", `import { createElement } from "react"; export const useI18n = () => ({language:"en",t:globalThis.kodmodLoginBoundary.translate}); export function UiText({children}) { return createElement("span", null, children); }`],
      ["./language-provider", `import { createElement } from "react"; export const useI18n = () => ({language:"en",t:globalThis.kodmodLoginBoundary.translate}); export function UiText({children}) { return createElement("span", null, children); }`],
      ["@/lib/dialogs", `export function confirmAction(options) { const boundary=globalThis.kodmodLoginBoundary; boundary.confirmations.push(options); return new Promise(resolve => { boundary.resolveConfirmation=resolve; }); }`],
      ["@/lib/browser-speech", `export const speechOutput = {play: async request => { globalThis.kodmodLoginBoundary.speech.push(request); }};`],
    ]);
    boundary.translate = translate;
    dom.window.HTMLFormElement.prototype.requestSubmit = function () {
      boundary.submissions.push(new dom.window.FormData(this).get("replace_session_id"));
    };
    const hooks = registerHooks({
      resolve(specifier, context, next) {
        if (stubs.has(specifier)) return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(stubs.get(specifier)) };
        if (context.parentURL?.startsWith("data:") && specifier === "react") return { shortCircuit: true, url: import.meta.resolve("react") };
        let url;
        if (specifier.startsWith("@/")) url = new URL("../src/" + specifier.slice(2), import.meta.url);
        else if (specifier.startsWith(".") && context.parentURL?.endsWith(".tsx")) url = new URL(specifier, context.parentURL);
        if (url) for (const suffix of ["", ".ts", ".tsx"]) {
          const candidate = new URL(url.href + suffix);
          if (existsSync(candidate)) return { shortCircuit: true, url: candidate.href };
        }
        return next(specifier, context);
      },
      load(url, context, next) {
        if (/\.tsx?$/.test(url)) return {
          shortCircuit: true,
          format: "module",
          source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
            compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
          }).outputText,
        };
        return next(url, context);
      },
    });
    const { createElement, act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { LoginForm } = await import("../src/components/forms.tsx");
    const root = createRoot(document.getElementById("root"));
    try {
      await act(async () => root.render(createElement(LoginForm)));
      assert.equal(boundary.confirmations.length, 1, "An active session must prompt before replacement.");
      assert.equal(boundary.confirmations[0].title, "Akun aktif di perangkat lain");
      assert.equal(boundary.speech[0].language, "en", "The spoken warning must follow the selected interface language.");
      assert.match(boundary.speech[0].text, /another device/);

      await act(async () => {
        boundary.resolveConfirmation(approved);
        await new Promise(resolve => setTimeout(resolve, 30));
      });
      assert.equal(boundary.submissions.length, approved ? 1 : 0);
      if (approved) assert.equal(boundary.submissions[0], "session-on-other-device");
      assert.equal(boundary.confirmations.length, 1, "Rerendering must not reopen the same prompt.");
    } finally {
      await act(async () => root.unmount());
      hooks.deregister();
      dom.window.close();
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
      if (previousAct === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
      else globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct;
      delete globalThis.kodmodLoginBoundary;
    }
  });
}

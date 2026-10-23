import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { JSDOM } from "jsdom";

test("mobile learning menu exposes its controlled navigation and closes after a destination is chosen", async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true });
  const previous = new Map(["window", "document", "HTMLElement", "IS_REACT_ACT_ENVIRONMENT"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of ["window", "document", "HTMLElement"]) Object.defineProperty(globalThis, key, { value: key === "window" ? dom.window : dom.window[key], configurable: true });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const React = (await import("react")).default;
  const { createRoot } = await import("react-dom/client");
  const icon = () => null;
  let speechStopCalls = 0;
  const mocks = {
    "next/link": { __esModule: true, default: ({ children, ...props }) => React.createElement("a", { ...props, href: "#" }, children) },
    "next/navigation": { usePathname: () => "/student" },
    "./language-provider": { useI18n: () => ({ t: text => text }) },
    "./logout-button": { LogoutButton: () => React.createElement("button", null, "Keluar") },
    "@/lib/browser-speech": { speechOutput: { stop: () => { speechStopCalls += 1; } } },
    "lucide-react": new Proxy({}, { get: () => icon }),
  };
  const source = readFileSync(new URL("../src/components/learning-nav.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const compiledModule = { exports: {} }, require = createRequire(import.meta.url);
  new Function("require", "module", "exports", compiled)(id => mocks[id] ?? require(id), compiledModule, compiledModule.exports);
  const root = createRoot(document.getElementById("root"));
  try {
    await React.act(async () => root.render(React.createElement(compiledModule.exports.LearningNav, { base: "/student" })));
    const toggle = document.querySelector(".learning-nav-toggle");
    const nav = document.getElementById(toggle.getAttribute("aria-controls"));
    assert.equal(nav.getAttribute("aria-label"), "Menu ruang belajar");
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    await React.act(async () => toggle.click());
    assert.equal(toggle.getAttribute("aria-expanded"), "true");
    await React.act(async () => [...nav.querySelectorAll("a")].find(link => link.textContent === "Materi").click());
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    assert.equal(speechStopCalls, 1);
  } finally {
    await React.act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
});

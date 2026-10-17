import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import ts from "typescript";
import { attachMenuNarration } from "../src/lib/menu-narration.mjs";

const require = createRequire(import.meta.url);
const componentPath = new URL("../src/components/ui/native-select.tsx", import.meta.url);

function loadNativeSelect(React, { voiceQueue, menuEnabled = false }) {
  const source = readFileSync(componentPath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: componentPath.pathname,
  }).outputText;
  const componentModule = { exports: {} };
  const icon = () => React.createElement("span", { "aria-hidden": "true" });
  const mocks = {
    "lucide-react": { ChevronDown: icon, Check: icon },
    "@/lib/utils": { cn: (...parts) => parts.filter(Boolean).join(" ") },
    "@/lib/browser-speech": { speechOutput: {
      queueMenu(request) { voiceQueue.push(request); }, cancelQueuedMenu() {},
    } },
    "@/components/voice-preferences-provider": { useVoicePreferences: () => ({ menuEnabled, engine: menuEnabled ? "app" : "off" }) },
    "@/components/language-provider": { useI18n: () => ({ language: "id" }) },
  };
  const moduleRequire = id => mocks[id] ?? require(id);
  new Function("require", "module", "exports", compiled)(moduleRequire, componentModule, componentModule.exports);
  return componentModule.exports.NativeSelect;
}

async function renderSelect({ menuEnabled = false } = {}) {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { pretendToBeVisual: true });
  const globals = ["window", "document", "HTMLElement", "HTMLSelectElement", "Node", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = new Map(globals.map(name => [name, globalThis[name]]));
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.HTMLSelectElement = dom.window.HTMLSelectElement;
  globalThis.Node = dom.window.Node;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  const React = (await import("react")).default;
  const { createRoot } = await import("react-dom/client");
  const voiceQueue = [];
  const NativeSelect = loadNativeSelect(React, { voiceQueue, menuEnabled });
  const root = createRoot(dom.window.document.getElementById("root"));
  await React.act(async () => {
    root.render(React.createElement("label", null,
      React.createElement("span", null, "Mata pelajaran"),
      React.createElement(NativeSelect, { value: "math", onChange() {} },
        React.createElement("option", { value: "", disabled: true }, "Pilih mata pelajaran"),
        React.createElement("option", { value: "math" }, "Matematika"),
        React.createElement("option", { value: "science" }, "IPA"),
      ),
    ));
  });
  return {
    dom,
    React,
    root,
    trigger: dom.window.document.querySelector('[role="combobox"]'),
    voiceQueue,
    async cleanup() {
      await React.act(async () => root.unmount());
      dom.window.close();
      for (const [name, value] of previous) {
        if (value === undefined) delete globalThis[name];
        else globalThis[name] = value;
      }
    },
  };
}

test("custom select exposes the surrounding field label to assistive technology", async () => {
  const view = await renderSelect();
  try {
    assert.equal(view.trigger.getAttribute("aria-label"), "Mata pelajaran");
  } finally {
    await view.cleanup();
  }
});

test("keyboard navigation exposes the active option to screen readers", async () => {
  const view = await renderSelect();
  try {
    await view.React.act(async () => {
      view.trigger.dispatchEvent(new view.dom.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    await view.React.act(async () => {
      view.trigger.dispatchEvent(new view.dom.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    const activeId = view.trigger.getAttribute("aria-activedescendant");
    assert.ok(activeId, "the combobox must identify its active option");
    assert.equal(view.dom.window.document.getElementById(activeId)?.textContent.trim(), "IPA");
  } finally {
    await view.cleanup();
  }
});

test("selecting an option speaks its selection confirmation once", async () => {
  const view = await renderSelect({ menuEnabled: true });
  const speech = {
    getState: () => ({ owner: null, status: "idle" }),
    queueMenu(request) { view.voiceQueue.push(request); },
    cancelQueuedMenu() {},
    stop() {},
    play() {},
  };
  const detach = attachMenuNarration({
    document: view.dom.window.document,
    speech,
    language: "id",
    engine: "app",
    pathname: "/siswa/latihan",
  });
  try {
    await view.React.act(async () => view.trigger.click());
    view.voiceQueue.length = 0;
    const option = view.dom.window.document.querySelector('[role="option"][aria-disabled="false"]');
    await view.React.act(async () => option.click());
    assert.deepEqual(view.voiceQueue.map(request => request.text), ["Matematika dipilih."]);
  } finally {
    detach();
    await view.cleanup();
  }
});

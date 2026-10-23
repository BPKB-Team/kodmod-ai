import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { JSDOM } from "jsdom";
import ts from "typescript";
import { translate } from "../src/lib/i18n.mjs";
import { formatHtmlMath } from "../src/lib/format-math.mjs";

const require = createRequire(import.meta.url);
const components = fileURLToPath(new URL("../src/components/", import.meta.url));

function loadComponents(language = "id", overrides = {}) {
  const cache = new Map();
  const context = { language, t: value => translate(value, language) };
  const i18n = { useI18n: () => context, UiText: ({ children }) => translate(children, language) };
  const mocks = {
    "./language-provider": i18n,
    "@/components/language-provider": i18n,
    "@/lib/utils": { cn: (...parts) => parts.filter(Boolean).join(" ") },
    "@/lib/format-math.mjs": { formatHtmlMath },
    "@/lib/dialogs": { confirmAction: async () => true, notifyResult: async () => {} },
    "@/lib/browser-speech": { speechOutput: { play: async () => {}, stop: () => {}, getState: () => ({ status: "idle" }), subscribe: () => () => {} } },
    ...overrides,
  };
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    const source = readFileSync(path, "utf8");
    const compiled = ts.transpileModule(source, { fileName: path, compilerOptions: {
      esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    } }).outputText;
    const componentModule = { exports: {} };
    const moduleRequire = id => {
      if (id.endsWith(".css")) return {};
      if (mocks[id]) return mocks[id];
      if (id.startsWith("@/components/")) return load(resolve(components, `${id.slice(13)}.tsx`));
      if (id.startsWith("@/lib/")) {
        const library = fileURLToPath(new URL("../src/lib/", import.meta.url));
        return load(resolve(library, `${id.slice(6)}.ts`));
      }
      if (id.startsWith(".")) return load(resolve(dirname(path), `${id}.tsx`));
      return require(id);
    };
    new Function("require", "module", "exports", compiled)(moduleRequire, componentModule, componentModule.exports);
    cache.set(path, componentModule.exports);
    return componentModule.exports;
  }
  return name => load(resolve(components, `${name}.tsx`));
}

async function mount(render) {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { pretendToBeVisual: true });
  const names = ["window", "document", "HTMLElement", "Node", "IS_REACT_ACT_ENVIRONMENT", "fetch", "requestAnimationFrame"];
  const previous = new Map(names.map(name => [name, globalThis[name]]));
  for (const name of names.slice(0, 4)) globalThis[name] = dom.window[name];
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  const React = (await import("react")).default;
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root"));
  await React.act(async () => root.render(render(React)));
  return {
    React, root, dom, document: dom.window.document,
    async update(render) { await React.act(async () => root.render(render(React))); },
    async cleanup() {
      await React.act(async () => root.unmount());
      dom.window.close();
      for (const [name, value] of previous) {
        if (value === undefined) delete globalThis[name]; else globalThis[name] = value;
      }
    },
  };
}

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const response = (body, ok = true) => ({ ok, json: async () => body });

test("loading status stays mounted, announces the process, and preserves input focus", async () => {
  const { LoadingStatus } = loadComponents()("loading-feedback");
  const tree = (React, active) => React.createElement("section", null,
    React.createElement("input", { defaultValue: "Pertanyaanku" }),
    React.createElement(LoadingStatus, { active, label: "Tutor sedang menyiapkan jawaban…" }));
  const view = await mount(React => tree(React, false));
  try {
    const status = view.document.querySelector('[role="status"]');
    const input = view.document.querySelector("input");
    input.focus();
    assert.equal(status.textContent, "");
    await view.update(React => tree(React, true));
    assert.equal(view.document.querySelector('[role="status"]'), status);
    assert.equal(status.getAttribute("aria-live"), "polite");
    assert.equal(status.getAttribute("aria-atomic"), "true");
    assert.equal(status.hasAttribute("aria-busy"), false, "a busy live region would delay the loading announcement");
    assert.match(status.textContent, /Tutor sedang menyiapkan jawaban/);
    assert.equal(status.querySelector('[data-slot="spinner"]').getAttribute("aria-hidden"), "true");
    assert.equal(view.document.activeElement, input);
    assert.equal(input.value, "Pertanyaanku");
    await view.update(React => tree(React, false));
    assert.equal(status.textContent, "");
  } finally { await view.cleanup(); }
});

test("loading feedback and descriptions follow the selected language", async () => {
  const { LoadingStatus } = loadComponents("en")("loading-feedback");
  const view = await mount(React => React.createElement(LoadingStatus, {
    label: "Mengunggah dokumen…", description: "Hasil pembacaan akan muncul untuk ditinjau sebelum disimpan.",
  }));
  try {
    const text = view.document.querySelector('[role="status"]').textContent;
    assert.match(text, /Uploading document/);
    assert.match(text, /review before you save/);
  } finally { await view.cleanup(); }
});

test("a loading button blocks repeated clicks and becomes usable after completion", async () => {
  const { Button } = loadComponents()("ui/button");
  let submissions = 0;
  const tree = (React, loading) => React.createElement(Button, {
    type: "submit", loading, loadingText: "Menyimpan jawaban…", onClick: () => submissions++,
  }, "Kirim jawaban");
  const view = await mount(React => tree(React, true));
  try {
    const button = view.document.querySelector("button");
    button.click(); button.click();
    assert.equal(submissions, 0);
    assert.equal(button.disabled, true);
    assert.equal(button.getAttribute("aria-busy"), "true");
    assert.equal(button.type, "submit");
    assert.equal(button.textContent, "Menyimpan jawaban…");
    await view.update(React => tree(React, false));
    button.click();
    assert.equal(submissions, 1);
    assert.equal(button.disabled, false);
    assert.equal(button.textContent, "Kirim jawaban");
    assert.equal(button.querySelector('[data-slot="spinner"]'), null);
  } finally { await view.cleanup(); }
});

test("button composition keeps a link as one interactive element", async () => {
  const { Button } = loadComponents()("ui/button");
  const view = await mount(React => React.createElement(Button, { asChild: true },
    React.createElement("a", { href: "/student/materials" }, "Materi saya")));
  try {
    assert.equal(view.document.querySelectorAll("a, button").length, 1);
    assert.equal(view.document.querySelector("a").getAttribute("href"), "/student/materials");
  } finally { await view.cleanup(); }
});

test("page skeletons are decorative and expose one useful loading announcement", async () => {
  const { PageLoading } = loadComponents("en")("loading-feedback");
  const view = await mount(React => React.createElement(PageLoading, { layout: "tutor", label: "Menyiapkan sesi Tutor…" }));
  try {
    assert.equal(view.document.querySelectorAll('[role="status"]').length, 1);
    assert.match(view.document.querySelector('[role="status"]').textContent, /Preparing your Tutor session/);
    assert.ok(view.document.querySelectorAll('[data-slot="skeleton"]').length >= 5);
    for (const skeleton of view.document.querySelectorAll('[data-slot="skeleton"]')) assert.equal(skeleton.getAttribute("aria-hidden"), "true");
    assert.equal(view.document.querySelector('[role="progressbar"]'), null, "unknown duration must not imply a percentage");
  } finally { await view.cleanup(); }
});

test("document history shows loading before it can claim an empty result", async () => {
  const gate = deferred();
  const { MaterialImportHistory } = loadComponents()("material-import-history");
  const view = await mount(React => {
    globalThis.fetch = () => gate.promise;
    return React.createElement(MaterialImportHistory, { classId: "class-1", refreshKey: 0, onPreview: async () => {} });
  });
  try {
    assert.match(view.document.body.textContent, /Memuat riwayat dokumen/);
    assert.doesNotMatch(view.document.body.textContent, /Belum ada dokumen tersimpan/);
    assert.equal(view.document.querySelector("button").disabled, true);
    await view.React.act(async () => gate.resolve(response([])));
    assert.match(view.document.body.textContent, /Belum ada dokumen tersimpan/);
    assert.equal(view.document.querySelector("button").disabled, false);
  } finally { await view.cleanup(); }
});

test("a failed history request stops loading and leaves refresh available", async () => {
  const { MaterialImportHistory } = loadComponents()("material-import-history");
  let calls = 0;
  const view = await mount(React => {
    globalThis.fetch = async () => ++calls === 1 ? response({}, false) : response([]);
    return React.createElement(MaterialImportHistory, { classId: "class-1", refreshKey: 0, onPreview: async () => {} });
  });
  try {
    assert.match(view.document.querySelector('[role="alert"]').textContent, /Riwayat dokumen belum dapat dibuka/);
    assert.doesNotMatch(view.document.body.textContent, /Belum ada dokumen tersimpan/);
    assert.equal(view.document.querySelector("button").disabled, false);
    await view.React.act(async () => view.document.querySelector("button").click());
    assert.equal(calls, 2);
    assert.equal(view.document.querySelector('[role="alert"]'), null);
    assert.match(view.document.body.textContent, /Belum ada dokumen tersimpan/);
  } finally { await view.cleanup(); }
});

test("manual refresh keeps existing documents visible while waiting for new data", async () => {
  const gate = deferred();
  const { MaterialImportHistory } = loadComponents()("material-import-history");
  const records = [{ import_id: "import-1", filename: "materi.pdf", state: "complete" }];
  let calls = 0;
  const view = await mount(React => {
    globalThis.fetch = () => ++calls === 1 ? Promise.resolve(response(records)) : gate.promise;
    return React.createElement(MaterialImportHistory, { classId: "class-1", refreshKey: 0, onPreview: async () => {} });
  });
  try {
    await view.React.act(async () => view.document.querySelector("button").click());
    assert.match(view.document.body.textContent, /materi.pdf/);
    assert.match(view.document.body.textContent, /Memuat riwayat dokumen/);
    assert.equal(view.document.querySelector("ul").getAttribute("aria-busy"), "true");
    assert.equal([...view.document.querySelectorAll("button")].every(button => button.disabled), true);
    await view.React.act(async () => gate.resolve(response(records)));
    assert.match(view.document.body.textContent, /materi.pdf/);
    assert.equal(view.document.querySelector("ul").getAttribute("aria-busy"), "false");
  } finally { await view.cleanup(); }
});

test("background import polling does not hide an ongoing manual refresh", async () => {
  const manual = deferred(), background = deferred();
  const timers = { setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval };
  let poll;
  globalThis.setInterval = callback => { poll = callback; return 1; };
  globalThis.clearInterval = () => {};
  const { MaterialImportHistory } = loadComponents()("material-import-history");
  let calls = 0;
  const completed = [{ import_id: "import-1", filename: "materi.pdf", state: "complete" }];
  let view;
  try {
    view = await mount(React => {
      globalThis.fetch = () => {
        calls++;
        if (calls === 1) return Promise.resolve(response([{ ...completed[0], state: "running" }]));
        return calls === 2 ? manual.promise : background.promise;
      };
      return React.createElement(MaterialImportHistory, { classId: "class-1", refreshKey: 0, onPreview: async () => {} });
    });
    assert.equal(typeof poll, "function");
    await view.React.act(async () => view.document.querySelector("button").click());
    await view.React.act(async () => poll());
    await view.React.act(async () => background.resolve(response(completed)));
    assert.equal(view.document.querySelector("button").disabled, true);
    assert.match(view.document.body.textContent, /Memuat riwayat dokumen/);
    await view.React.act(async () => manual.resolve(response(completed)));
    assert.equal(view.document.querySelector("button").disabled, false);
  } finally {
    if (view) await view.cleanup();
    Object.assign(globalThis, timers);
  }
});

test("Tutor keeps the lesson during a slow request and retries the same action after failure", async () => {
  const React = require("react");
  const gate = deferred();
  const select = ({ children, ...props }) => React.createElement("select", props, children);
  const { GuidedTutor } = loadComponents("id", {
    "@/components/ui/native-select": { NativeSelect: select },
    "next/link": ({ children, ...props }) => React.createElement("a", props, children),
    "@/lib/quiz-submission.mjs": { createQuizSubmissionId: () => "request-1" },
    "./voice-controls": { VoiceControls: () => null },
    "./student-quiz": { StudentQuiz: () => null },
  })("guided-tutor");
  const lesson = {
    session_id: "session-1", material_id: "material-1", class_id: "class-1", material_title: "Pecahan",
    phase: "learning", unit_index: 0, total_units: 2, unit_title: "Mengenal pecahan", text: "Satu per dua berarti setengah.",
    subject: "Matematika", language: "id", revision: 1, available_actions: ["continue", "repeat", "check"],
  };
  const requests = [];
  const view = await mount(React => {
    globalThis.fetch = (_url, options) => {
      requests.push(JSON.parse(options.body));
      return requests.length === 1 ? gate.promise : Promise.resolve(response({ ...lesson, revision: 2, text: "Dua bagian sama besar." }));
    };
    return React.createElement(GuidedTutor, { initialSessions: [lesson], materials: [{
      id: "material-1", class_id: "class-1", title: "Pecahan", subject: "Matematika", class_name: "VII A",
      rag_status: "ready", content_version: 1, indexed_version: 1,
    }] });
  });
  try {
    const repeat = [...view.document.querySelectorAll("button")].find(button => button.textContent === "Jelaskan lagi");
    await view.React.act(async () => { repeat.click(); repeat.click(); });
    assert.equal(requests.length, 1, "rapid clicks must not send two Tutor actions");
    assert.match(view.document.querySelector(".guided-explanation").textContent, /Satu per dua/);
    assert.equal(view.document.querySelector(".guided-main").getAttribute("aria-busy"), "true");
    const status = view.document.querySelector('.loading-feedback[role="status"]');
    assert.match(status.textContent, /Menyiapkan penjelasan Tutor/);
    assert.equal(status.closest('[aria-busy="true"]'), null, "busy content must not silence the status");
    assert.equal(view.document.querySelector(".change-material-btn").disabled, true);
    await view.React.act(async () => gate.resolve({ status: 503, ...response({ message: "Coba lagi." }, false) }));
    assert.equal(view.document.querySelector(".guided-main").getAttribute("aria-busy"), "false");
    assert.match(view.document.querySelector(".guided-explanation").textContent, /Satu per dua/);
    const retry = [...view.document.querySelectorAll("button")].find(button => button.textContent === "Coba kirim kembali");
    assert.ok(retry);
    await view.React.act(async () => retry.click());
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1], requests[0], "an uncertain action must keep its receipt when retried");
    assert.match(view.document.querySelector(".guided-explanation").textContent, /Dua bagian sama besar/);
  } finally { await view.cleanup(); }
});

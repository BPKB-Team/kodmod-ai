import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
for (const key of ["window", "document", "Node", "HTMLElement", "Element", "MutationObserver", "DOMParser", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "getSelection"])
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "getComputedStyle" ? dom.window.getComputedStyle.bind(dom.window) : key === "requestAnimationFrame" ? dom.window.requestAnimationFrame.bind(dom.window) : key === "cancelAnimationFrame" ? dom.window.cancelAnimationFrame.bind(dom.window) : key === "getSelection" ? dom.window.getSelection.bind(dom.window) : dom.window[key] });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
globalThis.kodmodRenderReact = React;

const stubs = new Map([
  ["next/link", `export default function Link({children,...props}){return globalThis.kodmodRenderReact.createElement("a",props,children);}`],
  ["@/components/language-provider", `export const UiText=({children})=>children; export const useI18n=()=>({t:x=>x,language:"id"});`],
]);
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier.endsWith(".css")) return { shortCircuit: true, url: "data:text/javascript," };
    if (stubs.has(specifier)) return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(stubs.get(specifier)) };
    if (specifier.startsWith("@/")) {
      let url = new URL("../src/" + specifier.slice(2), import.meta.url);
      if (!existsSync(url)) url = new URL(url.href + (existsSync(new URL(url.href + ".tsx")) ? ".tsx" : ".ts"));
      return { shortCircuit: true, url: url.href };
    }
    if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
      const url = new URL(specifier, context.parentURL);
      if (!existsSync(url) && existsSync(new URL(url.href + ".tsx"))) return { shortCircuit: true, url: url.href + ".tsx" };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (/\.tsx?$/.test(url)) return { shortCircuit: true, format: "module", source: ts.transpileModule(readFileSync(new URL(url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText };
    return next(url, context);
  },
});

const { Editor } = await import("@tiptap/core");
const { materialEditorExtensions, sanitizeMaterialPaste } = await import("../src/lib/material-editor-extensions.ts");
const { toEditorJson, fromEditorJson } = await import("../src/lib/material-document-adapter.mjs");
const { MaterialRenderer } = await import("../src/components/material-renderer.tsx");
hooks.deregister();

const imageId = "20000000-0000-4000-8000-000000000001";
const classId = "10000000-0000-4000-8000-000000000001";
const sourceDocument = { schema_version: 1, blocks: [
  { id: "formula-text", type: "paragraph", role: "instruction", review_state: "accepted", review_origin: "extracted", confidence: 0.98, provenance: { source_sha256: "a".repeat(64), import_id: "30000000-0000-4000-8000-000000000001", page: 10, page_label: "10", bbox: [10, 20, 110, 60], source_block_id: "page-10-block-3", method: "native", extractor_version: "pdf-layout-v2", edited: false }, inlines: [{ text: "CO(NH" }, { text: "2", marks: ["subscript"] }, { text: ")" }, { text: "2", marks: ["subscript"] }, { text: " dan a" }, { text: "p+q", marks: ["superscript"] }], level: null, ordered: false, items: [], headers: [], rows: [], asset_id: null, alt: "", caption: "", decorative: false, latex: null, warnings: [] },
  { id: "formula", type: "math", role: "example", review_state: "accepted", review_origin: "teacher", confidence: null, provenance: { method: "teacher", extractor_version: "document-v1", edited: false }, inlines: [], level: null, ordered: false, items: [], headers: [], rows: [], asset_id: null, alt: "", caption: "", decorative: false, latex: "a^p a^q=a^{p+q}", warnings: [] },
  { id: "table", type: "table", role: "instruction", review_state: "accepted", review_origin: "teacher", confidence: null, provenance: { method: "teacher", extractor_version: "document-v1", edited: false }, inlines: [], level: null, ordered: false, items: [], headers: ["Rumus", "Nama"], rows: [["CO(NH_{2})_{2}", "Urea"]], asset_id: null, alt: "", caption: "", decorative: false, latex: null, warnings: [] },
  { id: "image", type: "image", role: "example", review_state: "accepted", review_origin: "teacher", confidence: null, provenance: { method: "teacher", extractor_version: "document-v1", edited: false }, inlines: [], level: null, ordered: false, items: [], headers: [], rows: [], asset_id: imageId, alt: "Orbit planet mengelilingi bintang", caption: "Contoh orbit", decorative: false, latex: null, warnings: [] },
] };

test("real ProseMirror editor save and reload preserves scientific marks, formulas, table headers, private images and provenance", () => {
  const editor = new Editor({ element: globalThis.document.createElement("div"), extensions: materialEditorExtensions(), content: toEditorJson(sourceDocument, { classId }), injectCSS: false });
  try {
    const initial = fromEditorJson(editor.getJSON());
    assert.deepEqual(initial, sourceDocument);
    let headerPosition = -1;
    editor.state.doc.descendants((node, position) => { if (headerPosition === -1 && node.type.name === "tableHeader") headerPosition = position; });
    assert.notEqual(headerPosition, -1);
    editor.commands.insertContentAt(headerPosition + 2, "hasil ");
    const saved = fromEditorJson(editor.getJSON());
    const savedTable = saved.blocks.find(block => block.type === "table");
    assert.deepEqual(savedTable.headers, ["hasil Rumus", "Nama"]);
    assert.deepEqual(savedTable.rows, [["CO(NH_{2})_{2}", "Urea"]]);
    assert.equal(saved.blocks[0].provenance.edited, false);
    assert.equal(saved.blocks.find(block => block.type === "image").alt, "Orbit planet mengelilingi bintang");
    const reloaded = new Editor({ element: globalThis.document.createElement("div"), extensions: materialEditorExtensions(), content: toEditorJson(saved, { classId }), injectCSS: false });
    try { assert.deepEqual(fromEditorJson(reloaded.getJSON()), saved); } finally { reloaded.destroy(); }
  } finally { editor.destroy(); }
});

test("paste sanitizer drops executable markup, remote images and event attributes but keeps scientific text", () => {
  const sanitized = sanitizeMaterialPaste('<p onclick="run()">H<sub>2</sub>O <img src="https://example.test/x"><script>alert(1)</script><a href="https://example.test">sumber</a></p>');
  assert.match(sanitized, /<sub>2<\/sub>/);
  assert.match(sanitized, /href="https:\/\/example\.test"/);
  assert.doesNotMatch(sanitized, /onclick|<img|<script|alert\(1\)/);
});

test("shared renderer exposes semantic science, table headers, private image alt and spoken formula without raw LaTeX", () => {
  const html = renderToStaticMarkup(React.createElement(MaterialRenderer, { document: sourceDocument, classId }));
  assert.match(html, /<sub>2<\/sub>/);
  assert.match(html, /<sup>p\+q<\/sup>/);
  assert.match(html, /<th scope="col">Rumus<\/th>/);
  assert.match(html, new RegExp(`/api/classes/${classId}/material-assets/${imageId}`));
  assert.match(html, /alt="Orbit planet mengelilingi bintang"/);
  assert.match(html, /aria-label="a pangkat p a pangkat q sama dengan a pangkat p tambah q"/);
  assert.doesNotMatch(html, /a\^p a\^q=a\^\{p\+q\}/);
});

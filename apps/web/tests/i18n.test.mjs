import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { english, localeFor, translate, validLanguage } from "../src/lib/i18n.mjs";

test("language choice accepts only the supported interface locales", () => {
  assert.equal(validLanguage("id"), true);
  assert.equal(validLanguage("en"), true);
  for (const value of ["fr", "EN", null, undefined, {}, "en-US"]) assert.equal(validLanguage(value), false);
  assert.equal(localeFor("id"), "id-ID");
  assert.equal(localeFor("en"), "en-US");
});

test("interface language keeps content and word boundaries intact", () => {
  assert.equal(translate(" Kelas saya ", "en"), " My classes ");
  assert.equal(translate("Kelas saya", "id"), "Kelas saya");
  const lesson = "Materi bu Rani: 1/2 + 1/4 = 3/4";
  assert.equal(translate(lesson, "en"), lesson);
  assert.equal(translate("Materi, anggota, dan ruang belajar Anda dalam satu tempat.", "en"), "Your lessons, students, and classes in one place.");
  assert.equal(translate("Soal {number}", "en", { number: 2 }), "Question 2");
  assert.equal(translate("Soal {number}", "id", { number: 2 }), "Soal 2");
  assert.equal(translate("Keluarkan {name}", "en", { name: "Siswa Uji" }), "Remove Siswa Uji");
});

test("OpenAI billing labels have English interface copy", () => {
  for (const key of ["Biaya aktual OpenAI", "USD aktual", "Konversi rupiah", "Sumber: OpenAI Costs API"]) {
    assert.notEqual(translate(key, "en"), key);
  }
});
test("registration, onboarding, narration and confirmation have English copy", () => {
  for (const key of ["Buat akun KODMOD", "Pilih suara untuk belajar", "Pembaca menu", "Suara Tutor", "Pengaturan suara", "Ya, keluar", "Username atau kata sandi tidak sesuai.", "Menunggu review", "Belum ada materi"]) {
    assert.ok(Object.hasOwn(english, key), `Missing English interface copy: ${key}`);
    assert.notEqual(translate(key, "en"), key);
  }
});

test("dynamic accessible labels translate surrounding copy and preserve authored names", () => {
  assert.equal(
    translate("Kelas {name}. Mata pelajaran {subject}. {materials} materi, {students} siswa.", "en", {
      name: "Kelas 8A", subject: "Matematika", materials: 4, students: 20,
    }),
    "Class Kelas 8A. Subject: Matematika. 4 materials, 20 students.",
  );
  assert.equal(
    translate("{answered} dari {total} soal selesai", "en", { answered: 2, total: 5 }),
    "2 of 5 questions completed",
  );
});

test("all statically rendered UI text has an English translation", async () => {
  const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await visit(file);
      else if (/\.(?:ts|tsx|js|jsx|mjs)$/.test(entry.name)) files.push(file);
    }
  }
  await visit(sourceRoot);

  const missing = new Set();
  const addKey = (key) => {
    const normalized = key.trim().replace(/\s+/g, " ");
    if (normalized && !Object.hasOwn(english, normalized)) missing.add(normalized);
  };
  const collectExpressionStrings = (node) => {
    if (!node) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) addKey(node.text);
    else if (ts.isConditionalExpression(node)) {
      collectExpressionStrings(node.whenTrue);
      collectExpressionStrings(node.whenFalse);
    } else if (ts.isParenthesizedExpression(node)) collectExpressionStrings(node.expression);
    else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      collectExpressionStrings(node.left);
      collectExpressionStrings(node.right);
    }
  };
  const collectUiText = (node) => {
    if (ts.isJsxText(node)) {
      if (node.text.trim()) addKey(node.text);
    } else if (ts.isJsxExpression(node)) collectExpressionStrings(node.expression);
    else if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      for (const child of node.children) collectUiText(child);
    }
  };

  for (const file of files) {
    const sourceText = await readFile(file, "utf8");
    const kind = /\.(?:tsx|jsx)$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, kind);
    function inspect(node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "t") {
        collectExpressionStrings(node.arguments[0]);
      }
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "UiText") {
        for (const child of node.children) collectUiText(child);
      }
      ts.forEachChild(node, inspect);
    }
    inspect(source);
  }

  assert.deepEqual([...missing].sort(), [], "Every static t() and UiText string needs an English translation");
});

test("human-facing JSX copy uses the active language for text and accessibility labels", async () => {
  const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await visit(file);
      else if (/\.(?:tsx|jsx)$/.test(entry.name)) files.push(file);
    }
  }
  await visit(sourceRoot);

  const untranslated = new Set();
  const languageNeutral = new Set([
    "KODMOD", "KODMOD ·", "KODMOD.", "English", "Indonesia", "Bahasa Indonesia",
    "Telkom Indonesia", "Telkom University", "Telin", "Esc", "X²", "X₂", "&ldquo;", "&rdquo;",
  ]);
  const needsTranslation = (value) => {
    const text = value.trim().replace(/\s+/g, " ");
    return text.length > 1 && /[A-Za-z\u00c0-\u024f]/.test(text) &&
      !languageNeutral.has(text) && !/^\w{1,2}$/.test(text) && !/^[-\d\s.:/%·]+$/.test(text);
  };

  for (const file of files) {
    const sourceText = await readFile(file, "utf8");
    const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function inspect(node) {
      if (ts.isJsxText(node) && needsTranslation(node.text)) {
        let parent = node.parent;
        let translated = false;
        let code = false;
        while (parent) {
          if (ts.isJsxElement(parent)) {
            const tag = parent.openingElement.tagName.getText(source);
            if (tag === "UiText") translated = true;
            if (tag === "code" || tag === "pre") code = true;
          }
          parent = parent.parent;
        }
        if (!translated && !code) untranslated.add(`${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${node.text.trim()}`);
      }
      if (ts.isJsxAttribute(node) && ["placeholder", "title", "alt", "aria-label", "aria-description"].includes(node.name.getText(source)) && node.initializer && ts.isStringLiteral(node.initializer)) {
        const value = node.initializer.text;
        if (needsTranslation(value) && !value.startsWith("a^{")) {
          untranslated.add(`${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${node.name.getText(source)}=${value}`);
        }
      }
      if (ts.isJsxAttribute(node) && node.name.getText(source) === "aria-label" && node.initializer && ts.isJsxExpression(node.initializer)) {
        const expression = node.initializer.expression;
        let translated = false;
        const pieces = [];
        function collect(node) {
          if (!node) return;
          if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "t") translated = true;
          if (ts.isStringLiteral(node)) pieces.push(node.text);
          else if (ts.isTemplateExpression(node)) {
            if (node.head.text) pieces.push(node.head.text);
            for (const part of node.templateSpans) if (part.literal.text) pieces.push(part.literal.text);
          }
          ts.forEachChild(node, collect);
        }
        collect(expression);
        if (!translated) {
          for (const piece of pieces) {
            if (needsTranslation(piece)) untranslated.add(`${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: aria-label expression: ${piece.trim()}`);
          }
        }
      }
      ts.forEachChild(node, inspect);
    }
    inspect(source);
  }

  assert.deepEqual([...untranslated].sort(), [], "Visible JSX copy and accessible labels must use t() or UiText");
});

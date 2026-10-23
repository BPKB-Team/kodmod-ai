"use client";
import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import {
  Bold,
  Columns3,
  Heading2,
  Image as ImageIcon,
  Italic,
  List,
  ListOrdered,
  Pilcrow,
  Redo2,
  Rows3,
  Sigma,
  Subscript,
  Superscript,
  Table,
  Undo2,
} from "lucide-react";
import { materialEditorExtensions, sanitizeMaterialPaste } from "@/lib/material-editor-extensions";
import { toEditorJson, fromEditorJson, validateMaterialLatex } from "@/lib/material-document-adapter.mjs";
import type { MaterialDocument } from "@/lib/material-document-types";
import { UiText, useI18n } from "./language-provider";
import "katex/dist/katex.min.css";
import "@/styles/material-editor.css";

export function MaterialRichEditor({
  value,
  onChange,
  classId,
  disabled = false,
  onValidityChange,
}: {
  value: MaterialDocument;
  onChange: (value: MaterialDocument) => void;
  classId: string;
  disabled?: boolean;
  onValidityChange?: (valid: boolean) => void;
}) {
  const { t } = useI18n();
  const [error, setError] = useState("");
  const [latex, setLatex] = useState("");
  const [alt, setAlt] = useState("");
  const [uploading, setUploading] = useState(false);
  const latest = useRef(value);
  const file = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: materialEditorExtensions(),
    content: toEditorJson(value, { classId }),
    immediatelyRender: false,
    editable: !disabled,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": t("Isi materi"),
        "aria-multiline": "true",
      },
      transformPastedHTML: sanitizeMaterialPaste,
    },
    onUpdate: ({ editor }) => {
      try {
        const next = fromEditorJson(editor.getJSON());
        latest.current = next;
        onChange(next);
        setError("");
        onValidityChange?.(true);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : t("Periksa format materi."));
        onValidityChange?.(false);
      }
    },
  });

  useEffect(() => {
    editor?.setEditable(!disabled && !uploading);
  }, [disabled, uploading, editor]);

  useEffect(() => {
    if (editor && JSON.stringify(latest.current) !== JSON.stringify(value)) {
      editor.commands.setContent(toEditorJson(value, { classId }), { emitUpdate: false });
      latest.current = value;
    }
  }, [value, classId, editor]);

  const locked = disabled || uploading || !editor;

  function insertMath(display: boolean) {
    if (!editor) return;
    try {
      validateMaterialLatex(latex);
      const selected = editor.state.selection;
      const node = editor.state.doc.nodeAt(selected.from);
      if (node?.type.name === (display ? "blockMath" : "inlineMath")) {
        editor.commands.updateAttributes(node.type.name, { latex });
      } else if (display) {
        editor.chain().focus().insertBlockMath({ latex }).run();
      } else {
        editor.chain().focus().insertInlineMath({ latex }).run();
      }
      setLatex("");
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("Periksa rumus."));
    }
  }

  async function upload(selected: File) {
    if (!editor || !alt.trim()) return;
    setUploading(true);
    setError("");
    try {
      if (selected.size > 10 * 1024 * 1024) throw Error("Gambar maksimal 10 MiB.");
      const body = new FormData();
      body.set("file", selected);
      const response = await fetch(`/api/classes/${classId}/material-assets`, {
        method: "POST",
        body,
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.message || "Gambar belum dapat diunggah.");
      editor
        .chain()
        .focus()
        .insertContent({
          type: "image",
          attrs: {
            assetId: result.id,
            src: `/api/classes/${classId}/material-assets/${result.id}`,
            alt: alt.trim(),
          },
        })
        .run();
      setAlt("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("Gambar belum dapat diunggah."));
    } finally {
      setUploading(false);
      if (file.current) file.current.value = "";
    }
  }

  const isTableActive = Boolean(editor?.isActive("table"));

  return (
    <div className="material-rich-editor" aria-busy={uploading}>
      {/* DOCX-style Ribbon Toolbar */}
      <div className="material-editor-toolbar" role="group" aria-label={t("Format materi")}>
        {/* Undo / Redo Group */}
        <div className="editor-tool-group" role="group" aria-label="Riwayat edit">
          <button
            type="button"
            className="editor-tool-btn"
            title={t("Undo")}
            aria-label={t("Undo")}
            disabled={locked}
            onClick={() => editor?.chain().focus().undo().run()}
          >
            <Undo2 size={16} aria-hidden="true" />
            <span className="tool-btn-label"><UiText>{"Undo"}</UiText></span>
          </button>
          <button
            type="button"
            className="editor-tool-btn"
            title={t("Redo")}
            aria-label={t("Redo")}
            disabled={locked}
            onClick={() => editor?.chain().focus().redo().run()}
          >
            <Redo2 size={16} aria-hidden="true" />
            <span className="tool-btn-label"><UiText>{"Redo"}</UiText></span>
          </button>
        </div>

        <div className="editor-tool-divider" aria-hidden="true" />

        {/* Structure Group: Paragraf, Judul */}
        <div className="editor-tool-group" role="group" aria-label="Format paragraf">
          <button
            type="button"
            className={`editor-tool-btn ${editor?.isActive("paragraph") ? "is-active" : ""}`}
            title={t("Paragraf")}
            aria-label={t("Paragraf")}
            aria-pressed={editor?.isActive("paragraph") ?? false}
            disabled={locked}
            onClick={() => editor?.chain().focus().setParagraph().run()}
          >
            <Pilcrow size={16} aria-hidden="true" />
            <span className="tool-btn-label"><UiText>{"Paragraf"}</UiText></span>
          </button>
          <button
            type="button"
            className={`editor-tool-btn ${editor?.isActive("heading", { level: 2 }) ? "is-active" : ""}`}
            title={t("Judul")}
            aria-label={t("Judul")}
            aria-pressed={editor?.isActive("heading", { level: 2 }) ?? false}
            disabled={locked}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          >
            <Heading2 size={16} aria-hidden="true" />
            <span className="tool-btn-label"><UiText>{"Judul"}</UiText></span>
          </button>
        </div>

        <div className="editor-tool-divider" aria-hidden="true" />

        {/* Inline Formatting: Tebal, Miring, Subscript, Superscript */}
        <div className="editor-tool-group" role="group" aria-label="Format karakter">
          <button
            type="button"
            className={`editor-tool-btn icon-only ${editor?.isActive("bold") ? "is-active" : ""}`}
            title={t("Tebal")}
            aria-label={t("Tebal")}
            aria-pressed={editor?.isActive("bold") ?? false}
            disabled={locked}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          >
            <Bold size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`editor-tool-btn icon-only ${editor?.isActive("italic") ? "is-active" : ""}`}
            title={t("Miring")}
            aria-label={t("Miring")}
            aria-pressed={editor?.isActive("italic") ?? false}
            disabled={locked}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          >
            <Italic size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`editor-tool-btn icon-only ${editor?.isActive("subscript") ? "is-active" : ""}`}
            title={t("Subscript")}
            aria-label={t("Subscript")}
            aria-pressed={editor?.isActive("subscript") ?? false}
            disabled={locked}
            onClick={() => editor?.chain().focus().unsetSuperscript().toggleSubscript().run()}
          >
            <Subscript size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`editor-tool-btn icon-only ${editor?.isActive("superscript") ? "is-active" : ""}`}
            title={t("Superscript")}
            aria-label={t("Superscript")}
            aria-pressed={editor?.isActive("superscript") ?? false}
            disabled={locked}
            onClick={() => editor?.chain().focus().unsetSubscript().toggleSuperscript().run()}
          >
            <Superscript size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="editor-tool-divider" aria-hidden="true" />

        {/* Lists Group: Bullet, Numbered */}
        <div className="editor-tool-group" role="group" aria-label="Daftar list">
          <button
            type="button"
            className={`editor-tool-btn icon-only ${editor?.isActive("bulletList") ? "is-active" : ""}`}
            title={t("Daftar butir")}
            aria-label={t("Daftar butir")}
            aria-pressed={editor?.isActive("bulletList") ?? false}
            disabled={locked}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          >
            <List size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`editor-tool-btn icon-only ${editor?.isActive("orderedList") ? "is-active" : ""}`}
            title={t("Daftar bernomor")}
            aria-label={t("Daftar bernomor")}
            aria-pressed={editor?.isActive("orderedList") ?? false}
            disabled={locked}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="editor-tool-divider" aria-hidden="true" />

        {/* Tables Group: Insert, Add Row, Add Column */}
        <div className="editor-tool-group" role="group" aria-label="Tabel">
          <button
            type="button"
            className={`editor-tool-btn ${isTableActive ? "is-active" : ""}`}
            title={t("Sisipkan tabel")}
            aria-label={t("Sisipkan tabel")}
            disabled={locked}
            onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run()}
          >
            <Table size={16} aria-hidden="true" />
            <span className="tool-btn-label"><UiText>{"Sisipkan tabel"}</UiText></span>
          </button>
          <button
            type="button"
            className="editor-tool-btn"
            title={t("Tambah baris")}
            aria-label={t("Tambah baris")}
            disabled={locked || !isTableActive}
            onClick={() => editor?.chain().focus().addRowAfter().run()}
          >
            <Rows3 size={16} aria-hidden="true" />
            <span className="tool-btn-label"><UiText>{"Tambah baris"}</UiText></span>
          </button>
          <button
            type="button"
            className="editor-tool-btn"
            title={t("Tambah kolom")}
            aria-label={t("Tambah kolom")}
            disabled={locked || !isTableActive}
            onClick={() => editor?.chain().focus().addColumnAfter().run()}
          >
            <Columns3 size={16} aria-hidden="true" />
            <span className="tool-btn-label"><UiText>{"Tambah kolom"}</UiText></span>
          </button>
        </div>
      </div>

      {/* Document Sheet Canvas */}
      <div className="editor-canvas-container">
        <EditorContent editor={editor} />
      </div>

      {/* Advanced Insert Panel: Math & Images */}
      <details className="material-editor-insert">
        <summary>
          <span className="insert-summary-title">
            <Sigma size={16} aria-hidden="true" />
            <ImageIcon size={16} aria-hidden="true" />
            <UiText>{"Rumus dan gambar"}</UiText>
          </span>
        </summary>
        <div className="material-insert-fields">
          <label className="field">
            <span className="field-title">
              <Sigma size={15} aria-hidden="true" />
              <UiText>{"Rumus LaTeX"}</UiText>
            </span>
            <input
              value={latex}
              onChange={(e) => setLatex(e.target.value)}
              disabled={locked}
              maxLength={4000}
              placeholder="a^{p+q}"
            />
          </label>
          <div className="guided-actions">
            <button
              type="button"
              className="button secondary"
              disabled={locked || !latex.trim()}
              onClick={() => insertMath(false)}
            >
              <UiText>{"Sisipkan rumus sebaris"}</UiText>
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={locked || !latex.trim()}
              onClick={() => insertMath(true)}
            >
              <UiText>{"Sisipkan rumus terpisah"}</UiText>
            </button>
          </div>
          <label className="field">
            <span className="field-title"><UiText>{"Deskripsi alternatif gambar"}</UiText></span>
            <input
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
              disabled={locked}
              maxLength={4000}
              placeholder="Contoh: Diagram orbit planet mengelilingi matahari"
            />
          </label>
          <label className="field">
            <span className="field-title">
              <ImageIcon size={15} aria-hidden="true" />
              <UiText>{"Unggah gambar"}</UiText>
            </span>
            <input
              ref={file}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={locked || !classId || !alt.trim()}
              onChange={(e) => {
                const selected = e.target.files?.[0];
                if (selected) void upload(selected);
              }}
            />
          </label>
        </div>
      </details>

      <p className="muted" role="status">
        <UiText>
          {uploading
            ? "Mengunggah gambar…"
            : "Format tersimpan bersama materi. Tinjau hasil sebelum menerbitkan."}
        </UiText>
      </p>
      {error && (
        <p className="alert error-message" role="alert">
          {t(error)}
        </p>
      )}
    </div>
  );
}

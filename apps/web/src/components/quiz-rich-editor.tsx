"use client";

import { useRef, useState, type ReactNode } from "react";
import {
  Bold,
  Italic,
  Subscript,
  Superscript,
  Sigma,
  Eye,
  EyeOff,
  Sparkles,
} from "lucide-react";
import { FormattedMathText } from "./formatted-math-text";
import { UiText, useI18n } from "./language-provider";

interface QuizRichEditorProps {
  id?: string;
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
  disabled?: boolean;
  rows?: number;
  helpText?: ReactNode;
}

const SUPERSCRIPTS: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
  "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾",
  "n": "ⁿ", "x": "ˣ", "y": "ʸ", "a": "ᵃ", "b": "ᵇ",
};

const SUBSCRIPTS: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄",
  "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎",
  "a": "ₐ", "e": "ₑ", "o": "ₒ", "x": "ₓ",
};

const COMMON_SYMBOLS = [
  { symbol: "×", label: "Kali (×)" },
  { symbol: "÷", label: "Bagi (÷)" },
  { symbol: "±", label: "Plus minus (±)" },
  { symbol: "≠", label: "Tidak sama (≠)" },
  { symbol: "≤", label: "Kurang dari sama dengan (≤)" },
  { symbol: "≥", label: "Lebih dari sama dengan (≥)" },
  { symbol: "≈", label: "Mendekati (≈)" },
  { symbol: "π", label: "Pi (π)" },
  { symbol: "√", label: "Akar (√)" },
  { symbol: "°", label: "Derajat (°)" },
  { symbol: "→", label: "Panah (→)" },
  { symbol: "∆", label: "Delta (∆)" },
];

export function QuizRichEditor({
  id,
  label,
  value,
  onChange,
  placeholder,
  required = false,
  maxLength = 4000,
  disabled = false,
  rows = 3,
  helpText,
}: QuizRichEditorProps) {
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);
  const [showFormulaMenu, setShowFormulaMenu] = useState(false);

  function wrapSelection(prefix: string, suffix = prefix, fallback = "teks") {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.substring(start, end);

    // Toggle wrap if already wrapped
    const beforeSelection = value.substring(Math.max(0, start - prefix.length), start);
    const afterSelection = value.substring(end, end + suffix.length);
    if (beforeSelection === prefix && afterSelection === suffix && selected) {
      const next =
        value.substring(0, start - prefix.length) +
        selected +
        value.substring(end + suffix.length);
      onChange(next);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start - prefix.length, end - prefix.length);
      });
      return;
    }

    const replacement = selected ? `${prefix}${selected}${suffix}` : `${prefix}${fallback}${suffix}`;
    const next = value.substring(0, start) + replacement + value.substring(end);
    onChange(next);

    requestAnimationFrame(() => {
      el.focus();
      if (selected) {
        el.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
      } else {
        el.setSelectionRange(start + prefix.length, start + prefix.length + fallback.length);
      }
    });
  }

  function insertText(insertion: string, cursorOffset?: number) {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = value.substring(0, start) + insertion + value.substring(end);
    onChange(next);

    requestAnimationFrame(() => {
      el.focus();
      const pos = start + (cursorOffset !== undefined ? cursorOffset : insertion.length);
      el.setSelectionRange(pos, pos);
    });
  }

  function applySuperscript() {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.substring(start, end);

    if (!selected) {
      insertText("²");
      return;
    }

    // Try converting characters to Unicode superscripts
    let converted = "";
    let canConvert = true;
    for (const ch of selected) {
      if (SUPERSCRIPTS[ch]) {
        converted += SUPERSCRIPTS[ch];
      } else {
        canConvert = false;
        break;
      }
    }

    if (canConvert && converted) {
      insertText(converted);
    } else {
      // Fallback to LaTeX superscript
      wrapSelection("^{", "}", selected || "2");
    }
  }

  function applySubscript() {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.substring(start, end);

    if (!selected) {
      insertText("₂");
      return;
    }

    // Try converting characters to Unicode subscripts
    let converted = "";
    let canConvert = true;
    for (const ch of selected) {
      if (SUBSCRIPTS[ch]) {
        converted += SUBSCRIPTS[ch];
      } else {
        canConvert = false;
        break;
      }
    }

    if (canConvert && converted) {
      insertText(converted);
    } else {
      // Fallback to LaTeX subscript
      wrapSelection("_{", "}", selected || "2");
    }
  }

  return (
    <div className="quiz-rich-editor-wrapper">
      <div className="quiz-rich-editor-header">
        <label htmlFor={id} className="quiz-rich-editor-label">
          {label}
          {required && <span className="quiz-field-required" aria-hidden="true">*</span>}
        </label>
        <button
          type="button"
          className={`quiz-rich-preview-btn ${preview ? "is-active" : ""}`}
          onClick={() => setPreview((prev) => !prev)}
          disabled={disabled}
          title={preview ? t("Kembali ke mode edit") : t("Lihat pratinjau format")}
          aria-pressed={preview}
        >
          {preview ? (
            <>
              <EyeOff size={14} aria-hidden="true" />
              <span><UiText>{"Mode Edit"}</UiText></span>
            </>
          ) : (
            <>
              <Eye size={14} aria-hidden="true" />
              <span><UiText>{"Pratinjau"}</UiText></span>
            </>
          )}
        </button>
      </div>

      <div className={`quiz-rich-editor-box ${preview ? "is-preview" : ""}`}>
        {!preview && (
          <div className="quiz-rich-toolbar" role="toolbar" aria-label={t("Format teks soal")}>
            {/* Formatting tools */}
            <div className="quiz-toolbar-group">
              <button
                type="button"
                className="quiz-tool-btn"
                title={t("Tebal (Ctrl+B)")}
                aria-label={t("Tebal")}
                disabled={disabled}
                onClick={() => wrapSelection("**", "**", "teks tebal")}
              >
                <Bold size={15} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="quiz-tool-btn"
                title={t("Miring (Ctrl+I)")}
                aria-label={t("Miring")}
                disabled={disabled}
                onClick={() => wrapSelection("*", "*", "teks miring")}
              >
                <Italic size={15} aria-hidden="true" />
              </button>
            </div>

            <div className="quiz-toolbar-divider" aria-hidden="true" />

            {/* Scientific notations */}
            <div className="quiz-toolbar-group">
              <button
                type="button"
                className="quiz-tool-btn"
                title={t("Pangkat / Superscript (X²)")}
                aria-label={t("Superscript")}
                disabled={disabled}
                onClick={applySuperscript}
              >
                <Superscript size={15} aria-hidden="true" />
                <span className="quiz-tool-pill">X²</span>
              </button>
              <button
                type="button"
                className="quiz-tool-btn"
                title={t("Indeks / Subscript (X₂)")}
                aria-label={t("Subscript")}
                disabled={disabled}
                onClick={applySubscript}
              >
                <Subscript size={15} aria-hidden="true" />
                <span className="quiz-tool-pill">X₂</span>
              </button>
            </div>

            <div className="quiz-toolbar-divider" aria-hidden="true" />

            {/* Math Formula dropdown/helper */}
            <div className="quiz-toolbar-group">
              <button
                type="button"
                className={`quiz-tool-btn ${showFormulaMenu ? "is-active" : ""}`}
                title={t("Rumus Matematika / LaTeX")}
                aria-label={t("Rumus")}
                disabled={disabled}
                onClick={() => setShowFormulaMenu((prev) => !prev)}
              >
                <Sigma size={15} aria-hidden="true" />
                <span className="quiz-tool-label"><UiText>{"Rumus"}</UiText></span>
              </button>
            </div>

            <div className="quiz-toolbar-divider" aria-hidden="true" />

            {/* Quick symbols */}
            <div className="quiz-toolbar-symbols" role="group" aria-label={t("Simbol cepat")}>
              {COMMON_SYMBOLS.map(({ symbol, label: symbolLabel }) => (
                <button
                  key={symbol}
                  type="button"
                  className="quiz-symbol-btn"
                  title={symbolLabel}
                  disabled={disabled}
                  onClick={() => insertText(symbol)}
                >
                  {symbol}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Formula template quick drawer */}
        {!preview && showFormulaMenu && (
          <div className="quiz-formula-menu" role="menu">
            <span className="quiz-formula-menu-title">
              <Sparkles size={14} aria-hidden="true" />
              <UiText>{"Sisipkan Rumus Matematika (LaTeX):"}</UiText>
            </span>
            <div className="quiz-formula-grid">
              <button
                type="button"
                className="quiz-formula-item"
                onClick={() => {
                  insertText("$\\frac{a}{b}$", 7);
                  setShowFormulaMenu(false);
                }}
              >
                <span>Pecahan:</span> <code>{"$\\frac{a}{b}$"}</code>
              </button>
              <button
                type="button"
                className="quiz-formula-item"
                onClick={() => {
                  insertText("$\\sqrt{x}$", 7);
                  setShowFormulaMenu(false);
                }}
              >
                <span>Akar:</span> <code>{"$\\sqrt{x}$"}</code>
              </button>
              <button
                type="button"
                className="quiz-formula-item"
                onClick={() => {
                  insertText("$x^{2}$", 4);
                  setShowFormulaMenu(false);
                }}
              >
                <span>Pangkat:</span> <code>{"$x^{2}$"}</code>
              </button>
              <button
                type="button"
                className="quiz-formula-item"
                onClick={() => {
                  insertText("$x_{1}$", 4);
                  setShowFormulaMenu(false);
                }}
              >
                <span>Indeks:</span> <code>{"$x_{1}$"}</code>
              </button>
              <button
                type="button"
                className="quiz-formula-item"
                onClick={() => {
                  wrapSelection("$", "$", "rumus");
                  setShowFormulaMenu(false);
                }}
              >
                <span>Rumus Inline:</span> <code>{"$rumus$"}</code>
              </button>
            </div>
          </div>
        )}

        {preview ? (
          <div className="quiz-field-preview-area">
            <div className="quiz-preview-badge">
              <Eye size={13} aria-hidden="true" />
              <span><UiText>{"Tampilan Siswa"}</UiText></span>
            </div>
            <div className="quiz-preview-content">
              {value.trim() ? (
                <FormattedMathText text={value} />
              ) : (
                <p className="quiz-preview-placeholder">
                  <UiText>{"Belum ada isi untuk dipratinjau. Ketik teks soal di mode edit."}</UiText>
                </p>
              )}
            </div>
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            id={id}
            rows={rows}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            required={required}
            maxLength={maxLength}
            disabled={disabled}
            placeholder={placeholder}
            className="quiz-rich-textarea"
          />
        )}

        <div className="quiz-rich-footer">
          <div className="quiz-rich-help">
            {helpText || (
              <span className="quiz-rich-hint">
                <UiText>{"Gunakan tombol di toolbar untuk rumus atau notasi ilmiah (² ₂ √ π dll)."}</UiText>
              </span>
            )}
          </div>
          <span className="quiz-char-counter">
            {value.length} / {maxLength}
          </span>
        </div>
      </div>
    </div>
  );
}

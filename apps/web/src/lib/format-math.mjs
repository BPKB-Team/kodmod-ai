/**
 * Mathematical & Subscript / Superscript Formatter for KODMOD
 * Renders mathematical expressions, formulas, subscripts and superscripts visually
 * while maintaining accessible spoken labels for screen readers and TTS.
 */

import { normalizeSpeechText } from "./speech-text-normalizer.mjs";

const SUP_MAP = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
  "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
  "⁺": "+", "⁻": "−", "ⁿ": "n", "ˣ": "x", "ʸ": "y", "ᵃ": "a", "ᵇ": "b", "ᵐ": "m",
};

const SUB_MAP = {
  "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4",
  "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
  "₊": "+", "₋": "−", "ₐ": "a", "ₑ": "e", "ₒ": "o", "ₓ": "x",
};

const LATEX_SYMBOLS = {
  "\\times": "×",
  "\\cdot": "·",
  "\\div": "÷",
  "\\pm": "±",
  "\\neq": "≠",
  "\\leq": "≤",
  "\\le": "≤",
  "\\geq": "≥",
  "\\ge": "≥",
  "\\approx": "≈",
  "\\pi": "π",
  "\\alpha": "α",
  "\\beta": "β",
  "\\gamma": "γ",
  "\\theta": "θ",
  "\\infty": "∞",
  "\\to": "→",
};

function formatMathInside(content) {
  let s = content.trim();

  // Strip LaTeX text formatting macros
  s = s.replace(/\\(?:text|mathrm|mathbf|mathit|operatorname)\s*\{([^{}]*)\}/g, "$1");

  // Replace LaTeX symbol macros
  for (const [cmd, sym] of Object.entries(LATEX_SYMBOLS)) {
    s = s.replaceAll(cmd, ` ${sym} `);
  }

  // Indonesian verbal math expressions
  s = s.replace(/\bsama dengan\b/gi, " = ");
  s = s.replace(/\btidak sama dengan\b/gi, " ≠ ");
  s = s.replace(/\bkurang dari atau sama dengan\b/gi, " ≤ ");
  s = s.replace(/\blebih dari atau sama dengan\b/gi, " ≥ ");
  s = s.replace(/\bkurang dari\b/gi, " < ");
  s = s.replace(/\blebih dari\b/gi, " > ");
  s = s.replace(/\bkali\b/gi, " × ");
  s = s.replace(/\bdibagi\b/gi, " ÷ ");
  s = s.replace(/\btambah\b/gi, " + ");
  s = s.replace(/\bkurang\b/gi, " − ");

  // Powers: verbal ('2 pangkat x') and caret ('2^x', '2^{x}')
  s = s.replace(/([a-zA-Z0-9\)]+)\s+pangkat\s+(\(?[a-zA-Z0-9+\-]+\)?|\{[^{}]+\})/gi, (_m, b, exp) => {
    const cleanExp = exp.replace(/^[\({]|[\)}]$/g, "").trim();
    return `${b}<sup>${cleanExp}</sup>`;
  });
  s = s.replace(/([a-zA-Z0-9\)]+)\^(\{([^{}]+)\}|([a-zA-Z0-9+\-]+))/gi, (_m, b, _c, cExp, sExp) => {
    return `${b}<sup>${cExp || sExp}</sup>`;
  });

  // Subscripts: verbal ('x subskrip 1') and underscore ('x_1', 'x_{1}')
  s = s.replace(/([a-zA-Z0-9\)]+)\s+subskrip\s+(\(?[a-zA-Z0-9+\-]+\)?|\{[^{}]+\})/gi, (_m, b, sub) => {
    const cleanSub = sub.replace(/^[\({]|[\)}]$/g, "").trim();
    return `${b}<sub>${cleanSub}</sub>`;
  });
  s = s.replace(/([a-zA-Z0-9\)]+)_(\{([^{}]+)\}|([0-9a-zA-Z]+))/gi, (_m, b, _c, cSub, sSub) => {
    return `${b}<sub>${cSub || sSub}</sub>`;
  });

  // Fractions
  s = s.replace(
    /\\(?:dfrac|tfrac|frac)\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g,
    '<span class="math-frac"><span class="math-frac-num">$1</span><span class="math-frac-den">$2</span></span>'
  );

  // Roots
  s = s.replace(/\\sqrt\s*\[([^\]]+)\]\s*\{([^{}]+)\}/g, "<sup>$1</sup>√($2)");
  s = s.replace(/\\sqrt\s*\{([^{}]+)\}/g, "√($1)");

  // Clean unneeded braces and backslashes
  s = s.replace(/[{}]/g, "");
  s = s.replace(/\\([,;:!])/g, " ");
  s = s.replace(/\\/g, "");

  // Italicize single math variables outside tags (e.g. x, f, y)
  s = s.replace(/(?<!<[^>]*)\b([a-zA-Z])\b(?![^<]*>)/g, "<var>$1</var>");

  return s.replace(/\s+/g, " ").trim();
}

/**
 * Formats a text containing math, exponents, and subscripts into accessible HTML
 */
export function formatHtmlMath(text, language = "id") {
  if (!text || typeof text !== "string") return "";

  const placeholders = [];
  let out = text;

  // 1. Display math blocks: \\[ ... \\] or $$ ... $$
  out = out.replace(/\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$/g, (_match, p1, p2) => {
    const content = (p1 || p2).trim();
    const spoken = normalizeSpeechText(content, language).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    const innerHtml = formatMathInside(content);
    const rendered = `<span class="math-formula display-block" role="img" aria-label="${spoken.replace(/"/g, "&quot;")}"><span aria-hidden="true">${innerHtml}</span></span>`;
    const token = `:::KODMODMATHBLOCK${placeholders.length}:::`;
    placeholders.push({ token, rendered });
    return token;
  });

  // 2. Inline math: \\( ... \\) or $ ... $
  out = out.replace(/\\\(([\s\S]*?)\\\)|\$([^$\n]+)\$/g, (_match, p1, p2) => {
    const content = (p1 || p2).trim();
    const spoken = normalizeSpeechText(content, language).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    const innerHtml = formatMathInside(content);
    const rendered = `<span class="math-formula" role="img" aria-label="${spoken.replace(/"/g, "&quot;")}"><span aria-hidden="true">${innerHtml}</span></span>`;
    const token = `:::KODMODMATHINLINE${placeholders.length}:::`;
    placeholders.push({ token, rendered });
    return token;
  });

  // 3. Caret exponents outside delimiters: e.g. x^2, 2^x, 10^-3
  out = out.replace(/(?<=[a-zA-Z0-9\)])\^(\{([^{}]+)\}|([a-zA-Z0-9+\-]+))/g, (_m, _c, cExp, sExp) => {
    return `<sup>${cExp || sExp}</sup>`;
  });

  // 4. Underscore subscripts outside delimiters: e.g. x_1, H_2O, CO_2
  out = out.replace(/(?<=[a-zA-Z0-9\)])_(\{([^{}]+)\}|([0-9]+))/g, (_m, _c, cSub, sSub) => {
    return `<sub>${cSub || sSub}</sub>`;
  });

  // 5. Unicode superscripts outside delimiters: e.g. x², 3⁴
  out = out.replace(/([a-zA-Z0-9\)])([⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻ⁿˣʸᵃᵇᵐ]+)/g, (_m, b, sup) => {
    const val = Array.from(sup).map((c) => SUP_MAP[c] || c).join("");
    return `${b}<sup>${val}</sup>`;
  });

  // 6. Unicode subscripts outside delimiters: e.g. H₂O, CO₂, x₁
  out = out.replace(/([a-zA-Z0-9\)])([₀₁₂₃₄₅₆₇₈₉₊₋ₐₑₒₓ]+)/g, (_m, b, sub) => {
    const val = Array.from(sub).map((c) => SUB_MAP[c] || c).join("");
    return `${b}<sub>${val}</sub>`;
  });

  // 7. Verbal powers outside delimiters: e.g. '2 pangkat x', '3 pangkat 4'
  out = out.replace(/(?<=\b[0-9a-zA-Z]|\))\s+pangkat\s+([0-9a-zA-Z+\-]+)/gi, (_m, exp) => {
    return `<sup>${exp}</sup>`;
  });

  // 8. Verbal subscripts outside delimiters: e.g. 'x subskrip 1'
  out = out.replace(/(?<=\b[0-9a-zA-Z]|\))\s+subskrip\s+([0-9a-zA-Z+\-]+)/gi, (_m, sub) => {
    return `<sub>${sub}</sub>`;
  });

  // Restore placeholders
  for (const { token, rendered } of placeholders) {
    out = out.replace(token, rendered);
  }

  return out;
}

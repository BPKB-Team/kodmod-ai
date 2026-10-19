/**
 * Speech Text Normalizer for KODMOD AI
 *
 * Translates mathematical notation, superscripts (powers/exponents),
 * subscripts (indices, chemical formulas), arithmetic operators,
 * roots, fractions, and symbols into natural, audio-friendly spoken words
 * tailored for visually impaired and blind students.
 */

const SUPERSCRIPTS: Record<string, string> = {
  "⁰": "0",
  "¹": "1",
  "²": "2",
  "³": "3",
  "⁴": "4",
  "⁵": "5",
  "⁶": "6",
  "⁷": "7",
  "⁸": "8",
  "⁹": "9",
  "⁺": " tambah ",
  "⁻": " minus ",
  "ⁿ": "n",
  "ˣ": "x",
  "ʸ": "y",
  "ᵃ": "a",
  "ᵇ": "b",
  "ᵐ": "m",
};

const SUBSCRIPTS: Record<string, string> = {
  "₀": "0",
  "₁": "1",
  "₂": "2",
  "₃": "3",
  "₄": "4",
  "₅": "5",
  "₆": "6",
  "₇": "7",
  "₈": "8",
  "₉": "9",
  "₊": " tambah ",
  "₋": " minus ",
  "ₐ": "a",
  "ₑ": "e",
  "ₒ": "o",
  "ₓ": "x",
};

const VULGAR_FRACTIONS: Record<string, { id: string; en: string }> = {
  "½": { id: "satu per dua", en: "one half" },
  "⅓": { id: "satu per tiga", en: "one third" },
  "¼": { id: "satu per empat", en: "one quarter" },
  "¾": { id: "tiga per empat", en: "three quarters" },
  "⅔": { id: "dua per tiga", en: "two thirds" },
  "⅕": { id: "satu per lima", en: "one fifth" },
  "⅖": { id: "dua per lima", en: "two fifths" },
  "⅗": { id: "tiga per lima", en: "three fifths" },
  "⅘": { id: "empat per lima", en: "four fifths" },
  "⅙": { id: "satu per enam", en: "one sixth" },
  "⅚": { id: "lima per enam", en: "five sixths" },
  "⅛": { id: "satu per delapan", en: "one eighth" },
  "⅜": { id: "tiga per delapan", en: "three eighths" },
  "⅝": { id: "lima per delapan", en: "five eighths" },
  "⅞": { id: "tujuh per delapan", en: "seven eighths" },
};

function mapSuperString(raw: string): string {
  let result = "";
  for (const char of raw) {
    result += SUPERSCRIPTS[char] ?? char;
  }
  return result.trim().replace(/\s+/g, " ");
}

function mapSubString(raw: string): string {
  let result = "";
  for (const char of raw) {
    result += SUBSCRIPTS[char] ?? char;
  }
  return result.trim().replace(/\s+/g, " ");
}

/**
 * Normalizes text for speech synthesis so math notation, exponents,
 * subscripts, and operators are read correctly aloud.
 */
export function normalizeSpeechText(text: string, language: "id" | "en" = "id"): string {
  if (!text || typeof text !== "string") return "";

  const isEn = language === "en";
  let out = text;

  // 1. Vulgar fractions: ½, ⅓, ¼, ¾, etc.
  for (const [char, labels] of Object.entries(VULGAR_FRACTIONS)) {
    if (out.includes(char)) {
      out = out.replaceAll(char, ` ${isEn ? labels.en : labels.id} `);
    }
  }

  // 2. Fractions formatted like 3/4 or 1/2 (avoiding dates like 19/10/2026)
  out = out.replace(/(?<!\/|\d)\b(\d{1,4})\/(\d{1,4})\b(?!\/|\d)/g, (_match, num, den) => {
    return isEn ? `${num} over ${den}` : `${num} per ${den}`;
  });

  // 3. Superscripts / Exponents (e.g. 3⁴, 9², x³, (3²)²)
  const superRegex = /([a-zA-Z0-9\)]|\])([⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻ⁿˣʸᵃᵇᵐ]+)/g;
  out = out.replace(superRegex, (_match, base, sup) => {
    const val = mapSuperString(sup);
    return isEn ? `${base} to the power of ${val}` : `${base} pangkat ${val}`;
  });

  // Standalone superscripts not directly attached
  const standaloneSuper = /([⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻ⁿˣʸᵃᵇᵐ]+)/g;
  out = out.replace(standaloneSuper, (_match, sup) => {
    const val = mapSuperString(sup);
    return isEn ? ` to the power of ${val} ` : ` pangkat ${val} `;
  });

  // 4. Caret exponent notation (e.g. 3^4, x^2, 10^-3)
  const caretRegex = /([a-zA-Z0-9\)]|\])\^(\(?[+-]?[a-zA-Z0-9]+\)?)/g;
  out = out.replace(caretRegex, (_match, base, exp) => {
    let cleanExp = exp.replace(/^\(|\)$/g, "").trim();
    if (cleanExp.startsWith("-")) {
      cleanExp = isEn ? `minus ${cleanExp.slice(1)}` : `minus ${cleanExp.slice(1)}`;
    }
    return isEn ? `${base} to the power of ${cleanExp}` : `${base} pangkat ${cleanExp}`;
  });

  // 5. Subscripts (e.g. x₁, x₂, H₂O, CO₂)
  const subRegex = /([a-zA-Z0-9\)]|\])([₀₁₂₃₄₅₆₇₈₉₊₋ₐₑₒₓ]+)/g;
  out = out.replace(subRegex, (_match, base, sub) => {
    const val = mapSubString(sub);
    return `${base} ${val} `;
  });

  // 6. Roots (Akar)
  out = out.replace(/∜\s*([0-9a-zA-Z]+|\([^)]+\))/g, isEn ? "fourth root of $1 " : "akar pangkat 4 dari $1 ");
  out = out.replace(/∛\s*([0-9a-zA-Z]+|\([^)]+\))/g, isEn ? "cube root of $1 " : "akar pangkat 3 dari $1 ");
  out = out.replace(/√\s*\(([^)]+)\)/g, isEn ? "square root of ($1) " : "akar dari ($1) ");
  out = out.replace(/√\s*([0-9a-zA-Z]+)/g, isEn ? "square root of $1 " : "akar $1 ");

  // 7. Math Operators & Relations
  // Multiplication: × (U+00D7) and middle dots
  out = out.replace(/\s*×\s*/g, isEn ? " times " : " kali ");
  out = out.replace(/(?<=[0-9a-zA-Z\)])\s*[⋅·]\s*(?=[0-9a-zA-Z\(])/g, isEn ? " times " : " kali ");

  // Division: ÷ (U+00F7)
  out = out.replace(/\s*÷\s*/g, isEn ? " divided by " : " dibagi ");

  // Plus-minus: ±
  out = out.replace(/\s*±\s*/g, isEn ? " plus or minus " : " plus minus ");

  // Inequalities: ≠, ≈, ≤, ≥
  out = out.replace(/\s*≠\s*/g, isEn ? " does not equal " : " tidak sama dengan ");
  out = out.replace(/\s*≈\s*/g, isEn ? " approximately equals " : " kira-kira sama dengan ");
  out = out.replace(/\s*≤\s*/g, isEn ? " less than or equal to " : " kurang dari atau sama dengan ");
  out = out.replace(/\s*≥\s*/g, isEn ? " greater than or equal to " : " lebih dari atau sama dengan ");

  // Relational < and > in mathematical context (e.g. x < 5, a > b)
  out = out.replace(/(?<=[0-9a-zA-Z\)])\s*<\s*(?=[0-9a-zA-Z\(\-])/g, isEn ? " less than " : " kurang dari ");
  out = out.replace(/(?<=[0-9a-zA-Z\)])\s*>\s*(?=[0-9a-zA-Z\(\-])/g, isEn ? " greater than " : " lebih dari ");

  // Equals = in math expressions (e.g. 9 = 3², x + 2 = 5)
  out = out.replace(/(?<=[0-9a-zA-Z\)\%])\s*=\s*(?=[0-9a-zA-Z\(\-\+√])/g, isEn ? " equals " : " sama dengan ");

  // Negative numbers with unary minus (e.g. -3, (-5))
  out = out.replace(/(?<=[=+\(×÷\s]|^)-(\d+)\b/g, isEn ? " minus $1" : " minus $1");

  // Percent, Degrees, Celsius
  out = out.replace(/(?<=\d)\s*%/g, isEn ? " percent" : " persen");
  out = out.replace(/(?<=\d)\s*°\s*C\b/g, isEn ? " degrees Celsius" : " derajat Celsius");
  out = out.replace(/(?<=\d)\s*°(?!\s*C)/g, isEn ? " degrees" : " derajat");

  // Cleanup redundant spaces before punctuation
  out = out.replace(/\s+([,.:;?!])/g, "$1");
  out = out.replace(/([,.:;?!])(?=[^\s,.:;?!])/g, "$1 ");
  out = out.replace(/\s{2,}/g, " ").trim();

  return out;
}

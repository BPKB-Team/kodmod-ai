/**
 * Speech Text Normalizer for KODMOD AI (ESM module)
 */

const SUPERSCRIPTS = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
  "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
  "⁺": " tambah ", "⁻": " minus ",
  "ⁿ": "n", "ˣ": "x", "ʸ": "y", "ᵃ": "a", "ᵇ": "b", "ᵐ": "m",
};

const SUBSCRIPTS = {
  "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4",
  "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
  "₊": " tambah ", "₋": " minus ",
  "ₐ": "a", "ₑ": "e", "ₒ": "o", "ₓ": "x",
};

const ORDINALS_ID = {
  "1": "Pertama",
  "2": "Kedua",
  "3": "Ketiga",
  "4": "Keempat",
  "5": "Kelima",
  "6": "Keenam",
  "7": "Ketujuh",
  "8": "Kedelapan",
  "9": "Kesembilan",
  "10": "Kesepuluh",
};

const ORDINALS_EN = {
  "1": "First",
  "2": "Second",
  "3": "Third",
  "4": "Fourth",
  "5": "Fifth",
  "6": "Sixth",
  "7": "Seventh",
  "8": "Eighth",
  "9": "Ninth",
  "10": "Tenth",
};

const VULGAR_FRACTIONS = {
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

function mapSuperString(raw) {
  let result = "";
  for (const char of raw) {
    result += SUPERSCRIPTS[char] ?? char;
  }
  return result.trim().replace(/\s+/g, " ");
}

function mapSubString(raw) {
  let result = "";
  for (const char of raw) {
    result += SUBSCRIPTS[char] ?? char;
  }
  return result.trim().replace(/\s+/g, " ");
}

export function normalizeSpeechText(text, language = "id") {
  if (!text || typeof text !== "string") return "";

  const isEn = language === "en";
  let out = text;

  // 1. Vulgar fractions: ½, ⅓, ¼, ¾, etc.
  for (const [char, labels] of Object.entries(VULGAR_FRACTIONS)) {
    if (out.includes(char)) {
      out = out.replaceAll(char, ` ${isEn ? labels.en : labels.id} `);
    }
  }

  // 2. Fractions formatted like 3/4 or 1/2
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
  out = out.replace(/\s*×\s*/g, isEn ? " times " : " kali ");
  out = out.replace(/(?<=[0-9a-zA-Z\)])\s*[⋅·]\s*(?=[0-9a-zA-Z\(])/g, isEn ? " times " : " kali ");
  out = out.replace(/\s*÷\s*/g, isEn ? " divided by " : " dibagi ");
  out = out.replace(/\s*±\s*/g, isEn ? " plus or minus " : " plus minus ");
  out = out.replace(/\s*≠\s*/g, isEn ? " does not equal " : " tidak sama dengan ");
  out = out.replace(/\s*≈\s*/g, isEn ? " approximately equals " : " kira-kira sama dengan ");
  out = out.replace(/\s*≤\s*/g, isEn ? " less than or equal to " : " kurang dari atau sama dengan ");
  out = out.replace(/\s*≥\s*/g, isEn ? " greater than or equal to " : " lebih dari atau sama dengan ");
  out = out.replace(/(?<=[0-9a-zA-Z\)])\s*<\s*(?=[0-9a-zA-Z\(\-])/g, isEn ? " less than " : " kurang dari ");
  out = out.replace(/(?<=[0-9a-zA-Z\)])\s*>\s*(?=[0-9a-zA-Z\(\-])/g, isEn ? " greater than " : " lebih dari ");
  out = out.replace(/(?<=[0-9a-zA-Z\)\%])\s*=\s*(?=[0-9a-zA-Z\(\-\+√])/g, isEn ? " equals " : " sama dengan ");
  out = out.replace(/(?<=[=+\(×÷\s]|^)-(\d+)\b/g, isEn ? " minus $1" : " minus $1");

  // Percent, Degrees
  out = out.replace(/(?<=\d)\s*%/g, isEn ? " percent" : " persen");
  out = out.replace(/(?<=\d)\s*°\s*C\b/g, isEn ? " degrees Celsius" : " derajat Celsius");
  out = out.replace(/(?<=\d)\s*°(?!\s*C)/g, isEn ? " degrees" : " derajat");

  // 8. Numbered lists (e.g. " 1. ", " 2. ") -> natural spoken transitions ("Pertama, ", "Kedua, ")
  out = out.replace(/(?:(?<=[\n.!?:]\s*)|^)(\d{1,2})[\.)]\s+/g, (_match, num) => {
    const word = isEn ? (ORDINALS_EN[num] ?? `Step ${num}`) : (ORDINALS_ID[num] ?? `Langkah ${num}`);
    return ` ${word}, `;
  });

  // 9. Natural spoken ratios (e.g. "Bagian 4 / 19" -> "Bagian 4 dari 19")
  out = out.replace(/(\bBagian\s+\d+)\s*\/\s*(\d+\b)/gi, "$1 dari $2");

  // 10. Strip visual markdown bullets so TTS doesn't utter punctuation marks
  out = out.replace(/(?:^|\n)\s*[-*•·]\s+/g, "\n");

  // Punctuation cleanup
  out = out.replace(/\s+([,.:;?!])/g, "$1");
  out = out.replace(/([,.:;?!])(?=[^\s,.:;?!])/g, "$1 ");
  out = out.replace(/\s{2,}/g, " ").trim();

  return out;
}

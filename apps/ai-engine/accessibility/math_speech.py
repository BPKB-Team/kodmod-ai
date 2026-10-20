"""KODMOD AI - Mathematical Speech Normalizer
================================================

Translates mathematical expressions, superscripts (exponents/powers),
subscripts (indices, chemical formulas), fractions, roots, and operators
into spoken-friendly words for blind and visually impaired students.
"""

from __future__ import annotations

import re

SUPERSCRIPTS = {
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
}

SUBSCRIPTS = {
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
}

VULGAR_FRACTIONS = {
    "½": ("satu per dua", "one half"),
    "⅓": ("satu per tiga", "one third"),
    "¼": ("satu per empat", "one quarter"),
    "¾": ("tiga per empat", "three quarters"),
    "⅔": ("dua per tiga", "two thirds"),
    "⅕": ("satu per lima", "one fifth"),
    "⅖": ("dua per lima", "two fifths"),
    "⅗": ("tiga per lima", "three fifths"),
    "⅘": ("empat per lima", "four fifths"),
    "⅙": ("satu per enam", "one sixth"),
    "⅚": ("lima per enam", "five sixths"),
    "⅛": ("satu per delapan", "one eighth"),
    "⅜": ("tiga per delapan", "three eighths"),
    "⅝": ("lima per delapan", "five eighths"),
    "⅞": ("tujuh per delapan", "seven eighths"),
}

ORDINALS_ID = {
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
}

ORDINALS_EN = {
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
}


def _map_super(match: re.Match) -> str:
    chars = match.group(0)
    return "".join(SUPERSCRIPTS.get(c, c) for c in chars).strip()


def _map_sub(match: re.Match) -> str:
    chars = match.group(0)
    return "".join(SUBSCRIPTS.get(c, c) for c in chars).strip()


def normalize_math_speech(text: str, language: str = "id") -> str:
    """Normalize mathematical symbols, powers, and subscripts to spoken language."""
    if not text:
        return text

    is_en = language == "en"
    out = text

    # 1. Vulgar fractions
    for char, (id_label, en_label) in VULGAR_FRACTIONS.items():
        if char in out:
            out = out.replace(char, f" {en_label if is_en else id_label} ")

    # 2. Fractions formatted as 3/4 or 1/2
    def _fraction_sub(m: re.Match) -> str:
        num, den = m.group(1), m.group(2)
        return f"{num} over {den}" if is_en else f"{num} per {den}"

    out = re.sub(r"(?<!\/|\d)\b(\d{1,4})\/(\d{1,4})\b(?!\/|\d)", _fraction_sub, out)

    # 3. Superscripts (e.g. 3⁴, 9², 3⁸, (3²)², x²)
    def _super_sub(m: re.Match) -> str:
        base = m.group(1)
        raw_exp = m.group(2)
        exp = "".join(SUPERSCRIPTS.get(c, c) for c in raw_exp).strip()
        return f"{base} to the power of {exp}" if is_en else f"{base} pangkat {exp}"

    out = re.sub(r"([a-zA-Z0-9\)]|\])([⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻ⁿˣʸᵃᵇᵐ]+)", _super_sub, out)

    # Standalone superscripts
    def _standalone_super(m: re.Match) -> str:
        raw_exp = m.group(1)
        exp = "".join(SUPERSCRIPTS.get(c, c) for c in raw_exp).strip()
        return f" to the power of {exp} " if is_en else f" pangkat {exp} "

    out = re.sub(r"([⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻ⁿˣʸᵃᵇᵐ]+)", _standalone_super, out)

    # 4. Caret exponent notation (e.g. 3^4, x^2, 10^-3)
    def _caret_sub(m: re.Match) -> str:
        base = m.group(1)
        exp = m.group(2).strip("()").strip()
        if exp.startswith("-"):
            exp = f"minus {exp[1:]}"
        return f"{base} to the power of {exp}" if is_en else f"{base} pangkat {exp}"

    out = re.sub(r"([a-zA-Z0-9\)]|\])\^(\(?[+-]?[a-zA-Z0-9]+\)?)", _caret_sub, out)

    # 5. Subscripts (e.g. x₁, x₂, H₂O, CO₂)
    def _sub_sub(m: re.Match) -> str:
        base = m.group(1)
        raw_sub = m.group(2)
        val = "".join(SUBSCRIPTS.get(c, c) for c in raw_sub).strip()
        return f"{base} {val} "

    out = re.sub(r"([a-zA-Z0-9\)]|\])([₀₁₂₃₄₅₆₇₈₉₊₋ₐₑₒₓ]+)", _sub_sub, out)

    # 6. Roots (Akar)
    out = re.sub(
        r"∜\s*([0-9a-zA-Z]+|\([^)]+\))",
        r"fourth root of \1 " if is_en else r"akar pangkat 4 dari \1 ",
        out,
    )
    out = re.sub(
        r"∛\s*([0-9a-zA-Z]+|\([^)]+\))",
        r"cube root of \1 " if is_en else r"akar pangkat 3 dari \1 ",
        out,
    )
    out = re.sub(
        r"√\s*\(([^)]+)\)",
        r"square root of (\1) " if is_en else r"akar dari (\1) ",
        out,
    )
    out = re.sub(
        r"√\s*([0-9a-zA-Z]+)",
        r"square root of \1 " if is_en else r"akar \1 ",
        out,
    )

    # 7. Math Operators & Relations
    out = re.sub(r"\s*×\s*", " times " if is_en else " kali ", out)
    out = re.sub(
        r"(?<=[0-9a-zA-Z\)])\s*[⋅·]\s*(?=[0-9a-zA-Z\(])",
        " times " if is_en else " kali ",
        out,
    )
    out = re.sub(r"\s*÷\s*", " divided by " if is_en else " dibagi ", out)
    out = re.sub(r"\s*±\s*", " plus or minus " if is_en else " plus minus ", out)
    out = re.sub(r"\s*≠\s*", " does not equal " if is_en else " tidak sama dengan ", out)
    out = re.sub(r"\s*≈\s*", " approximately equals " if is_en else " kira-kira sama dengan ", out)
    out = re.sub(
        r"\s*≤\s*",
        " less than or equal to " if is_en else " kurang dari atau sama dengan ",
        out,
    )
    out = re.sub(
        r"\s*≥\s*",
        " greater than or equal to " if is_en else " lebih dari atau sama dengan ",
        out,
    )
    out = re.sub(
        r"(?<=[0-9a-zA-Z\)])\s*<\s*(?=[0-9a-zA-Z\(\-])",
        " less than " if is_en else " kurang dari ",
        out,
    )
    out = re.sub(
        r"(?<=[0-9a-zA-Z\)])\s*>\s*(?=[0-9a-zA-Z\(\-])",
        " greater than " if is_en else " lebih dari ",
        out,
    )
    out = re.sub(
        r"(?<=[0-9a-zA-Z\)\%])\s*=\s*(?=[0-9a-zA-Z\(\-\+√])",
        " equals " if is_en else " sama dengan ",
        out,
    )
    out = re.sub(r"(?:(?<=[=+\(×÷\s])|^)-(\d+)\b", r" minus \1", out)

    # Units
    out = re.sub(r"(?<=\d)\s*%", " percent" if is_en else " persen", out)
    out = re.sub(r"(?<=\d)\s*°\s*C\b", " degrees Celsius" if is_en else " derajat Celsius", out)
    out = re.sub(r"(?<=\d)\s*°(?!\s*C)", " degrees" if is_en else " derajat", out)

    # 8. Numbered lists (e.g. " 1. ", " 2. ") -> natural spoken transitions ("Pertama, ", "Kedua, ")
    def _ordinal_sub(m: re.Match) -> str:
        num = m.group(1)
        word = (
            ORDINALS_EN.get(num, f"Step {num}") if is_en else ORDINALS_ID.get(num, f"Langkah {num}")
        )
        return f"{word}, "

    out = re.sub(r"(?:(?<=[\n.!?:]\s)|(?<=[\n.!?:])|^)(\d{1,2})[\.)]\s+", _ordinal_sub, out)

    # 9. Natural spoken ratios (e.g. "Bagian 4 / 19" -> "Bagian 4 dari 19")
    out = re.sub(r"(\bBagian\s+\d+)\s*\/\s*(\d+\b)", r"\1 dari \2", out, flags=re.IGNORECASE)

    # 10. Strip visual markdown bullets
    out = re.sub(r"(?:^|\n)\s*[-*•·]\s+", "\n", out)

    # Punctuation spacing cleanup
    out = re.sub(r"[^\S\r\n]+([,.:;?!])", r"\1", out)
    out = re.sub(r"([,.:;?!])(?=[^\s,.:;?!])", r"\1 ", out)
    out = re.sub(r"[^\S\r\n]{2,}", " ", out)
    out = re.sub(r"\n{3,}", "\n\n", out).strip()

    return out

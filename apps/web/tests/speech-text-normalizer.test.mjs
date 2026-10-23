import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSpeechText } from "../src/lib/speech-text-normalizer.mjs";

test("converts superscripts and exponents into spoken words", () => {
  assert.equal(normalizeSpeechText("3⁴"), "3 pangkat 4");
  assert.equal(normalizeSpeechText("9²"), "9 pangkat 2");
  assert.equal(normalizeSpeechText("3⁸"), "3 pangkat 8");
  assert.equal(normalizeSpeechText("(3²)²"), "(3 pangkat 2) pangkat 2");
  assert.equal(normalizeSpeechText("x²"), "x pangkat 2");
  assert.equal(normalizeSpeechText("10⁻³"), "10 pangkat minus 3");
  assert.equal(normalizeSpeechText("2ⁿ⁺¹"), "2 pangkat n tambah 1");
  assert.equal(normalizeSpeechText("3^4"), "3 pangkat 4");
  assert.equal(normalizeSpeechText("10^-5"), "10 pangkat minus 5");
});

test("converts multiplication, division, and equality signs in math equations", () => {
  assert.equal(normalizeSpeechText("3⁴ × 9²"), "3 pangkat 4 kali 9 pangkat 2");
  assert.equal(normalizeSpeechText("9 = 3²"), "9 sama dengan 3 pangkat 2");
  assert.equal(normalizeSpeechText("3⁴ × 3⁴ = 3⁸"), "3 pangkat 4 kali 3 pangkat 4 sama dengan 3 pangkat 8");
  assert.equal(normalizeSpeechText("12 ÷ 4 = 3"), "12 dibagi 4 sama dengan 3");
  assert.equal(normalizeSpeechText("3 + 4 = 7"), "3 ditambah 4 sama dengan 7");
  assert.equal(normalizeSpeechText("9 - 4 = 5"), "9 dikurangi 4 sama dengan 5");
});

test("normalizes exact text from user lesson screenshot without 34/92 mispronunciation", () => {
  const original = "Karena bilangan pokoknya berbeda, samakan dulu bilangan pokoknya. Pada contohmu, 9 = 3², jadi: 3⁴ × 9² = 3⁴ × (3²)² = 3⁴ × 3⁴. Sekarang bilangan pokoknya sama, sehingga pangkat dijumlahkan: 3⁴ × 3⁴ = 3⁸. Jadi, hasilnya 3⁸, atau 6561. Sifat pada bagian ini menjumlahkan pangkat jika bilangan pokoknya sama.";

  const normalized = normalizeSpeechText(original, "id");

  // Must not have raw 3⁴, 9², 3², 3⁸
  assert.ok(!normalized.includes("3⁴"));
  assert.ok(!normalized.includes("9²"));
  assert.ok(!normalized.includes("3²"));
  assert.ok(!normalized.includes("3⁸"));
  assert.ok(!normalized.includes("×"));

  // Must have spoken pangkat and kali and sama dengan
  assert.ok(normalized.includes("9 sama dengan 3 pangkat 2"));
  assert.ok(normalized.includes("3 pangkat 4 kali 9 pangkat 2"));
  assert.ok(normalized.includes("(3 pangkat 2) pangkat 2"));
  assert.ok(normalized.includes("3 pangkat 4 kali 3 pangkat 4 sama dengan 3 pangkat 8"));
  assert.ok(normalized.includes("hasilnya 3 pangkat 8, atau 6561"));
});

test("converts subscripts, fractions, roots, and percent", () => {
  assert.equal(normalizeSpeechText("H₂O"), "H 2 O");
  assert.equal(normalizeSpeechText("x₁ + x₂"), "x 1 ditambah x 2");
  assert.equal(normalizeSpeechText("½ dan ¾"), "satu per dua dan tiga per empat");
  assert.equal(normalizeSpeechText("3/4 dari siswa"), "3 per 4 dari siswa");
  assert.equal(normalizeSpeechText("√16 = 4"), "akar 16 sama dengan 4");
  assert.equal(normalizeSpeechText("100%"), "100 persen");
  assert.equal(normalizeSpeechText("30°C"), "30 derajat Celsius");
});

test("supports English translation when language is en", () => {
  assert.equal(normalizeSpeechText("3⁴ × 9² = 3⁸", "en"), "3 to the power of 4 times 9 to the power of 2 equals 3 to the power of 8");
});

test("translates numbered list items in quiz completion response into spoken ordinals", () => {
  const popupText = "Latihan selesai. Nilai latihanmu 55 persen. Ada dua langkah ringan yang bisa membantumu makin mantap. 1. Kamu sudah berusaha dengan baik. Coba latihan garis bilangan untuk perubahan suhu dan pengurangan bilangan negatif. 2. Saat menghitung, kamu bisa tandai suhu awal dan arah perubahannya di garis bilangan.";
  const spoken = normalizeSpeechText(popupText, "id");

  // Must not have raw "1. " or "2. " that cause "satu titik" or "dua titik"
  assert.ok(!spoken.includes("1. "));
  assert.ok(!spoken.includes("2. "));
  assert.ok(spoken.includes("Pertama, Kamu sudah berusaha"));
  assert.ok(spoken.includes("Kedua, Saat menghitung"));
});

test("cleans generated markdown and LaTeX into natural Indonesian speech", () => {
  const generated = "# Ringkasan **pecahan**\n\n1. Gunakan `3/4` dari 24 benda.\n2. Hasilnya 18, atau 75%.\n\nRumus: $\\frac{1}{2} \\times 8 = 4$.";
  const spoken = normalizeSpeechText(generated, "id");

  assert.equal(
    spoken,
    "Ringkasan pecahan Pertama, Gunakan 3 per 4 dari 24 benda. Kedua, Hasilnya 18, atau 75 persen. Rumus: 1 per 2 kali 8 sama dengan 4.",
  );
  assert.equal(normalizeSpeechText(spoken, "id"), spoken, "normalization must stay safe when the request crosses two app layers");
});

test("expands common Indonesian chat abbreviations and reads decimal digits clearly", () => {
  assert.equal(
    normalizeSpeechText("Pakai 3,14; yg lain dijelaskan dgn baik, dll.", "id"),
    "Pakai 3 koma 1 4; yang lain dijelaskan dengan baik, dan lain-lain.",
  );
  assert.equal(
    normalizeSpeechText("Use 3.14 and e.g. a fraction.", "en"),
    "Use 3 point 1 4 and for example a fraction.",
  );
  assert.equal(normalizeSpeechText("Nilainya 1.250,75 dari 2.000 siswa.", "id"), "Nilainya 1250 koma 7 5 dari 2000 siswa.");
  assert.equal(normalizeSpeechText("Nilainya 3.14.", "id"), "Nilainya 3 koma 1 4.");
});

test("speaks Indonesian product and file abbreviations as clear words", () => {
  const text = "Tutor AI KODMOD membaca berkas PDF dan DOCX melalui API.";
  const spoken = normalizeSpeechText(text, "id");
  assert.equal(spoken, "Tutor kecerdasan buatan Kodmod membaca berkas pe de ef dan dokumen Word melalui a pe i.");
  assert.equal(normalizeSpeechText(spoken, "id"), spoken);
  assert.equal(normalizeSpeechText("Biaya 1.250 USD, waktu 250 ms.", "id"), "Biaya 1250 dolar Amerika, waktu 250 milidetik.");
});

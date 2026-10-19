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
  assert.equal(normalizeSpeechText("x₁ + x₂"), "x 1 + x 2");
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


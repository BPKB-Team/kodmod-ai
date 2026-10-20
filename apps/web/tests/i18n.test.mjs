import assert from "node:assert/strict";
import test from "node:test";
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

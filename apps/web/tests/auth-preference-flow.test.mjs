// Real standalone Next server plus the isolated loopback API fixture.
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { DEFAULT_VOICE_SETTINGS } from "../src/lib/speech-preferences.mjs";
const origin = process.env.WEB_TEST_ORIGIN || "http://127.0.0.1:3110";
const api = process.env.API_FIXTURE_ORIGIN || "http://127.0.0.1:8119";

test("guest, signed-in and signed-out pages agree on language, voice switches and display", async () => {
  const identity = await fetch(`${api}/auth/me`, { headers: { Authorization: "Bearer fixture-test-student" } });
  assert.equal((await identity.json()).username, "siswa.test", "Requires the isolated fixture");
  const settings = { ...DEFAULT_VOICE_SETTINGS, engine: "device", menuEnabled: false,
    tutorEnabled: false, fontScale: "large", lowVision: true, highContrast: true };
  const display = { fontScale: "large", highContrast: true };
  const voiceCookie = `kodmod_voice=${encodeURIComponent(JSON.stringify(settings))}; kodmod_display=${encodeURIComponent(JSON.stringify(display))}`;
  async function page(path, language, signedIn = false) {
    const response = await fetch(origin + path, { headers: { Cookie:
      `kodmod_language=${language}; ${voiceCookie}${signedIn ? "; kodmod_session=fixture-test-student" : ""}` } });
    assert.equal(response.status, 200);
    const doc = new JSDOM(await response.text()).window.document;
    assert.equal(doc.documentElement.lang, language);
    assert.equal(doc.documentElement.dataset.textSize, "large");
    assert.equal(doc.documentElement.dataset.highContrast, "true");
    assert.equal(doc.querySelector(".sound-toggle")?.getAttribute("aria-pressed"), "false");
  }
  await page("/login", "en");
  await page("/student", "en", true);
  const changed = await fetch(origin + "/api/preferences/language", { method: "POST", headers: {
    Origin: origin, "Content-Type": "application/json",
    Cookie: `kodmod_session=fixture-test-student; kodmod_language=en; ${voiceCookie}`,
  }, body: JSON.stringify({ language: "id" }) });
  assert.equal(changed.status, 200);
  assert.match(changed.headers.get("set-cookie"), /kodmod_language=id;/);
  const account = await fetch(`${api}/auth/me`, { headers: { Authorization: "Bearer fixture-test-student" } });
  assert.equal((await account.json()).preferred_language, "id");
  await page("/student", "id", true);
  await page("/login?success=signed-out", "id");
});

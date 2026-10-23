import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

function browser(t) {
  const dom = new JSDOM("", { url: "https://kodmod.test" });
  const descriptors = new Map();
  for (const key of ["document", "localStorage", "location"]) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
  }
  t.after(() => {
    dom.window.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  return dom;
}

test("voice and display choices survive login/logout reloads and unavailable localStorage", async t => {
  browser(t);
  const first = await import("../src/lib/speech-preferences.mjs?before-login");
  const expected = { ...first.DEFAULT_VOICE_SETTINGS, engine: "device", menuEnabled: false,
    tutorEnabled: false, fontScale: "extra-large", lowVision: true, highContrast: true,
    spacious: true, reducedMotion: true, guidedNavigation: true };
  assert.equal(first.writeVoiceSettings(expected), true);
  assert.ok(document.cookie.includes(`${first.VOICE_SETTINGS_COOKIE}=`));
  for (const boundary of ["after-login", "after-logout"]) {
    const next = await import(`../src/lib/speech-preferences.mjs?${boundary}`);
    assert.deepEqual(next.parseVoiceSettings(next.readVoiceSettingsSnapshot()), expected);
  }
  Object.defineProperty(globalThis, "localStorage", { configurable: true,
    get() { throw new Error("Storage is unavailable"); } });
  const recovered = await import("../src/lib/speech-preferences.mjs?cookie-recovery");
  assert.deepEqual(recovered.parseVoiceSettings(recovered.readVoiceSettingsSnapshot()), expected);
  assert.ok(!document.cookie.includes("token") && !document.cookie.includes("user_id"));
});

test("old engine-only settings retain disabled sound and display choices instead of resetting onboarding", async t => {
  browser(t);
  for (const engine of ["off", "device"]) {
    localStorage.clear();
    localStorage.setItem("kodmod.speech-engine.v1", engine);
    document.cookie = `kodmod_display=${encodeURIComponent(JSON.stringify({ fontScale: "large", highContrast: true }))}; Path=/`;
    const migrated = await import(`../src/lib/speech-preferences.mjs?legacy-${engine}`);
    const result = migrated.parseVoiceSettings(migrated.readVoiceSettingsSnapshot());
    assert.equal(result.engine, engine);
    assert.equal(result.menuEnabled, engine !== "off");
    assert.equal(result.fontScale, "large");
    assert.equal(result.highContrast, true);
    assert.equal(result.tutorEnabled, true);
  }
});

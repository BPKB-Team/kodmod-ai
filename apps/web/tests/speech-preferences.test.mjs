import assert from "node:assert/strict";
import test from "node:test";

import {
  createSpeechAudioLoader,
  invalidateSpeechAudioCache,
  readSpeechEnginePreference,
  speechAudioCacheKey,
  writeSpeechEnginePreference,
} from "../src/lib/speech-preferences.mjs";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

test("speech engine preference defaults to unset and persists either choice", () => {
  const storage = memoryStorage();

  assert.equal(readSpeechEnginePreference(storage), null);
  writeSpeechEnginePreference(storage, "device");
  assert.equal(readSpeechEnginePreference(storage), "device");
  writeSpeechEnginePreference(storage, "app");
  assert.equal(readSpeechEnginePreference(storage), "app");
  writeSpeechEnginePreference(storage, "off");
  assert.equal(readSpeechEnginePreference(storage), "off");
});

test("a quota failure keeps the latest voice choice for this page instead of rereading stale storage", async (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor); else delete globalThis.localStorage; });
  const settings = await import("../src/lib/speech-preferences.mjs?quota-test");
  const old = JSON.stringify({ ...settings.DEFAULT_VOICE_SETTINGS, engine: "app" });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: () => old, setItem: () => { throw new Error("QuotaExceededError"); },
  } });
  assert.equal(settings.writeVoiceSettings({ ...settings.DEFAULT_VOICE_SETTINGS, engine: "device", menuEnabled: false }), false);
  assert.equal(settings.parseVoiceSettings(settings.readVoiceSettingsSnapshot()).engine, "device");
  assert.equal(settings.parseVoiceSettings(settings.readVoiceSettingsSnapshot()).menuEnabled, false);
});

test("changing the ElevenLabs voice profile invalidates previous cached audio", async () => {
  const key = await speechAudioCacheKey("Halo dunia!");

  assert.equal(await speechAudioCacheKey("Halo dunia!"), key);
  assert.notEqual(await speechAudioCacheKey("Halo", { language: "id", profile: "first", scope: "a" }),
    await speechAudioCacheKey("Halo", { language: "en", profile: "first", scope: "a" }));
  assert.notEqual(await speechAudioCacheKey("Halo", { language: "id", profile: "first", scope: "a" }),
    await speechAudioCacheKey("Halo", { language: "id", profile: "second", scope: "a" }));
  assert.notEqual(await speechAudioCacheKey("Halo", { language: "id", profile: "first", scope: "a" }),
    await speechAudioCacheKey("Halo", { language: "id", profile: "first", scope: "b" }));
});

test("speech audio loader reuses unexpired audio without calling TTS again", async () => {
  const saved = new Map();
  let requests = 0;
  const load = createSpeechAudioLoader({
    read: async (key) => saved.get(key) ?? null,
    write: async (key, entry) => saved.set(key, entry),
    fetchAudio: async () => {
      requests += 1;
      return new Blob(["audio"]);
    },
    now: () => 100,
  });

  const first = await load("  Halo dunia! ");
  const second = await load("Halo dunia!");

  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(requests, 1);
  assert.equal(await second.blob.text(), "audio");
});

test("speech audio loader requests fresh audio after an entry expires", async () => {
  const saved = new Map();
  let requests = 0;
  const load = createSpeechAudioLoader({
    read: async (key) => saved.get(key) ?? null,
    write: async (key, entry) => saved.set(key, entry),
    fetchAudio: async () => {
      requests += 1;
      return new Blob([`audio-${requests}`]);
    },
    now: () => 200,
    cacheTtlMs: 50,
  });

  await load("Halo dunia!");
  const key = [...saved.keys()][0];
  saved.set(key, { ...saved.get(key), expiresAt: 199 });
  const next = await load("Halo dunia!");

  assert.equal(next.cached, false);
  assert.equal(requests, 2);
});

test("concurrent requests for the same speech share one TTS call", async () => {
  let requests = 0;
  const load = createSpeechAudioLoader({
    read: async () => null,
    write: async () => {},
    fetchAudio: async () => {
      requests += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new Blob(["audio"]);
    },
  });

  const [first, second] = await Promise.all([load("Satu teks"), load(" Satu teks ")]);

  assert.equal(requests, 1);
  assert.equal(first.cached, false);
  assert.equal(second.cached, false);
  assert.equal(first.blob, second.blob);
});

test("clearing the cache prevents in-flight TTS from saving audio afterward", async () => {
  const writes = [];
  let resolveFetch;
  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const load = createSpeechAudioLoader({
    read: async () => null,
    write: async (...args) => writes.push(args),
    fetchAudio: async () => {
      markStarted();
      return new Promise((resolve) => {
        resolveFetch = resolve;
      });
    },
  });

  const pending = load("Audio yang sedang dibuat");
  await started;
  invalidateSpeechAudioCache();
  resolveFetch(new Blob(["audio"]));
  await pending;

  assert.equal(writes.length, 0);
});

export const SPEECH_ENGINE_PREFERENCE_KEY = "kodmod.speech-engine.v1";
export const SPEECH_AUDIO_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const VOICE_SETTINGS_KEY = "kodmod.voice-settings.v2";
export const VOICE_SETTINGS_COOKIE = "kodmod_voice";
export const DEFAULT_VOICE_SETTINGS = Object.freeze({ engine: "app", menuEnabled: true,
  tutorEnabled: true, lowVision: false, guidedNavigation: false, fontScale: "default",
  highContrast: false, spacious: false, reducedMotion: false });
export const DISPLAY_COOKIE = "kodmod_display";

export function parseDisplaySettings(value = {}) {
  if (!value || typeof value !== "object") value = {};
  const fontScale = ["default", "large", "extra-large"].includes(value.fontScale) ? value.fontScale : value.lowVision === true ? "large" : "default";
  return { fontScale, lowVision: fontScale !== "default", highContrast: value.highContrast === true,
    spacious: value.spacious === true, reducedMotion: value.reducedMotion === true };
}

const AUDIO_CACHE_VERSION = "kodmod-elevenlabs-v3";
const inFlightAudio = new Map();
let inMemoryPreference = null;
let cacheGeneration = 0;
let memorySettings = null;
let memorySettingsDirty = false;

export function readVoiceSettingsSnapshot() {
  if (memorySettingsDirty) return memorySettings;
  try {
    const saved = globalThis.localStorage?.getItem(VOICE_SETTINGS_KEY);
    if (parseVoiceSettings(saved)) return saved;
  } catch { /* Fall back to the same browser's cookie or in-memory settings. */ }
  if (memorySettings) return memorySettings;
  const cookie = readPreferenceCookie(VOICE_SETTINGS_COOKIE);
  if (parseVoiceSettings(cookie)) return cookie;
  // Older releases saved only this engine key. Preserve that explicit
  // choice instead of reopening onboarding with sound enabled by default.
  const legacy = readSpeechEnginePreference();
  if (legacy) {
    let display = {};
    try { display = JSON.parse(readPreferenceCookie(DISPLAY_COOKIE) ?? "{}"); } catch { /* Invalid cookie. */ }
    return JSON.stringify({ ...DEFAULT_VOICE_SETTINGS, ...parseDisplaySettings(display),
      engine: legacy, menuEnabled: legacy !== "off" });
  }
  return null;
}

function readPreferenceCookie(name) {
  try {
    const item = document.cookie.split(";").map(value => value.trim())
      .find(value => value.startsWith(`${name}=`));
    return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
  } catch { return null; }
}

export function parseVoiceSettings(snapshot) {
  try {
    const value = JSON.parse(snapshot);
    if (!value || !["app", "device", "off"].includes(value.engine)) return null;
    return { engine: value.engine,
      menuEnabled: typeof value.menuEnabled === "boolean" ? value.menuEnabled : (value.engine !== "off"),
      tutorEnabled: typeof value.tutorEnabled === "boolean" ? value.tutorEnabled : true,
      ...parseDisplaySettings(value), guidedNavigation: value.guidedNavigation === true };
  } catch { return null; }
}

export function writeVoiceSettings(value) {
  const parsed = parseVoiceSettings(JSON.stringify(value));
  if (!parsed) return false;
  memorySettings = JSON.stringify(parsed);
  syncVoiceSettingsCookies(parsed);
  let saved = true;
  try { globalThis.localStorage.setItem(VOICE_SETTINGS_KEY, memorySettings); memorySettingsDirty = false; }
  catch { saved = false; memorySettingsDirty = true; }
  announcePreferenceChange();
  return saved;
}

export function syncVoiceSettingsCookies(value) {
  const parsed = parseVoiceSettings(JSON.stringify(value));
  if (!parsed) return;
  try {
    const options = `; Path=/; Max-Age=31536000; SameSite=Lax${globalThis.location?.protocol === "https:" ? "; Secure" : ""}`;
    document.cookie = `${VOICE_SETTINGS_COOKIE}=${encodeURIComponent(JSON.stringify(parsed))}${options}`;
    document.cookie = `${DISPLAY_COOKIE}=${encodeURIComponent(JSON.stringify(parseDisplaySettings(parsed)))}${options}`;
  } catch { /* In-memory settings still apply when device storage is unavailable. */ }
}

function announcePreferenceChange() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("kodmod:speech-engine-change"));
  }
}

export function readSpeechEnginePreference(storage) {
  try {
    const destination = storage ?? globalThis.localStorage;
    const value = destination?.getItem(SPEECH_ENGINE_PREFERENCE_KEY);
    if (value === "app" || value === "device" || value === "off") return value;
  } catch {
    return inMemoryPreference;
  }
  return inMemoryPreference;
}

export function writeSpeechEnginePreference(storage, engine) {
  if (engine !== "app" && engine !== "device" && engine !== "off") return false;
  try {
    const destination = storage ?? globalThis.localStorage;
    if (!destination) throw new Error("Penyimpanan peramban tidak tersedia.");
    destination.setItem(SPEECH_ENGINE_PREFERENCE_KEY, engine);
    inMemoryPreference = engine;
    announcePreferenceChange();
    return true;
  } catch {
    inMemoryPreference = engine;
    announcePreferenceChange();
    return false;
  }
}

function fallbackDigest(value) {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ code, 0x85ebca6b);
  }
  return `${(left >>> 0).toString(16)}${(right >>> 0).toString(16)}-${value.length}`;
}

async function digestSpeechText(value) {
  try {
    if (globalThis.crypto?.subtle && typeof TextEncoder !== "undefined") {
      const bytes = new TextEncoder().encode(value);
      const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    }
  } catch {
    // Older or restricted browsers still get a stable local cache key.
  }
  return fallbackDigest(value);
}

export async function speechAudioCacheKey(text, context = {}) {
  const normalized = String(text ?? "").trim();
  const digest = await digestSpeechText(JSON.stringify([normalized, context.language ?? "id",
    context.profile ?? "legacy", context.scope ?? "legacy", context.menuKey ?? ""]));
  return `${AUDIO_CACHE_VERSION}:${digest}`;
}

export function invalidateSpeechAudioCache() {
  cacheGeneration += 1;
  inFlightAudio.clear();
}

export function createSpeechAudioLoader({
  read,
  write,
  fetchAudio,
  now = Date.now,
  cacheTtlMs = SPEECH_AUDIO_CACHE_TTL_MS,
}) {
  return async function loadSpeechAudio(text, context = {}) {
    const normalized = String(text ?? "").trim();
    if (!normalized) throw new Error("Teks untuk dibacakan masih kosong.");

    if (context.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const key = await speechAudioCacheKey(normalized, context);
    let cached = null;
    try {
      cached = await read(key);
    } catch {
      // Cache failures must not prevent a new TTS request.
    }
    if (cached?.blob && cached.expiresAt > now()) {
      return { blob: cached.blob, cached: true };
    }

    const pending = inFlightAudio.get(key);
    if (pending && !pending.signal?.aborted) {
      const blob = await pending.promise;
      return { blob, cached: false };
    }

    const generation = cacheGeneration;
    const request = (async () => {
      const blob = await fetchAudio(normalized, context);
      if (generation === cacheGeneration) {
        try {
          await write(key, { blob, expiresAt: now() + cacheTtlMs });
        } catch {
          // Keep playback available when IndexedDB is full or unavailable.
        }
      }
      return blob;
    })();
    const entry = { promise: request, signal: context.signal };
    inFlightAudio.set(key, entry);
    try {
      return { blob: await request, cached: false };
    } finally {
      if (inFlightAudio.get(key) === entry) inFlightAudio.delete(key);
    }
  };
}

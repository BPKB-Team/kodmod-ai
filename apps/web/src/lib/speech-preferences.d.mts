export type SpeechEngine = "app" | "device" | "off";
export type VoiceSettings = { engine: SpeechEngine; menuEnabled: boolean; tutorEnabled: boolean;
  lowVision: boolean; guidedNavigation: boolean; fontScale: "default" | "large" | "extra-large";
  highContrast: boolean; spacious: boolean; reducedMotion: boolean };
export type DisplaySettings = Pick<VoiceSettings, "lowVision" | "fontScale" | "highContrast" | "spacious" | "reducedMotion">;
export const DISPLAY_COOKIE: string;
export function parseDisplaySettings(value?: Partial<VoiceSettings>): DisplaySettings;
export const VOICE_SETTINGS_KEY: string;
export const VOICE_SETTINGS_COOKIE: string;
export const DEFAULT_VOICE_SETTINGS: VoiceSettings;
export function readVoiceSettingsSnapshot(): string | null;
export function parseVoiceSettings(snapshot: string | null): VoiceSettings | null;
export function writeVoiceSettings(settings: VoiceSettings): boolean;
export function syncVoiceSettingsCookies(settings: VoiceSettings): void;
export type SpeechContext = { language?: "id" | "en"; profile?: string; scope?: string;
  menuKey?: string; signal?: AbortSignal };

export type CachedSpeechAudio = {
  blob: Blob;
  expiresAt: number;
};

export const SPEECH_ENGINE_PREFERENCE_KEY: string;
export const SPEECH_AUDIO_CACHE_TTL_MS: number;

export function readSpeechEnginePreference(
  storage?: Pick<Storage, "getItem">,
): SpeechEngine | null;

export function writeSpeechEnginePreference(
  storage: Pick<Storage, "setItem"> | undefined,
  engine: SpeechEngine,
): boolean;

export function speechAudioCacheKey(text: string, context?: SpeechContext): Promise<string>;
export function invalidateSpeechAudioCache(): void;

export function createSpeechAudioLoader(options: {
  read: (key: string) => Promise<CachedSpeechAudio | null>;
  write: (key: string, entry: CachedSpeechAudio) => Promise<void>;
  fetchAudio: (text: string, context?: SpeechContext) => Promise<Blob>;
  now?: () => number;
  cacheTtlMs?: number;
}): (text: string, context?: SpeechContext) => Promise<{ blob: Blob; cached: boolean }>;

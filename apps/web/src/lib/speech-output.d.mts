import type { SpeechEngine } from "./speech-preferences.mjs";
import type { Language } from "./i18n.mjs";
export type SpeechRequest = { owner: string; text: string; engine: SpeechEngine; language: Language; menuKey?: string; interrupt?: boolean };
export type OutputState = { owner: string | null; status: "idle" | "loading" | "playing" | "paused" | "blocked" | "error";
  fallback: boolean; message: string };
export type SpeechOutput = { play: () => Promise<void> | void; pause: () => void;
  resume: () => Promise<void> | void; stop: () => void; dispose: () => void };
export function createSpeechCoordinator(adapters: {
  loadAudio: (request: SpeechRequest, signal: AbortSignal) => Promise<Blob>;
  makeAudio: (audio: Blob, ended: () => void, failed: (error: Error) => void) => SpeechOutput;
  speakDevice: (request: SpeechRequest, ended: () => void, failed: (error: Error) => void) => SpeechOutput;
}): { play: (request: SpeechRequest) => Promise<void>; stop: (owner?: string) => void;
  queueMenu: (request: SpeechRequest, canPlay?: () => boolean, delay?: number) => void;
  cancelQueuedMenu: () => void;
  togglePause: (owner?: string) => Promise<void>; getState: () => OutputState;
  subscribe: (listener: () => void) => () => void };

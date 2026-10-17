import type { SpeechEngine } from "./speech-preferences.mjs";
import type { Language } from "./i18n.mjs";
import type { createSpeechCoordinator } from "./speech-output.mjs";
type Speech = ReturnType<typeof createSpeechCoordinator>;
export function attachMenuNarration(options: { document: Document; speech: Speech;
  language: Language; engine: SpeechEngine; pathname: string }): () => void;
export function announceLanguageChange(speech: Speech, language: Language,
  options: { engine: SpeechEngine; enabled: boolean; recording?: boolean }): Promise<void>;
export function announcePageNavigation(options: { document: Document; speech: Speech;
  language: Language; engine: SpeechEngine; enabled: boolean;
  previousPathname: string; pathname: string }): void;

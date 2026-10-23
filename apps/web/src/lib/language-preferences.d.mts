import type { Language } from "./i18n.mjs";
export function readBrowserLanguage(): Language | null;
export function subscribeLanguagePreference(listener: () => void): () => void;
export function notifyLanguagePreference(language: Language, previous: Language): void;

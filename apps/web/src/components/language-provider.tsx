"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { translate, localeFor, type Language } from "@/lib/i18n.mjs";
import { readBrowserLanguage, subscribeLanguagePreference, notifyLanguagePreference } from "@/lib/language-preferences.mjs";

type I18n = { language: Language; t: (text: string, values?: Record<string, string | number>) => string; locale: string;
  changeLanguage: (language: Language) => Promise<void> };
const LanguageContext = createContext<I18n | null>(null);

export function LanguageProvider({ initialLanguage, children }: { initialLanguage: Language; children: ReactNode }) {
  const storedLanguage = useSyncExternalStore(subscribeLanguagePreference, readBrowserLanguage, () => initialLanguage);
  const language = storedLanguage ?? initialLanguage;
  const router = useRouter();
  const previousLanguage = useRef(initialLanguage);
  useEffect(() => {
    document.documentElement.lang = language;
    if (previousLanguage.current !== language) {
      previousLanguage.current = language;
      router.refresh();
    }
  }, [language, router]);
  const changeLanguage = useCallback(async (next: Language) => {
    const response = await fetch("/api/preferences/language", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ language: next }),
    });
    if (!response.ok) throw new Error(translate("Bahasa belum dapat disimpan. Coba lagi.", language));
    notifyLanguagePreference(next, language);
  }, [language]);
  const value = useMemo(() => ({ language, t: (text: string, values?: Record<string, string | number>) => translate(text, language, values),
    locale: localeFor(language), changeLanguage }), [language, changeLanguage]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useI18n() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error("LanguageProvider is required.");
  return value;
}

export function UiText({ children }: { children: string }) {
  return useI18n().t(children);
}

export function UiDate({ value, time = false, empty = "Belum pernah masuk" }: {
  value: string | null; time?: boolean; empty?: string;
}) {
  const { locale, t } = useI18n();
  return value ? new Intl.DateTimeFormat(locale, {
    dateStyle: "medium", ...(time ? { timeStyle: "short" as const } : {}), timeZone: "Asia/Jakarta",
  }).format(new Date(value)) + (time ? " WIB" : "") : t(empty);
}

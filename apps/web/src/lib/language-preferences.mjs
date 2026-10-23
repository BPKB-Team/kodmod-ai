import { LANGUAGE_COOKIE, validLanguage } from "./i18n.mjs";

const notificationKey = "kodmod.language-change.v1";

export function readBrowserLanguage() {
  try {
    const cookie = document.cookie.split(";").map(value => value.trim())
      .find(value => value.startsWith(`${LANGUAGE_COOKIE}=`));
    const language = cookie ? decodeURIComponent(cookie.slice(LANGUAGE_COOKIE.length + 1)) : null;
    return validLanguage(language) ? language : null;
  } catch { return null; }
}

export function subscribeLanguagePreference(listener) {
  const events = ["focus", "pageshow", "storage", "kodmod:language-sync"];
  for (const event of events) window.addEventListener(event, listener);
  document.addEventListener("visibilitychange", listener);
  return () => {
    for (const event of events) window.removeEventListener(event, listener);
    document.removeEventListener("visibilitychange", listener);
  };
}

export function notifyLanguagePreference(language, previous) {
  window.dispatchEvent(new Event("kodmod:language-sync"));
  // Cookies are shared by tabs; storage is only a notification, never a
  // second authoritative language value or an account/session identifier.
  try { localStorage.setItem(notificationKey, `${language}:${Date.now()}:${Math.random()}`); } catch { /* Cookie storage still works. */ }
  if (language !== previous)
    window.dispatchEvent(new CustomEvent("kodmod:language-change", { detail: { language } }));
}

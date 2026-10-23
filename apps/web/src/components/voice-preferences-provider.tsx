"use client";
import { NativeSelect } from "@/components/ui/native-select";


import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Headphones, Smartphone, Volume2, VolumeX, X, Play, Check, ChevronRight, ArrowLeft, Settings2, Sliders, Type } from "lucide-react";
import { DEFAULT_VOICE_SETTINGS, parseVoiceSettings, readVoiceSettingsSnapshot, writeVoiceSettings, syncVoiceSettingsCookies,
  parseDisplaySettings, type DisplaySettings, type VoiceSettings, type SpeechEngine } from "@/lib/speech-preferences.mjs";
import { pruneExpiredSpeechAudioCache } from "@/lib/speech-audio-cache";
import { speechOutput } from "@/lib/browser-speech";
import { attachMenuNarration, announceLanguageChange, announcePageNavigation } from "@/lib/menu-narration.mjs";
import type { Language } from "@/lib/i18n.mjs";
import { useI18n } from "./language-provider";
import { Switch } from "./ui/switch";
import { Dialog } from "./ui/dialog";
import { LoadingStatus } from "./loading-feedback";

function FlagIndonesia({ className = "voice-flag-svg" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 16" width="22" height="15" aria-hidden="true">
      <rect width="24" height="8" fill="#E70011" />
      <rect y="8" width="24" height="8" fill="#FFFFFF" />
      <rect width="24" height="16" fill="none" stroke="rgba(0,0,0,0.18)" strokeWidth="1" rx="2" />
    </svg>
  );
}

function FlagUK({ className = "voice-flag-svg" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 60 30" width="22" height="15" aria-hidden="true">
      <rect width="60" height="30" fill="#012169" rx="2" />
      <path d="M0,0 L60,30 M60,0 L0,30" stroke="#ffffff" strokeWidth="6" />
      <path d="M0,0 L60,30 M60,0 L0,30" stroke="#C8102E" strokeWidth="2" />
      <path d="M30,0 v30 M0,15 h60" stroke="#ffffff" strokeWidth="10" />
      <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6" />
      <rect width="60" height="30" fill="none" stroke="rgba(0,0,0,0.18)" strokeWidth="1" rx="2" />
    </svg>
  );
}

type Preferences = VoiceSettings & { settingsOpen: boolean; openVoicePreferences: () => void; toggleMenu: () => void };
const VoicePreferencesContext = createContext<Preferences | null>(null);
const getServerSnapshot = () => null;
const subscribe = (listener: () => void) => {
  window.addEventListener("storage", listener);
  window.addEventListener("focus", listener);
  window.addEventListener("pageshow", listener);
  window.addEventListener("kodmod:speech-engine-change", listener);
  return () => { window.removeEventListener("storage", listener);
    window.removeEventListener("focus", listener);
    window.removeEventListener("pageshow", listener);
    window.removeEventListener("kodmod:speech-engine-change", listener); };
};
const clientReady = () => true;
const serverReady = () => false;
const readiness = () => () => {};
const guide = {
  id: "Selamat datang di KODMOD. Pilih suara KODMOD atau suara perangkat. Tekan contoh suara untuk mendengarkan. Pembaca menu dapat dimatikan. Suara Tutor tetap aktif saat belajar.",
  en: "Welcome to KODMOD. Choose the KODMOD voice or your device voice. Press preview to listen. You can turn menu reading off. Your Tutor still speaks while you learn.",
};
const sampleApp = {
  id: "Halo, ini suara KODMOD. Saya akan menemanimu belajar, satu langkah demi satu langkah.",
  en: "Hello, this is the KODMOD voice. I will help you learn, one step at a time.",
};
const sampleDevice = {
  id: "Ini adalah suara perangkat Anda.",
  en: "This is your device voice.",
};

export function useVoicePreferences() {
  const value = useContext(VoicePreferencesContext);
  if (!value) throw new Error("VoicePreferencesProvider is required.");
  return value;
}

export function VoicePreferencesProvider({ children, initialDisplay = parseDisplaySettings(), initialVoice = null }: { children: ReactNode; initialDisplay?: DisplaySettings; initialVoice?: VoiceSettings | null }) {
  const { language, t, changeLanguage } = useI18n();
  const pathname = usePathname();
  const ready = useSyncExternalStore(readiness, clientReady, serverReady);
  const snapshot = useSyncExternalStore(subscribe, readVoiceSettingsSnapshot, getServerSnapshot);
  const saved = useMemo(() => parseVoiceSettings(snapshot), [snapshot]);
  useEffect(() => {
    // Upgrade existing local/legacy choices before the next login or reload,
    // so server-rendered controls start with the same settings as the browser.
    if (saved) syncVoiceSettingsCookies(saved);
  }, [saved]);
  const preferences = useMemo(() => saved ?? initialVoice ?? { ...DEFAULT_VOICE_SETTINGS, ...initialDisplay }, [saved, initialVoice, initialDisplay]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState<VoiceSettings>(initialVoice ?? { ...DEFAULT_VOICE_SETTINGS, ...initialDisplay });
  const [screen, setScreen] = useState<"voice" | "display">("voice");
  const [warning, setWarning] = useState("");
  const [languagePending, setLanguagePending] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const initialGuidePlayed = useRef(false);
  const settingsAnnounced = useRef(false);
  const pendingLanguage = useRef<Language | null>(null);
  const lastPathname = useRef(pathname);
  const opened = ready && (!saved || settingsOpen);

  const openVoicePreferences = useCallback(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDraft(preferences); setWarning(""); setScreen("voice"); setSettingsOpen(true);
  }, [preferences]);
  const toggleMenu = useCallback(() => {
    const value = { ...preferences, menuEnabled: !preferences.menuEnabled };
    if (!value.menuEnabled) speechOutput.stop("menu");
    if (!writeVoiceSettings(value)) setWarning("Pengaturan belum tersimpan di perangkat. Pilihan tetap berlaku selama halaman ini terbuka.");
  }, [preferences]);
  const activePreferences = opened ? draft : preferences;
  const value = useMemo(() => ({ ...activePreferences, settingsOpen: opened, openVoicePreferences, toggleMenu }),
    [activePreferences, opened, openVoicePreferences, toggleMenu]);

  const preview = useCallback((engine: SpeechEngine, welcome = false) => {
    if (engine === "off") return Promise.resolve();
    const text = welcome ? guide[language] : (engine === "device" ? sampleDevice[language] : sampleApp[language]);
    return speechOutput.play({
      owner: "voice-setup",
      text,
      engine: engine === "device" ? "device" : "app",
      language,
      menuKey: welcome ? "welcome" : (engine === "app" ? "preview" : undefined),
    });
  }, [language]);

  // Automatically play welcome guide on the user's first interaction anywhere on the page
  useEffect(() => {
    if (!ready || saved || initialGuidePlayed.current) return;
    const playGuideOnFirstInteraction = () => {
      if (initialGuidePlayed.current) return;
      initialGuidePlayed.current = true;
      if (preferences.engine !== "off" && preferences.menuEnabled) {
        void preview(preferences.engine, true);
      }
    };
    window.addEventListener("pointerdown", playGuideOnFirstInteraction, { once: true });
    window.addEventListener("keydown", playGuideOnFirstInteraction, { once: true });
    return () => {
      window.removeEventListener("pointerdown", playGuideOnFirstInteraction);
      window.removeEventListener("keydown", playGuideOnFirstInteraction);
    };
  }, [ready, saved, preferences.engine, preferences.menuEnabled, preview]);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (opened && !element.open) {
      if (!returnFocus.current) returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      element.showModal(); wasOpen.current = true;
      element.querySelector<HTMLButtonElement>("[data-guide-button]")?.focus();
    } else if (!opened && element.open) {
      element.close(); speechOutput.stop("voice-setup");
      if (wasOpen.current) returnFocus.current?.focus();
      returnFocus.current = null; wasOpen.current = false;
    }
  }, [opened]);

  useEffect(() => {
    void pruneExpiredSpeechAudioCache().catch(() => {});
    const interval = setInterval(() => void pruneExpiredSpeechAudioCache().catch(() => {}), 6 * 3600000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const display = opened ? draft : preferences;
    const root = document.documentElement;
    root.dataset.lowVision = String(display.lowVision);
    root.dataset.textSize = display.fontScale;
    root.dataset.highContrast = String(display.highContrast);
    root.dataset.spacious = String(display.spacious);
    root.dataset.reducedMotion = String(display.reducedMotion);
  }, [opened, draft, preferences]);
  useEffect(() => () => speechOutput.stop(), [pathname, language]);

  useEffect(() => {
    const changed = (event: Event) => {
      const next = (event as CustomEvent<{ language: Language }>).detail?.language;
      if (next === "id" || next === "en") pendingLanguage.current = next;
    };
    window.addEventListener("kodmod:language-change", changed);
    return () => window.removeEventListener("kodmod:language-change", changed);
  }, []);

  useEffect(() => {
    if (pendingLanguage.current !== language) return;
    pendingLanguage.current = null;
    // Runs after the previous language's audio cleanup, so the confirmation survives.
    void announceLanguageChange(speechOutput, language, { engine: opened ? draft.engine : preferences.engine,
      enabled: opened ? draft.menuEnabled : preferences.menuEnabled,
      recording: Boolean(document.querySelector(".voice-panel[data-recording=true]")) });
  }, [language, opened, draft.engine, draft.menuEnabled, preferences.engine, preferences.menuEnabled]);

  useEffect(() => {
    if (!ready || !activePreferences.menuEnabled || activePreferences.engine === "off") return;
    return attachMenuNarration({ document, speech: speechOutput, language, engine: activePreferences.engine, pathname });
  }, [ready, activePreferences.menuEnabled, activePreferences.engine, pathname, language]);

  useEffect(() => {
    if (!opened) { settingsAnnounced.current = false; return; }
    if (settingsAnnounced.current) return;
    settingsAnnounced.current = true;
    window.dispatchEvent(new CustomEvent("kodmod:dialog-announce", { detail: {
      text: `${t("Pengaturan suara")}. ${t("Dengarkan contoh, lalu pilih suara yang nyaman untukmu.")}`,
      menuKey: "voice-settings",
    } }));
  }, [opened, t]);

  useEffect(() => {
    if (!ready) return;
    const previousPathname = lastPathname.current;
    lastPathname.current = pathname;
    if (previousPathname === pathname) return;
    return announcePageNavigation({
      document,
      speech: speechOutput,
      language,
      engine: preferences.engine,
      enabled: preferences.menuEnabled && !opened,
      previousPathname,
      pathname,
    });
  }, [ready, pathname, language, preferences.engine, preferences.menuEnabled, opened]);

  useEffect(() => {
    if (!preferences.guidedNavigation) return;
    let start: { x: number; y: number } | null = null;
    const begin = (event: TouchEvent) => { start = event.touches.length === 1
      ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null; };
    const finish = (event: TouchEvent) => {
      if (!start || event.changedTouches.length !== 1) return;
      const dx = event.changedTouches[0].clientX - start.x;
      const dy = event.changedTouches[0].clientY - start.y; start = null;
      if (Math.abs(dx) < 70 || Math.abs(dy) > 40) return;
      if (event.target instanceof Element && event.target.closest("input,textarea,select,[role=slider],[role=combobox],[role=listbox],[contenteditable=true]")) return;
      const scope = dialog.current?.open ? dialog.current : document;
      const targets = [...scope.querySelectorAll<HTMLElement>("a[href],button,input,select,textarea,summary,[tabindex='0']")]
        .filter(element => !element.hasAttribute("disabled") && element.getClientRects().length > 0 && element.tabIndex >= 0);
      if (!targets.length) return;
      const index = targets.indexOf(document.activeElement as HTMLElement);
      targets[Math.max(0, Math.min(targets.length - 1, index + (dx < 0 ? 1 : -1)))]?.focus();
    };
    document.addEventListener("touchstart", begin, { passive: true });
    document.addEventListener("touchend", finish, { passive: true });
    return () => { document.removeEventListener("touchstart", begin); document.removeEventListener("touchend", finish); };
  }, [preferences.guidedNavigation]);

  function save() {
    speechOutput.stop("voice-setup");
    setWarning(writeVoiceSettings(draft) ? "" : "Pengaturan belum tersimpan di perangkat. Pilihan tetap berlaku selama halaman ini terbuka.");
    setSettingsOpen(false);
  }

  function closeSettings() {
    speechOutput.stop("voice-setup");
    setSettingsOpen(false);
  }

  return <VoicePreferencesContext.Provider value={value}>
    {children}
    {warning && !opened && <div className="global-voice-notice" role="status" data-voice-ignore="true">{t(warning)}</div>}
    <Dialog ref={dialog} className="voice-preferences-dialog" aria-labelledby="voice-preferences-title"
      data-voice-dialog-managed="true"
      onCancel={event => { event.preventDefault(); if (!saved) save(); else closeSettings(); }}>
      <div className="voice-preferences-content">
        {screen === "voice" ? (
          <>
            <div className="voice-preferences-heading">
              <div className="voice-preferences-title-group">
                <span className="voice-preferences-mark" aria-hidden="true"><Volume2 size={22} /></span>
                <h2 id="voice-preferences-title">{t(saved ? "Pengaturan suara" : "Pilih suara untuk belajar")}</h2>
              </div>
              {saved && <button className="voice-preferences-close" data-voice-menu="voice-close" aria-label={t("Tutup")} onClick={closeSettings}><X size={20} /></button>}
            </div>

            <button
              type="button"
              className="voice-choice-row voice-game-voice-btn voice-game-guide-big-btn"
              data-guide-button
              data-voice-menu="voice-guide"
              aria-label={`${t("Dengarkan panduan")}. ${t("Dengarkan panduan memilih suara")}`}
              onClick={() => void preview(draft.engine, true)}
            >
              <span className="voice-game-btn-icon guide" aria-hidden="true"><Play size={18} fill="currentColor" /></span>
              <span className="voice-game-btn-label">{t("Dengarkan Panduan")}</span>
              <span className="voice-game-btn-status action-play" aria-hidden="true">
                <Play size={14} fill="currentColor" />
                <span>{t("Putar")}</span>
              </span>
            </button>
          </>
        ) : (
          <>
            <div className="voice-preferences-heading">
              <div className="voice-preferences-title-group">
                <span className="voice-preferences-mark" aria-hidden="true"><Settings2 size={22} /></span>
                <h2 id="voice-preferences-title">{t("Tampilan dan navigasi")}</h2>
              </div>
              {saved && <button className="voice-preferences-close" data-voice-menu="voice-close" aria-label={t("Tutup")} onClick={closeSettings}><X size={20} /></button>}
            </div>

            <button
              type="button"
              className="voice-choice-row voice-game-voice-btn voice-game-back-big-btn"
              data-voice-menu="back"
              onClick={() => setScreen("voice")}
              aria-label={t("Kembali ke Menu Suara")}
            >
              <span className="voice-game-btn-icon back" aria-hidden="true"><ArrowLeft size={18} /></span>
              <span className="voice-game-btn-label">{t("Kembali ke Menu Suara")}</span>
            </button>
          </>
        )}

        <div className="voice-game-screens-wrapper">
          {/* SCREEN 1: PILIHAN SUARA & BAHASA */}
          <div
            className="voice-game-screen-pane"
            style={{ display: screen === "voice" ? "block" : "none" }}
            aria-hidden={screen !== "voice"}
          >
            {/* SECTION 1: PILIHAN SUARA */}
            <section className="voice-game-section" aria-labelledby="voice-sec-1">
              <div className="voice-game-section-header">
                <span className="voice-game-badge" aria-hidden="true">1</span>
                <h3 id="voice-sec-1" className="voice-game-section-title">{t("Pilihan Suara")}</h3>
              </div>

              <fieldset className="voice-preferences-options voice-game-button-list">
                <legend className="sr-only">{t("Pilih suara untuk belajar")}</legend>
                {[
                  {
                    id: "app" as const,
                    title: "KODMOD AI",
                    label: `${t("Suara KODMOD")}. ${t("Suara yang jernih untuk menemani belajar.")}`,
                    icon: Headphones,
                  },
                  {
                    id: "device" as const,
                    title: "Suara perangkat",
                    label: `${t("Suara perangkat")}. ${t("Gunakan suara yang tersedia di HP atau komputermu.")}`,
                    icon: Smartphone,
                  },
                  {
                    id: "off" as const,
                    title: "Suara mati",
                    label: t("Suara mati"),
                    icon: VolumeX,
                  },
                ].map(({ id: engine, title, label, icon: Icon }) => {
                  const isSelected = draft.engine === engine;
                  return (
                    <button
                      key={engine}
                      type="button"
                      className={`voice-choice-row voice-game-voice-btn ${isSelected ? "is-selected is-active" : ""}`}
                      aria-pressed={isSelected}
                      aria-label={`${label}. ${t(isSelected ? "Dipilih" : "Pilih")}`}
                      data-voice-menu={`voice-${engine}`}
                      onClick={() => {
                        setDraft({ ...draft, engine });
                        if (engine !== "off") void preview(engine);
                      }}
                    >
                      <input
                        type="radio"
                        name="speech-engine"
                        value={engine}
                        checked={isSelected}
                        className="sr-only"
                        data-voice-menu={`voice-${engine}`}
                        readOnly
                      />
                      <span className={`voice-game-btn-icon ${engine}`} aria-hidden="true"><Icon size={20} /></span>
                      <span className="voice-game-btn-label">
                        {engine === "app" ? "KODMOD AI" : t(title)}
                      </span>
                      {isSelected ? (
                        <span className="voice-game-btn-status active" aria-hidden="true">
                          <Check size={15} strokeWidth={3} />
                          <span>{t("Dipilih")}</span>
                        </span>
                      ) : (
                        <span className="voice-game-btn-status" aria-hidden="true">
                          {t("Pilih")}
                        </span>
                      )}
                    </button>
                  );
                })}
              </fieldset>
            </section>

            {/* SECTION 2: PENGATURAN & BAHASA */}
            <section className="voice-game-section" aria-labelledby="voice-sec-2">
              <div className="voice-game-section-header">
                <span className="voice-game-badge" aria-hidden="true">2</span>
                <h3 id="voice-sec-2" className="voice-game-section-title">{t("Pengaturan & Bahasa")}</h3>
              </div>

              <div className="voice-game-settings-stack">
                {/* Bahasa dengan Flag SVG */}
                <div className="voice-game-setting-item">
                  <span className="voice-game-item-label">{t("Bahasa")}</span>
                  <div className="voice-game-btn-grid-2" role="group" aria-label={t("Bahasa")}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={language === "id"}
                      className={`voice-game-action-btn ${language === "id" ? "is-active" : ""}`}
                      disabled={languagePending}
                      data-voice-menu="lang-id"
                      aria-label={t("Bahasa Indonesia")}
                      onClick={async () => {
                        if (language === "id") return;
                        setLanguagePending(true); speechOutput.stop();
                        try { await changeLanguage("id"); setWarning(""); }
                        catch { setWarning("Bahasa belum dapat disimpan. Coba lagi."); }
                        finally { setLanguagePending(false); }
                      }}
                    >
                      <FlagIndonesia className="voice-flag-svg" />
                      <span>Indonesia</span>
                      {language === "id" && <Check size={15} strokeWidth={3} aria-hidden="true" />}
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={language === "en"}
                      className={`voice-game-action-btn ${language === "en" ? "is-active" : ""}`}
                      disabled={languagePending}
                      data-voice-menu="lang-en"
                      aria-label={t("Bahasa Inggris")}
                      onClick={async () => {
                        if (language === "en") return;
                        setLanguagePending(true); speechOutput.stop();
                        try { await changeLanguage("en"); setWarning(""); }
                        catch { setWarning("Bahasa belum dapat disimpan. Coba lagi."); }
                        finally { setLanguagePending(false); }
                      }}
                    >
                      <FlagUK className="voice-flag-svg" />
                      <span>English</span>
                      {language === "en" && <Check size={15} strokeWidth={3} aria-hidden="true" />}
                    </button>
                  </div>
                  <NativeSelect id="voice-language" className="sr-only" data-voice-menu="language" value={language} disabled={languagePending} onChange={async event => {
                    setLanguagePending(true); speechOutput.stop();
                    try { await changeLanguage(event.target.value as "id" | "en"); setWarning(""); }
                    catch { setWarning("Bahasa belum dapat disimpan. Coba lagi."); } finally { setLanguagePending(false); }
                  }}><option value="id">Bahasa Indonesia</option><option value="en">English</option></NativeSelect>
                </div>

                {/* Pembaca Menu: 1 Tombol Toggle Langsung */}
                <div className="voice-game-setting-item">
                  <button
                    type="button"
                    className={`voice-game-toggle-card-btn ${draft.menuEnabled ? "is-active" : ""}`}
                    aria-pressed={draft.menuEnabled}
                    aria-label={`${t("Pembaca menu")}. ${t(draft.menuEnabled ? "Suara menu aktif" : "Suara menu mati")}`}
                    data-voice-menu={draft.menuEnabled ? "sound-on" : "sound-off"}
                    onClick={() => setDraft({ ...draft, menuEnabled: !draft.menuEnabled })}
                  >
                    <span className="voice-game-toggle-left">
                      {draft.menuEnabled ? <Volume2 size={19} aria-hidden="true" /> : <VolumeX size={19} aria-hidden="true" />}
                      <strong>{t("Pembaca menu")}</strong>
                    </span>
                    <span className={`voice-game-toggle-badge ${draft.menuEnabled ? "on" : "off"}`}>
                      {draft.menuEnabled ? <Check size={14} strokeWidth={3} aria-hidden="true" /> : null}
                      <span>{t(draft.menuEnabled ? "Nyala" : "Mati")}</span>
                    </span>
                  </button>
                  <Switch id="menu-reader" className="sr-only" data-voice-menu={draft.menuEnabled ? "sound-on" : "sound-off"} checked={draft.menuEnabled} onCheckedChange={menuEnabled => setDraft({ ...draft, menuEnabled })} />
                </div>

                {/* Suara Tutor: 1 Tombol Toggle Langsung */}
                <div className="voice-game-setting-item">
                  <button
                    type="button"
                    className={`voice-game-toggle-card-btn ${draft.tutorEnabled ? "is-active" : ""}`}
                    aria-pressed={draft.tutorEnabled}
                    aria-label={`${t("Suara Tutor")}. ${t(draft.tutorEnabled ? "Nyala" : "Mati")}`}
                    data-voice-menu={`tutor-reader-${draft.tutorEnabled ? "on" : "off"}`}
                    onClick={() => setDraft({ ...draft, tutorEnabled: !draft.tutorEnabled })}
                  >
                    <span className="voice-game-toggle-left">
                      {draft.tutorEnabled ? <Volume2 size={19} aria-hidden="true" /> : <VolumeX size={19} aria-hidden="true" />}
                      <strong>{t("Suara Tutor")}</strong>
                    </span>
                    <span className={`voice-game-toggle-badge ${draft.tutorEnabled ? "on" : "off"}`}>
                      {draft.tutorEnabled ? <Check size={14} strokeWidth={3} aria-hidden="true" /> : null}
                      <span>{t(draft.tutorEnabled ? "Nyala" : "Mati")}</span>
                    </span>
                  </button>
                  <Switch id="tutor-reader" className="sr-only" data-voice-menu={`tutor-reader-${draft.tutorEnabled ? "on" : "off"}`} checked={draft.tutorEnabled} onCheckedChange={tutorEnabled => setDraft({ ...draft, tutorEnabled })} />
                </div>
              </div>

              {/* Tombol Pilihan Selanjutnya: Tampilan & Navigasi */}
              <button
                type="button"
                className="voice-game-next-menu-btn"
                data-voice-menu="display-settings"
                aria-label={t("Tampilan dan navigasi")}
                onClick={() => setScreen("display")}
              >
                <span className="voice-game-next-menu-left">
                  <Settings2 size={19} aria-hidden="true" />
                  <span>{t("Pilihan Selanjutnya: Tampilan & Navigasi")}</span>
                </span>
                <ChevronRight size={19} aria-hidden="true" />
              </button>
            </section>
          </div>

          {/* SCREEN 2: OPSI TAMPILAN & NAVIGASI */}
          <div
            className="voice-game-screen-pane"
            style={{ display: screen === "display" ? "block" : "none" }}
            aria-hidden={screen !== "display"}
          >
            <section className="voice-game-section" aria-labelledby="voice-sec-display">
              <div className="voice-game-section-header">
                <span className="voice-game-badge" aria-hidden="true">
                  <Sliders size={16} />
                </span>
                <h3 id="voice-sec-display" className="voice-game-section-title">{t("Pilihan Tampilan")}</h3>
              </div>

              <div className="voice-game-settings-stack">
                {/* Ukuran Teks: Card button full width yang berganti saat diklik */}
                {(() => {
                  const nextScaleMap: Record<VoiceSettings["fontScale"], VoiceSettings["fontScale"]> = {
                    "default": "large",
                    "large": "extra-large",
                    "extra-large": "default",
                  };
                  const scaleLabels: Record<VoiceSettings["fontScale"], string> = {
                    "default": "Standar",
                    "large": "Besar",
                    "extra-large": "Sangat besar",
                  };
                  const currentLabel = scaleLabels[draft.fontScale];
                  const nextScale = nextScaleMap[draft.fontScale];
                  const nextLabel = scaleLabels[nextScale];
                  const menuKey = `text-size-${draft.fontScale}`;

                  return (
                    <>
                      <button
                        type="button"
                        className="voice-game-toggle-card-btn voice-game-scale-card-btn"
                        data-voice-menu={menuKey}
                        aria-label={`${t("Pilihan ukuran font")}. ${t("Ukuran saat ini")}: ${t(currentLabel)}. ${t("Klik untuk ganti ke")} ${t(nextLabel)}`}
                        onClick={() => setDraft({ ...draft, fontScale: nextScale, lowVision: nextScale !== "default" })}
                      >
                        <span className="voice-game-toggle-left">
                          <strong>{t("Pilihan ukuran font")}</strong>
                          <small className="voice-game-scale-hint">{t("Klik untuk ganti ke")}: {t(nextLabel)}</small>
                        </span>
                        <span className="voice-game-toggle-badge on voice-game-scale-badge">
                          <Type size={14} aria-hidden="true" />
                          <span>{t(currentLabel)}</span>
                        </span>
                      </button>
                      <NativeSelect id="voice-text-size" className="sr-only" data-voice-menu="text-size" value={draft.fontScale} onChange={event => setDraft({ ...draft, fontScale: event.target.value as VoiceSettings["fontScale"], lowVision: event.target.value !== "default" })}>
                        <option value="default">{t("Standar")}</option><option value="large">{t("Besar")}</option><option value="extra-large">{t("Sangat besar")}</option>
                      </NativeSelect>
                    </>
                  );
                })()}

                {/* Kontras Tinggi */}
                <button
                  type="button"
                  className={`voice-game-toggle-card-btn ${draft.highContrast ? "is-active" : ""}`}
                  data-voice-menu={`contrast-${draft.highContrast ? "on" : "off"}`}
                  aria-pressed={draft.highContrast}
                  aria-label={`${t("Kontras tinggi")}: ${t(draft.highContrast ? "Nyala" : "Mati")}`}
                  onClick={() => setDraft({ ...draft, highContrast: !draft.highContrast })}
                >
                  <span className="voice-game-toggle-left">
                    <strong>{t("Kontras tinggi")}</strong>
                  </span>
                  <span className={`voice-game-toggle-badge ${draft.highContrast ? "on" : "off"}`}>
                    {draft.highContrast ? <Check size={14} strokeWidth={3} aria-hidden="true" /> : null}
                    <span>{t(draft.highContrast ? "Nyala" : "Mati")}</span>
                  </span>
                </button>
                <Switch id="voice-contrast" className="sr-only" data-voice-menu={`contrast-${draft.highContrast ? "on" : "off"}`} checked={draft.highContrast} onCheckedChange={highContrast => setDraft({ ...draft, highContrast })} />

                {/* Jarak Bacaan */}
                <button
                  type="button"
                  className={`voice-game-toggle-card-btn ${draft.spacious ? "is-active" : ""}`}
                  data-voice-menu={`spacing-${draft.spacious ? "on" : "off"}`}
                  aria-pressed={draft.spacious}
                  aria-label={`${t("Jarak bacaan lebih lega")}: ${t(draft.spacious ? "Nyala" : "Mati")}`}
                  onClick={() => setDraft({ ...draft, spacious: !draft.spacious })}
                >
                  <span className="voice-game-toggle-left">
                    <strong>{t("Jarak bacaan lebih lega")}</strong>
                  </span>
                  <span className={`voice-game-toggle-badge ${draft.spacious ? "on" : "off"}`}>
                    {draft.spacious ? <Check size={14} strokeWidth={3} aria-hidden="true" /> : null}
                    <span>{t(draft.spacious ? "Nyala" : "Mati")}</span>
                  </span>
                </button>
                <Switch id="voice-spacing" className="sr-only" data-voice-menu={`spacing-${draft.spacious ? "on" : "off"}`} checked={draft.spacious} onCheckedChange={spacious => setDraft({ ...draft, spacious })} />

                {/* Kurangi Animasi */}
                <button
                  type="button"
                  className={`voice-game-toggle-card-btn ${draft.reducedMotion ? "is-active" : ""}`}
                  data-voice-menu={`motion-${draft.reducedMotion ? "on" : "off"}`}
                  aria-pressed={draft.reducedMotion}
                  aria-label={`${t("Kurangi animasi")}: ${t(draft.reducedMotion ? "Nyala" : "Mati")}`}
                  onClick={() => setDraft({ ...draft, reducedMotion: !draft.reducedMotion })}
                >
                  <span className="voice-game-toggle-left">
                    <strong>{t("Kurangi animasi")}</strong>
                  </span>
                  <span className={`voice-game-toggle-badge ${draft.reducedMotion ? "on" : "off"}`}>
                    {draft.reducedMotion ? <Check size={14} strokeWidth={3} aria-hidden="true" /> : null}
                    <span>{t(draft.reducedMotion ? "Nyala" : "Mati")}</span>
                  </span>
                </button>
                <Switch id="voice-motion" className="sr-only" data-voice-menu={`motion-${draft.reducedMotion ? "on" : "off"}`} checked={draft.reducedMotion} onCheckedChange={reducedMotion => setDraft({ ...draft, reducedMotion })} />

                {/* Navigasi Geser */}
                <button
                  type="button"
                  className={`voice-game-toggle-card-btn ${draft.guidedNavigation ? "is-active" : ""}`}
                  data-voice-menu={`guided-${draft.guidedNavigation ? "on" : "off"}`}
                  aria-pressed={draft.guidedNavigation}
                  aria-label={`${t("Navigasi dengan geser")}: ${t(draft.guidedNavigation ? "Nyala" : "Mati")}`}
                  onClick={() => setDraft({ ...draft, guidedNavigation: !draft.guidedNavigation })}
                >
                  <span className="voice-game-toggle-left">
                    <strong>{t("Navigasi dengan geser")}</strong>
                  </span>
                  <span className={`voice-game-toggle-badge ${draft.guidedNavigation ? "on" : "off"}`}>
                    {draft.guidedNavigation ? <Check size={14} strokeWidth={3} aria-hidden="true" /> : null}
                    <span>{t(draft.guidedNavigation ? "Nyala" : "Mati")}</span>
                  </span>
                </button>
                <Switch id="voice-guided" className="sr-only" data-voice-menu={`guided-${draft.guidedNavigation ? "on" : "off"}`} checked={draft.guidedNavigation} onCheckedChange={guidedNavigation => setDraft({ ...draft, guidedNavigation })} />
              </div>
            </section>
          </div>
        </div>

        <LoadingStatus active={languagePending} label="Mengganti bahasa…" compact />
        {warning && <p className="voice-preferences-warning" role="status">{t(warning)}</p>}
      </div>
      <div className="voice-preferences-actions">
        <button type="button" className="button primary voice-game-save-btn" data-voice-menu="voice-save" aria-label={t(saved ? "Simpan pengaturan" : "Gunakan pilihan ini")} onClick={save} disabled={languagePending}>
          {t(saved ? "Simpan pengaturan" : "Gunakan pilihan ini")}
        </button>
      </div>
    </Dialog>
  </VoicePreferencesContext.Provider>;
}

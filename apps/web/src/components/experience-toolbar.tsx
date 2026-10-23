"use client";
import { NativeSelect } from "@/components/ui/native-select";

import { useState, useSyncExternalStore } from "react";
import { Volume2, VolumeX, Settings2, Square, Pause, Play } from "lucide-react";
import { useI18n } from "./language-provider";
import { useVoicePreferences } from "./voice-preferences-provider";
import { speechOutput } from "@/lib/browser-speech";
import { LoadingStatus } from "./loading-feedback";
import { Spinner } from "./ui/spinner";

export function ExperienceToolbar() {
  const { t, language, changeLanguage } = useI18n();
  const { menuEnabled, toggleMenu, openVoicePreferences } = useVoicePreferences();
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const output = useSyncExternalStore(speechOutput.subscribe, speechOutput.getState, speechOutput.getState);
  const active = ["loading", "playing", "paused"].includes(output.status);
  return <div className="experience-toolbar" aria-label={t("Suara & bahasa")}>
    <button type="button" className="experience-button sound-toggle" onClick={toggleMenu}
      data-voice-menu={menuEnabled ? "sound-on" : "sound-off"}
      aria-pressed={menuEnabled} aria-label={t(menuEnabled ? "Suara menu aktif" : "Suara menu mati")}
      title={t(menuEnabled ? "Suara menu aktif" : "Suara menu mati")}>
      {menuEnabled ? <Volume2 size={18} aria-hidden="true" /> : <VolumeX size={18} aria-hidden="true" />}
      <span>{t(menuEnabled ? "Nyala" : "Mati")}</span>
    </button>
    <button className="experience-button" type="button" disabled={!active || output.status === "loading"} data-voice-ignore="true"
      aria-busy={output.status === "loading"} aria-label={t(output.status === "loading" ? "Menyiapkan suara…" : output.status === "paused" ? "Putar lagi" : "Jeda")} onClick={() => void speechOutput.togglePause()}
      title={t(output.status === "paused" ? "Putar lagi" : "Jeda")}>
      {output.status === "loading" ? <Spinner /> : output.status === "paused" ? <Play size={17} aria-hidden="true" /> : <Pause size={17} aria-hidden="true" />}</button>
    <button className="experience-button" type="button" disabled={!active} data-voice-ignore="true"
      aria-label={t("Hentikan suara")} onClick={() => speechOutput.stop()} title={t("Hentikan suara")}><Square size={15} aria-hidden="true" /></button>
    <NativeSelect className="toolbar-language" data-voice-menu="language" aria-label={t("Bahasa")} value={language} disabled={pending}
      onChange={async event => { setPending(true); speechOutput.stop();
        try { await changeLanguage(event.target.value as "id" | "en"); setError(""); }
        catch { setError(t("Bahasa belum dapat disimpan. Coba lagi.")); } finally { setPending(false); } }}>
      <option value="id">ID</option><option value="en">EN</option>
    </NativeSelect>
    <div className="toolbar-loading" data-active={pending}><LoadingStatus active={pending} label="Mengganti bahasa…" compact /></div>
    <button type="button" className="experience-button" onClick={openVoicePreferences}
      data-voice-menu="sound" aria-label={t("Pengaturan suara")} title={t("Pengaturan suara")}><Settings2 size={18} aria-hidden="true" /></button>
    {error && <span role="status" className="toolbar-error">{error}</span>}
  </div>;
}

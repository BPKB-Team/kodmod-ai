"use client";
import { Spinner } from "./ui/spinner";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Headphones, Mic, Pause, Play, Settings2, Square } from "lucide-react";
import { speechOutput } from "@/lib/browser-speech";
import { useVoicePreferences } from "./voice-preferences-provider";
import { useI18n } from "./language-provider";

export function VoiceControls({ text, onTranscript, autoPlayKey, language: contentLanguage }: {
  text: string; onTranscript?: (transcript: string) => void; autoPlayKey?: string | null;
  language?: "id" | "en";
}) {
  const owner = useId();
  const { engine, tutorEnabled, settingsOpen, openVoicePreferences } = useVoicePreferences();
  const { language: interfaceLanguage, t } = useI18n();
  const language = contentLanguage ?? interfaceLanguage;
  const output = useSyncExternalStore(speechOutput.subscribe, speechOutput.getState, speechOutput.getState);
  const state = output.owner === owner ? output.status : "idle";
  const [capture, setCapture] = useState<"idle" | "permission" | "recording" | "transcribing">("idle");
  const [message, setMessage] = useState("");
  const [transcript, setTranscript] = useState("");
  const recorder = useRef<MediaRecorder | null>(null), stream = useRef<MediaStream | null>(null);
  const sequence = useRef(0), controller = useRef<AbortController | null>(null), autoPlayed = useRef<string | null>(null);

  const cancelCapture = useCallback(() => {
    sequence.current++; controller.current?.abort(); controller.current = null;
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    setCapture("idle");
  }, []);
  const play = useCallback(() => speechOutput.play({ owner, text, engine: engine === "off" ? "app" : engine, language }), [owner, text, engine, language]);
  useEffect(() => () => { speechOutput.stop(owner); cancelCapture(); }, [owner, text, engine, language, cancelCapture]);
  useEffect(() => {
    if (!autoPlayKey || !tutorEnabled || settingsOpen || !text.trim() || autoPlayed.current === autoPlayKey) return;
    autoPlayed.current = autoPlayKey;
    void play();
    return () => {
      if (autoPlayed.current === autoPlayKey) autoPlayed.current = null;
      speechOutput.stop(owner);
    };
  }, [autoPlayKey, text, tutorEnabled, settingsOpen, owner, play]);
  useEffect(() => { if (!tutorEnabled && autoPlayKey) speechOutput.stop(owner); }, [tutorEnabled, autoPlayKey, owner]);

  async function listen() {
    if (!text.trim()) return;
    if (state === "playing" || state === "paused") { await speechOutput.togglePause(owner); return; }
    cancelCapture(); setCapture("idle"); setMessage(""); await play();
  }
  function stop() {
    speechOutput.stop(owner); cancelCapture(); setCapture("idle"); setMessage("Suara dihentikan.");
  }
  async function record() {
    if (capture === "recording") { recorder.current?.stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMessage("Peramban ini belum mendukung rekaman suara. Gunakan kolom jawaban teks."); return;
    }
    speechOutput.stop(); cancelCapture(); setCapture("permission"); setMessage(""); setTranscript("");
    const ticket = sequence.current;
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (ticket !== sequence.current) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media;
      const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(mime => MediaRecorder.isTypeSupported(mime));
      const device = new MediaRecorder(media, type ? { mimeType: type } : undefined);
      recorder.current = device;
      const chunks: Blob[] = [];
      device.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      device.onstop = async () => {
        media.getTracks().forEach(track => track.stop()); stream.current = null;
        if (ticket !== sequence.current) return;
        const blob = new Blob(chunks, { type: device.mimeType || "audio/webm" });
        if (!blob.size) { setCapture("idle"); setMessage("Rekaman kosong. Coba tekan rekam lalu bicara lebih dekat ke mikrofon."); return; }
        setCapture("transcribing");
        const data = new FormData(); data.append("audio", blob, type?.includes("mp4") ? "answer.m4a" : "answer.webm");
        controller.current = new AbortController();
        try {
          const response = await fetch("/api/voice/stt", { method: "POST", body: data, signal: controller.current.signal });
          if (!response.ok) throw new Error("Speech transcription failed.");
          const body = await response.json() as { text?: string };
          if (ticket !== sequence.current) return;
          const value = body.text?.trim() ?? "";
          setTranscript(value); onTranscript?.(value);
          setMessage(value ? "Tinjau teks jawabanmu sebelum mengirimkannya." : "Belum ada kata yang terbaca. Coba rekam ulang.");
        } catch {
          if (ticket === sequence.current) setMessage("Suara belum tersedia. Kamu tetap bisa membaca teks.");
        } finally { if (ticket === sequence.current) setCapture("idle"); }
      };
      device.start(); setCapture("recording");
      setMessage("Sedang merekam. Tekan Berhenti setelah selesai berbicara.");
    } catch {
      if (ticket !== sequence.current) return;
      cancelCapture(); setCapture("idle");
      setMessage("Mikrofon tidak dapat digunakan. Kamu tetap bisa menjawab lewat teks.");
    }
  }
  const busy = capture === "permission" || capture === "transcribing";
  const busyLabel = capture === "permission" ? "Menunggu izin mikrofon…" : capture === "transcribing" ? "Mengubah suara menjadi teks…" : "Menyiapkan suara…";
  const active = ["loading", "playing", "paused"].includes(state);
  return <section className="voice-panel voice-panel-compact" aria-label={t("Bantuan suara")}
    data-voice-managed="playback" data-voice-player="true" data-recording={capture === "recording"}>
    <div className="voice-panel-heading"><Headphones size={21} aria-hidden="true" />
      <strong>{t(engine === "device" ? "Suara perangkat" : "Suara KODMOD")}</strong>
      <button type="button" className="icon-button" aria-label={t("Pengaturan suara")} title={t("Pengaturan suara")} onClick={openVoicePreferences}><Settings2 size={18} aria-hidden="true" /></button>
    </div>
    <div className="voice-actions">
      <button type="button" className="button primary" onClick={() => void listen()}
        disabled={!text.trim() || busy || capture === "recording" || state === "loading"} aria-busy={state === "loading"} aria-pressed={state === "playing"}>
        {state === "loading" ? <Spinner /> : state === "playing" ? <Pause size={17} aria-hidden="true" /> : <Play size={17} aria-hidden="true" />}
        {t(state === "loading" ? "Menyiapkan suara…" : state === "playing" ? "Jeda" : state === "paused" ? "Putar lagi" : "Dengarkan")}
      </button>
      {onTranscript && <button type="button" className={`button ${capture === "recording" ? "danger" : "secondary"}`}
        onClick={() => void record()} disabled={busy || active} aria-busy={busy} aria-pressed={capture === "recording"}>
        {busy ? <Spinner /> : capture === "recording" ? <Square size={17} aria-hidden="true" /> : <Mic size={17} aria-hidden="true" />}
        {t(capture === "recording" ? "Berhenti" : busy ? busyLabel : "Jawab dengan suara")}
      </button>}
      <button type="button" className="button secondary" onClick={stop} disabled={!active && capture === "idle"}><Square size={16} aria-hidden="true" />{t("Hentikan suara")}</button>
      <button type="button" className="button secondary" onClick={() => void play()} disabled={!text.trim() || busy || capture === "recording" || state === "loading"}>{t("Ulangi")}</button>
    </div>
    <p className={`voice-status ${state === "error" || state === "blocked" ? "voice-status-error" : ""}`} role="status">
      {!busy && state !== "loading" && t(output.owner === owner && output.message ? output.message : message || (state === "playing" ? "Sedang membacakan." : state === "paused" ? "Pembacaan dijeda." : ""))}
    </p>
    {transcript && <div className="voice-transcript"><strong>{t("Hasil rekaman")}</strong><p>{transcript}</p><small>{t("Periksa kembali hasil ini sebelum digunakan sebagai jawaban.")}</small></div>}
  </section>;
}

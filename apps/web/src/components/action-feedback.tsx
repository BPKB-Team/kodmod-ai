"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { confirmAction, notifyResult, type Confirmation } from "@/lib/dialogs";
import type { ActionState } from "@/lib/types";
import { useI18n } from "@/components/language-provider";
import { LoadingStatus } from "./loading-feedback";
import { speechOutput } from "@/lib/browser-speech";
import { DEFAULT_VOICE_SETTINGS, parseVoiceSettings, readVoiceSettingsSnapshot } from "@/lib/speech-preferences.mjs";
import type { Language } from "@/lib/i18n.mjs";

function speakFeedback(owner: string, text: string, language: Language) {
  const settings = parseVoiceSettings(readVoiceSettingsSnapshot()) ?? DEFAULT_VOICE_SETTINGS;
  if (settings.menuEnabled && settings.engine !== "off")
    void speechOutput.play({ owner, text, language, engine: settings.engine });
}

export function useConfirmedAction(
  action: (state: ActionState, data: FormData) => Promise<ActionState>,
  confirmation: Confirmation,
  processSpeech?: string,
  skipConfirmationWhen?: (data: FormData) => boolean,
) {
  const { language, t } = useI18n();
  return useActionState(async (state: ActionState, data: FormData) => {
    const trigger = document.activeElement;
    if (!skipConfirmationWhen?.(data) && !(await confirmAction({ ...confirmation, language }))) {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (trigger instanceof HTMLElement && trigger.isConnected)
            trigger.focus();
        }),
      );
      return state;
    }
    if (processSpeech) {
      speakFeedback("action-feedback", t(processSpeech), language);
    }
    return action(state, data);
  }, {});
}

export function ActionFeedback({ state, pending = false, pendingLabel = "Menyimpan…" }: { state: ActionState; pending?: boolean; pendingLabel?: string }) {
  const { t, language } = useI18n();
  const router = useRouter();
  const shown = useRef<ActionState | null>(null);
  useEffect(() => {
    if (shown.current === state) return;
    shown.current = state;
    if (state.error) {
      void notifyResult(state.error, true, language);
    } else if (state.success) {
      void notifyResult(state.success, false, language);
      if (state.redirectUrl && router) {
        // Announce completion and wait 2.5 seconds before redirecting
        speakFeedback("action-feedback", `${t(state.success)} ${t("Mengalihkan halaman dalam beberapa detik...")}`, language);
      } else {
        speakFeedback("action-feedback", t(state.success), language);
      }
    }
  }, [state, router, language, t]);
  useEffect(() => {
    if (!state.success || !state.redirectUrl) return;
    const timer = setTimeout(() => router.push(state.redirectUrl!), 2500);
    return () => clearTimeout(timer);
  }, [state, router]);
  return (<>
    <LoadingStatus active={pending} label={pendingLabel} compact />
    <div aria-live="polite" aria-atomic="true">
      {state.error && <p className="alert error-message">{t(state.error)}</p>}
      {state.success && (
        <p className="alert success-message">{t(state.success)}</p>
      )}
    </div>
  </>);
}

const messages: Record<string, string> = {
  "class-created":
    "Kelas berhasil dibuat. Tambahkan siswa dan materi untuk mulai belajar.",
  "material-saved": "Materi berhasil disimpan sesuai status publikasinya.",
  "signed-in": "Anda berhasil masuk. Selamat datang di ruang KODMOD.",
  registered:
    "Akun berhasil dibuat. Selamat memulai perjalanan bersama KODMOD.",
  "signed-out": "Anda sudah keluar dari akun dengan aman.",
  saved: "Data pengguna berhasil disimpan.",
  deleted: "Akun pengguna berhasil dihapus.",
};

export function RedirectFeedback() {
  const { language, t } = useI18n();
  const params = useSearchParams();
  const handled = useRef<string | null>(null);
  const code = params.get("success");
  useEffect(() => {
    if (!code) {
      handled.current = null;
      return;
    }
    if (!Object.hasOwn(messages, code) || handled.current === code) return;
    handled.current = code;
    const url = new URL(window.location.href);
    url.searchParams.delete("success");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    void notifyResult(messages[code], false, language);
    speakFeedback("redirect-feedback", t(messages[code]), language);
  }, [code, language, t]);
  return null;
}

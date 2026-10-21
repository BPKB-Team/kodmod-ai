"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { confirmAction, notifyResult, type Confirmation } from "@/lib/dialogs";
import type { ActionState } from "@/lib/types";
import { useI18n } from "@/components/language-provider";
import { LoadingStatus } from "./loading-feedback";
import { speechOutput } from "@/lib/browser-speech";

export function useConfirmedAction(
  action: (state: ActionState, data: FormData) => Promise<ActionState>,
  confirmation: Confirmation,
  processSpeech?: string,
) {
  return useActionState(async (state: ActionState, data: FormData) => {
    const trigger = document.activeElement;
    if (!(await confirmAction(confirmation))) {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (trigger instanceof HTMLElement && trigger.isConnected)
            trigger.focus();
        }),
      );
      return state;
    }
    if (processSpeech) {
      void speechOutput.play({ owner: "action-feedback", text: processSpeech, language: "id", engine: "app" });
    }
    return action(state, data);
  }, {});
}

export function ActionFeedback({ state, pending = false, pendingLabel = "Menyimpan…" }: { state: ActionState; pending?: boolean; pendingLabel?: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const shown = useRef<ActionState | null>(null);
  useEffect(() => {
    if (shown.current === state) return;
    shown.current = state;
    if (state.error) {
      void notifyResult(state.error, true);
    } else if (state.success) {
      void notifyResult(state.success);
      if (state.redirectUrl && router) {
        // Announce completion and wait 2.5 seconds before redirecting
        void speechOutput.play({
          owner: "action-feedback",
          text: `${state.success} Mengalihkan halaman dalam beberapa detik...`,
          language: "id",
          engine: "app",
        });
        const timer = setTimeout(() => {
          router.push(state.redirectUrl!);
        }, 2500);
        return () => clearTimeout(timer);
      } else {
        void speechOutput.play({
          owner: "action-feedback",
          text: state.success,
          language: "id",
          engine: "app",
        });
      }
    }
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
    void notifyResult(messages[code]);
    void speechOutput.play({ owner: "redirect-feedback", text: messages[code], language: "id", engine: "app" });
  }, [code]);
  return null;
}

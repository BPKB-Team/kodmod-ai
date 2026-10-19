"use client";

import Swal from "sweetalert2";
import { translate, type Language } from "@/lib/i18n.mjs";

const t = (text: string) => translate(text, document.documentElement.lang as Language);

function announceDialog(text: string, menuKey?: string) {
  if (typeof window === "undefined" || typeof CustomEvent === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent("kodmod:dialog-announce", { detail: { text, menuKey } }));
  } catch {
    // Ignore if window is not available
  }
}

async function waitForNativeDialog() {
  if (!document.querySelector("dialog[open]")) return;
  await new Promise<void>(resolve => {
    const observer = new MutationObserver(() => {
      if (!document.querySelector("dialog[open]")) { observer.disconnect(); resolve(); }
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ["open"], childList: true, subtree: true });
  });
}

const dialog = () =>
  Swal.mixin({
    customClass: {
      popup: "kodmod-dialog",
      title: "kodmod-dialog-title",
      htmlContainer: "kodmod-dialog-body",
      confirmButton: "button primary",
      cancelButton: "button secondary",
      actions: "kodmod-dialog-actions",
    },
    buttonsStyling: false,
    confirmButtonText: t("Mengerti"),
    cancelButtonText: t("Batal"),
    heightAuto: false,
    returnFocus: true,
    allowOutsideClick: false,
    animation: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  });

export type Confirmation = {
  title: string;
  text: string;
  confirmText?: string;
  destructive?: boolean;
};
export async function confirmAction(options: Confirmation) {
  await waitForNativeDialog();
  if (Swal.isVisible()) return false;
  const publicKey = options.title === "Masuk ke KODMOD?" ? "login" : options.title === "Buat akun KODMOD?" ? "register" : undefined;
  const confirmText = t(options.confirmText || "Ya, lanjutkan");
  const result = await dialog().fire({
    titleText: t(options.title),
    text: t(options.text),
    icon: options.destructive ? "warning" : "question",
    iconColor: options.destructive ? "#b66b11" : "#2565e9",
    showCancelButton: true,
    focusCancel: true,
    reverseButtons: true,
    confirmButtonText: confirmText,
    didOpen(popup) {
      popup.querySelector<HTMLElement>(".swal2-cancel")?.setAttribute("data-voice-menu", "dialog-cancel");
      if (publicKey) popup.querySelector<HTMLElement>(".swal2-confirm")?.setAttribute("data-voice-menu", `${publicKey}-confirm`);
      announceDialog(`${t(options.title)}. ${t(options.text)}. ${t("Batal")}. ${confirmText}.`, publicKey ? `dialog-${publicKey}` : undefined);
    },
  });
  return result.isConfirmed;
}

export function formatDialogMessage(message: string): { formattedText: string; isStructured: boolean } {
  if (!message || typeof message !== "string") {
    return { formattedText: "", isStructured: false };
  }

  let text = message.trim();
  const hasNumberedList = /(?:^|[\n.!?:]\s*)(\d{1,2}[\.)]\s+)/.test(text);
  const hasMultipleSentences = (text.match(/[.!?](\s+|$)/g) || []).length >= 2;
  const isLong = text.length > 90;

  if (hasNumberedList || (isLong && hasMultipleSentences)) {
    // Break after score / summary sentences before intro
    text = text.replace(/([.!?])\s+(Ada\s+(?:dua|tiga|empat|lima|beberapa|\d+)\s+langkah\b|Inilah\s+rekomendasi\b)/gi, "$1\n\n$2");

    // Add colon after intro phrase if followed by numbers or list
    text = text.replace(/(Ada\s+(?:dua|tiga|empat|lima|beberapa|\d+)\s+langkah\s+[^.!?]+)\.\s+(?=\d{1,2}[\.)]|Pertama,)/gi, "$1:\n\n");

    // Ensure each numbered item or ordinal is on a new paragraph
    text = text.replace(/(?:(?<=[^\n])\s+|^)(\d{1,2}[\.)]\s+)/g, "\n\n$1");
    text = text.replace(/(?:(?<=[^\n])\s+|^)((?:Pertama|Kedua|Ketiga|Keempat|Kelima|First|Second|Third|Fourth|Fifth),\s+)/g, "\n\n$1");

    text = text.replace(/\n{3,}/g, "\n\n").trim();
    return { formattedText: text, isStructured: true };
  }

  return { formattedText: text, isStructured: false };
}

export async function notifyResult(message: string, error = false) {
  await waitForNativeDialog();
  const { formattedText, isStructured } = formatDialogMessage(message);
  const title = t(error ? "Belum berhasil" : "Berhasil");
  const publicMessages: Record<string, string> = {
    "Username atau kata sandi tidak sesuai.": "login-invalid",
    "Isi username dan kata sandi terlebih dahulu.": "login-required",
    "Periksa nama, username, peran, dan kata sandi (minimal 8 karakter).": "register-invalid",
    "Username sudah digunakan. Pilih username lain.": "username-used",
    "Sesi tidak valid. Hubungi administrator.": "session-invalid",
    "Anda sudah keluar dari akun dengan aman.": "signed-out",
  };
  const menuKey = publicMessages[message] ?? (error && /^\/(masuk|daftar)(\/|$)/.test(window.location?.pathname ?? "") ? "dialog-error" : undefined);
  await dialog().fire({
    titleText: title,
    text: t(formattedText),
    customClass: {
      popup: isStructured ? "kodmod-dialog kodmod-dialog-structured" : "kodmod-dialog",
      title: "kodmod-dialog-title",
      htmlContainer: isStructured ? "kodmod-dialog-body is-structured" : "kodmod-dialog-body",
      confirmButton: "button primary",
      cancelButton: "button secondary",
      actions: "kodmod-dialog-actions",
    },
    icon: error ? "error" : "success",
    iconColor: error ? "#c44343" : "#23856d",
    didOpen(popup) {
      popup.querySelector<HTMLElement>(".swal2-confirm")?.setAttribute("data-voice-menu", "dialog-ok");
      announceDialog(`${title}. ${t(formattedText)}. ${t("Mengerti")}.`, menuKey);
    },
  });
}

"use client";
import { Input } from "@/components/ui/input";

import { useState } from "react";
import Link from "next/link";
import { register } from "@/app/actions";
import { Password } from "./forms";
import { ActionFeedback, useConfirmedAction } from "./action-feedback";
import { useI18n } from "./language-provider";
import { Button } from "./ui/button";
export function RegisterForm() {
  const { t } = useI18n();
  const [state, action, pending] = useConfirmedAction(register, {
    title: "Buat akun KODMOD?",
    text: "Pastikan nama dan peran sudah benar sebelum membuat akun.",
    confirmText: "Ya, buat akun",
  });
  const [fields, setFields] = useState({
    full_name: "",
    username: "",
    role: "student",
  });
  function update(key: keyof typeof fields, value: string) {
    setFields((previous) => ({ ...previous, [key]: value }));
  }
  return (
    <form
      className="form-stack"
      onReset={(event) => event.preventDefault()}
      action={action}
    >
      <div className="field">
        <label htmlFor="full_name">{t("Nama lengkap")}</label>
        <Input
          id="full_name"
          name="full_name"
          value={fields.full_name}
          onChange={(e) => update("full_name", e.target.value)}
          maxLength={200}
          required
          autoComplete="name"
          placeholder={t("Nama lengkap")}
        />
      </div>

      <div className="field">
        <label htmlFor="username">{t("Username")}</label>
        <Input
          id="username"
          name="username"
          value={fields.username}
          onChange={(e) => update("username", e.target.value)}
          maxLength={64}
          required
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={t("Username")}
        />
      </div>

      <Password label="Kata sandi" autoComplete="new-password" minLength={8} />
      <p className="form-help form-hint">
        {t("Minimal 8 karakter.")}
      </p>

      <div className="auth-role-wrapper">
        <span id="role-label" className="auth-role-label">{t("Daftar sebagai")}</span>
        <div className="auth-role-grid" role="radiogroup" aria-labelledby="role-label">
          <button
            type="button"
            role="radio"
            aria-checked={fields.role === "student"}
            className={`auth-role-btn ${fields.role === "student" ? "is-active" : ""}`}
            onClick={() => update("role", "student")}
            data-voice-menu="role-student"
            aria-label={`${t("Daftar sebagai")}: ${t("Siswa")}`}
          >
            <span aria-hidden="true">🎓</span>
            <span>{t("Siswa")}</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={fields.role === "teacher"}
            className={`auth-role-btn ${fields.role === "teacher" ? "is-active" : ""}`}
            onClick={() => update("role", "teacher")}
            data-voice-menu="role-teacher"
            aria-label={`${t("Daftar sebagai")}: ${t("Guru")}`}
          >
            <span aria-hidden="true">👨‍🏫</span>
            <span>{t("Guru")}</span>
          </button>
        </div>
        <input type="hidden" name="role" value={fields.role} />
      </div>

      <ActionFeedback state={state} pending={pending} pendingLabel="Membuat akun…" />
      <Button
        type="submit"
        className="auth-submit-btn"
        loading={pending}
        loadingText={t("Membuat akun…")}
        data-voice-menu="auth-submit-register"
      >
        {t("Buat akun")}
      </Button>
      <p className="form-help">
        {t("Sudah punya akun?")}{" "}
        <Link className="text-link" href="/masuk">
          {t("Masuk")}
        </Link>
      </p>
    </form>
  );
}

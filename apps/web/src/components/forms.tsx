"use client";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

import { UiText } from "@/components/language-provider";


import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Eye, EyeOff } from "lucide-react";
import { Button } from "./ui/button";
import {
  login,
  saveUser,
  toggleUser,
} from "@/app/actions";
import {
  ActionFeedback as Feedback,
  useConfirmedAction,
} from "./action-feedback";
import { roleLabel, type User } from "@/lib/types";
import { useI18n } from "./language-provider";

function Submit({
  pending,
  children,
}: {
  pending: boolean;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <Button
      type="submit"
      className="auth-submit-btn"
      loading={pending}
      loadingText={t("Masuk ke akun…")}
      data-voice-menu="auth-submit-login"
    >
      {children}
    </Button>
  );
}
export function Password({
  label,
  autoComplete,
  minLength,
}: {
  label: string;
  autoComplete: string;
  minLength?: number;
}) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const [password, setPassword] = useState("");
  return (
    <div className="field">
      <label htmlFor="password">{t(label)}</label>
      <div className="password-field">
        <input
          id="password"
          name="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type={visible ? "text" : "password"}
          required
          minLength={minLength}
          maxLength={72}
          autoComplete={autoComplete}
          placeholder={t("Kata sandi")}
        />
        <button
          type="button"
          className="password-toggle-btn"
          data-voice-menu={visible ? "password-hide" : "password-show"}
          aria-label={
            t(visible ? "Sembunyikan kata sandi" : "Tampilkan kata sandi")
          }
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
    </div>
  );
}
export function LoginForm() {
  const { t } = useI18n();
  const [state, action, pending] = useConfirmedAction(login, {
    title: "Masuk ke KODMOD?",
    text: "Lanjutkan masuk menggunakan akun yang telah Anda isi.",
    confirmText: "Ya, masuk",
  });
  const [username, setUsername] = useState("");
  return (
    <form
      onReset={(event) => event.preventDefault()}
      action={action}
      className="form-stack"
    >
      <div className="field">
        <label htmlFor="username"><UiText>{"Username"}</UiText></label>
        <Input
          id="username"
          name="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={t("Username")}
        />
      </div>
      <Password label="Kata sandi" autoComplete="current-password" />
      <Feedback state={state} />
      <Submit pending={pending}>
        {t("Masuk")} <ArrowRight size={18} aria-hidden="true" />
      </Submit>
      <p className="form-help">
        {t("Belum punya akun?")}{" "}
        <Link className="text-link" href="/daftar" data-voice-menu="register">
          {t("Buat akun")}
        </Link>
      </p>
      <div className="auth-back-wrap">
        <Link
          href="/"
          className="auth-back-btn"
          data-voice-menu="back-home"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          <span>{t("Kembali ke beranda")}</span>
        </Link>
      </div>
      <p className="form-help form-help-muted">
        {t("Lupa kata sandi? Hubungi administrator sekolah.")}
      </p>
    </form>
  );
}
export function UserForm({
  user,
  self = false,
}: {
  user?: User;
  self?: boolean;
}) {
  const [state, action, pending] = useConfirmedAction(saveUser, {
    title: user ? "Simpan perubahan pengguna?" : "Buat pengguna baru?",
    text: "Pastikan nama dan peran sudah sesuai. Peran menentukan akses pengguna.",
    confirmText: user ? "Ya, simpan" : "Ya, buat pengguna",
  });
  const [name, setName] = useState(user?.full_name || "");
  const [username, setUsername] = useState(user?.username || "");
  const [role, setRole] = useState(user?.role || "student");
  return (
    <form
      onReset={(event) => event.preventDefault()}
      action={action}
      className="panel form-panel"
    >
      <input type="hidden" name="id" value={user?.id || ""} />
      <div className="form-grid">
        <div className="field">
          <label htmlFor="full_name"><UiText>{"Nama lengkap"}</UiText></label>
          <Input
            id="full_name"
            name="full_name"
            required
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
          />
        </div>
        <div className="field">
          <label htmlFor="username"><UiText>{"Username"}</UiText></label>
          <Input
            id="username"
            name="username"
            required
            minLength={3}
            maxLength={64}
            pattern="[a-zA-Z0-9._\-]+"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            readOnly={!!user}
            autoCapitalize="none"
            spellCheck={false}
            autoComplete="off"
            aria-describedby="username-help"
          />
          <small id="username-help">
            {user
              ? <UiText>{"Username tidak dapat diubah."}</UiText>
              : <UiText>{"Huruf, angka, titik, garis bawah, atau tanda hubung."}</UiText>}
          </small>
        </div>
        <div className="field">
          <label htmlFor="role"><UiText>{"Peran"}</UiText></label>
          <NativeSelect
            id="role"
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value as User["role"])}
            disabled={self}
          >
            {Object.entries(roleLabel).map(([v, t]) => (
              <option value={v} key={v}>
                <UiText>{t}</UiText>
              </option>
            ))}
          </NativeSelect>
          {self && <input type="hidden" name="role" value="admin" />}
        </div>
        {!user && (
          <Password
            label="Kata sandi awal"
            autoComplete="new-password"
            minLength={8}
          />
        )}
      </div>
      <Feedback state={state} pending={pending} />
      <div className="form-footer">
        <Link className="button secondary" href="/admin/pengguna"><UiText>{"Batal"}</UiText></Link>
        <Submit pending={pending}>
          {user ? <UiText>{"Simpan perubahan"}</UiText> : <UiText>{"Buat pengguna"}</UiText>}
        </Submit>
      </div>
    </form>
  );
}
export function StatusForm({ user, self }: { user: User; self: boolean }) {
  const [state, action, pending] = useConfirmedAction(toggleUser, {
    title: user.is_active ? "Nonaktifkan akun?" : "Aktifkan akun?",
    text: `${user.full_name}: ${user.is_active ? "akses masuk akan dihentikan. Data dan riwayat tetap disimpan." : "pengguna dapat masuk kembali."}`,
    confirmText: user.is_active ? "Ya, nonaktifkan" : "Ya, aktifkan",
    destructive: user.is_active,
  });
  return (
    <section className="panel">
      <h2><UiText>{"Akses akun"}</UiText></h2>
      <p className="muted">
        {self
          ? <UiText>{"Akun Anda sendiri tidak dapat dinonaktifkan."}</UiText>
          : <UiText>{"Penonaktifan menghentikan akses masuk. Data dan riwayat pengguna tetap disimpan."}</UiText>}
      </p>
      {!self && (
        <form onReset={(event) => event.preventDefault()} action={action}>
          <input type="hidden" name="id" value={user.id} />
          <input type="hidden" name="active" value={String(!user.is_active)} />
          <p><UiText>{"Ubah akses masuk untuk"}</UiText><strong>{user.full_name}</strong>?
          </p>
          <Submit pending={pending}>
            {user.is_active ? <UiText>{"Ya, nonaktifkan"}</UiText> : <UiText>{"Ya, aktifkan"}</UiText>}
          </Submit>
        </form>
      )}
      <Feedback state={state} pending={pending} />
    </section>
  );
}

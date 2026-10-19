"use client";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";


import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Calendar,
  Clock,
  KeyRound,
  Shield,
  Trash2,
  UserCheck,
  UserX,
  Save,
  LoaderCircle,
  Eye,
  EyeOff,
  AlertTriangle,
} from "lucide-react";
import { saveUser, toggleUser, deleteUser } from "@/app/actions";
import { ActionFeedback, useConfirmedAction } from "./action-feedback";
import { Badge } from "./ui";
import { UiText, UiDate, useI18n } from "./language-provider";
import { roleLabel, type User } from "@/lib/types";

export function AdminUserDetail({
  user,
  self = false,
}: {
  user: User;
  self?: boolean;
}) {
  const { t } = useI18n();

  // Save changes state
  const [saveState, saveAction, savePending] = useConfirmedAction(saveUser, {
    title: "Simpan perubahan akun?",
    text: `Perubahan data untuk ${user.full_name} akan langsung diterapkan.`,
    confirmText: "Ya, simpan",
  });

  // Toggle status state
  const [toggleState, toggleAction, togglePending] = useConfirmedAction(toggleUser, {
    title: user.is_active ? "Nonaktifkan akun?" : "Aktifkan akun?",
    text: user.is_active
      ? `Akses masuk untuk ${user.full_name} akan dihentikan sementara. Riwayat dan data tetap aman.`
      : `Pengguna ${user.full_name} akan dapat masuk kembali ke sistem.`,
    confirmText: user.is_active ? "Ya, nonaktifkan" : "Ya, aktifkan",
    destructive: user.is_active,
  });

  // Delete user state
  const [deleteState, deleteAction, deletePending] = useConfirmedAction(deleteUser, {
    title: "Hapus akun secara permanen?",
    text: `Peringatan: Akun ${user.full_name} (@${user.username}) beserta seluruh data terkait akan dihapus secara permanen. Tindakan ini tidak dapat dibatalkan.`,
    confirmText: "Ya, hapus permanen",
    destructive: true,
  });

  const [name, setName] = useState(user.full_name);
  const [role, setRole] = useState(user.role);
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

function getInitials(name: string) {
  const cleaned = name.replace(/^\[[^\]]+\]\s*/, "").trim();
  return (cleaned.slice(0, 1) || name.slice(0, 1) || "?").toUpperCase();
}

  return (
    <div className="admin-user-detail-container">
      <div className="admin-detail-topbar">
        <Link href="/admin/pengguna" className="learning-back">
          <ArrowLeft size={16} aria-hidden="true" />
          <UiText>{"Kembali ke daftar pengguna"}</UiText>
        </Link>
      </div>

      <div className="admin-user-grid">
        {/* Kolom Kiri: Profil, Info Status, dan Zona Bahaya */}
        <aside className="admin-user-sidebar">
          <div className="panel admin-user-profile-card">
            <div className="admin-profile-avatar-wrap">
              <span className="admin-profile-avatar" aria-hidden="true">
                {getInitials(user.full_name)}
              </span>
            </div>
            <h2 className="admin-profile-name">{user.full_name}</h2>
            <p className="admin-profile-username">@{user.username}</p>
            <div className="admin-profile-badges">
              <Badge active={user.is_active}>
                {user.is_active ? <UiText>{"Aktif"}</UiText> : <UiText>{"Nonaktif"}</UiText>}
              </Badge>
              <span className="role-chip">
                <Shield size={13} aria-hidden="true" />
                <UiText>{roleLabel[user.role]}</UiText>
              </span>
            </div>

            <div className="admin-profile-meta-list">
              <div className="admin-meta-row">
                <Calendar size={15} aria-hidden="true" />
                <div>
                  <small><UiText>{"Terdaftar sejak"}</UiText></small>
                  <strong><UiDate value={user.created_at} /></strong>
                </div>
              </div>
              <div className="admin-meta-row">
                <Clock size={15} aria-hidden="true" />
                <div>
                  <small><UiText>{"Terakhir masuk"}</UiText></small>
                  <strong>
                    {user.last_login_at ? (
                      <UiDate value={user.last_login_at} time />
                    ) : (
                      <UiText>{"Belum pernah masuk"}</UiText>
                    )}
                  </strong>
                </div>
              </div>
              <div className="admin-meta-row">
                <KeyRound size={15} aria-hidden="true" />
                <div>
                  <small><UiText>{"ID Akun"}</UiText></small>
                  <code className="admin-id-code">{user.id}</code>
                </div>
              </div>
            </div>
          </div>

          {/* Card Akses & Status */}
          <div className="panel admin-status-action-card">
            <div className="panel-heading-sm">
              <h3><UiText>{"Status Akses"}</UiText></h3>
            </div>
            <p className="muted-text">
              {self ? (
                <UiText>{"Anda tidak dapat menonaktifkan akun Anda sendiri saat sedang masuk."}</UiText>
              ) : user.is_active ? (
                <UiText>{"Akun sedang aktif. Anda dapat menonaktifkannya untuk menghentikan akses sementara."}</UiText>
              ) : (
                <UiText>{"Akun saat ini nonaktif dan tidak dapat masuk ke sistem."}</UiText>
              )}
            </p>
            {!self && (
              <form action={toggleAction} className="admin-action-form">
                <input type="hidden" name="id" value={user.id} />
                <input type="hidden" name="active" value={String(!user.is_active)} />
                <button
                  type="submit"
                  disabled={togglePending}
                  className={`button w-full ${user.is_active ? "secondary" : "primary"}`}
                >
                  {togglePending ? (
                    <LoaderCircle className="spin" size={17} aria-hidden="true" />
                  ) : user.is_active ? (
                    <UserX size={17} aria-hidden="true" />
                  ) : (
                    <UserCheck size={17} aria-hidden="true" />
                  )}
                  {user.is_active ? <UiText>{"Nonaktifkan Akun"}</UiText> : <UiText>{"Aktifkan Akun"}</UiText>}
                </button>
              </form>
            )}
            <ActionFeedback state={toggleState} pending={togglePending} pendingLabel="Memperbarui akses akun…" />
          </div>

          {/* Card Zona Bahaya (Hapus Akun) */}
          <div className="panel admin-danger-card">
            <div className="panel-heading-sm danger-heading">
              <AlertTriangle size={18} aria-hidden="true" />
              <h3><UiText>{"Zona Bahaya"}</UiText></h3>
            </div>
            <p className="muted-text danger-text">
              {self ? (
                <UiText>{"Akun administrator yang sedang digunakan tidak dapat dihapus."}</UiText>
              ) : (
                <UiText>{"Menghapus akun akan menghilangkan data pengguna ini secara permanen dari sistem KODMOD."}</UiText>
              )}
            </p>
            {!self && (
              <form action={deleteAction} className="admin-action-form">
                <input type="hidden" name="id" value={user.id} />
                <button
                  type="submit"
                  disabled={deletePending}
                  className="button danger w-full"
                >
                  {deletePending ? (
                    <LoaderCircle className="spin" size={17} aria-hidden="true" />
                  ) : (
                    <Trash2 size={17} aria-hidden="true" />
                  )}
                  <UiText>{"Hapus Akun Permanen"}</UiText>
                </button>
              </form>
            )}
            <ActionFeedback state={deleteState} pending={deletePending} pendingLabel="Menghapus akun…" />
          </div>
        </aside>

        {/* Kolom Kanan: Form Edit Data Akun */}
        <main className="admin-user-main">
          <form action={saveAction} className="panel admin-user-edit-card">
            <div className="panel-heading">
              <div>
                <h2><UiText>{"Edit Informasi Akun"}</UiText></h2>
                <p><UiText>{"Perbarui nama lengkap, hak akses peran, atau setel ulang kata sandi pengguna."}</UiText></p>
              </div>
            </div>

            <input type="hidden" name="id" value={user.id} />

            <div className="form-grid-stacked">
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
                  placeholder="Contoh: Budi Santoso"
                />
              </div>

              <div className="field">
                <label htmlFor="username"><UiText>{"Username"}</UiText></label>
                <Input
                  id="username"
                  name="username"
                  value={user.username}
                  readOnly
                  aria-describedby="username-note"
                />
                <small id="username-note" className="text-hint">
                  <UiText>{"Username bersifat unik dan tidak dapat diubah setelah dibuat."}</UiText>
                </small>
              </div>

              <div className="field">
                <label htmlFor="role"><UiText>{"Peran pengguna"}</UiText></label>
                <NativeSelect
                  id="role"
                  name="role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as User["role"])}
                  disabled={self}
                >
                  {Object.entries(roleLabel).map(([val, lbl]) => (
                    <option value={val} key={val}>
                      {t(lbl)}
                    </option>
                  ))}
                </NativeSelect>
                {self ? (
                  <>
                    <input type="hidden" name="role" value="admin" />
                    <small className="text-hint">
                      <UiText>{"Peran administrator akun Anda sendiri tidak dapat diubah."}</UiText>
                    </small>
                  </>
                ) : (
                  <small className="text-hint">
                    <UiText>{"Peran menentukan hak akses ruang dan fitur belajar di KODMOD."}</UiText>
                  </small>
                )}
              </div>

              <div className="field password-field">
                <label htmlFor="new_password">
                  <UiText>{"Reset kata sandi baru (opsional)"}</UiText>
                </label>
                <div className="password-input-wrap">
                  <input
                    id="new_password"
                    name="new_password"
                    type={showPassword ? "text" : "password"}
                    minLength={8}
                    maxLength={72}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Kosongkan jika tidak ingin mengubah sandi"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="password-toggle-btn"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? t("Sembunyikan kata sandi") : t("Tampilkan kata sandi")}
                  >
                    {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                  </button>
                </div>
                <small className="text-hint">
                  <UiText>{"Minimal 8 karakter jika diisi. Biarkan kosong jika tidak diubah."}</UiText>
                </small>
              </div>
            </div>

            <ActionFeedback state={saveState} pending={savePending} pendingLabel="Menyimpan akun…" />

            <div className="form-footer-actions">
              <Link href="/admin/pengguna" className="button secondary">
                <UiText>{"Batal"}</UiText>
              </Link>
              <button
                type="submit"
                disabled={savePending}
                className="button primary"
              >
                {savePending ? (
                  <LoaderCircle className="spin" size={18} aria-hidden="true" />
                ) : (
                  <Save size={18} aria-hidden="true" />
                )}
                <UiText>{"Simpan Perubahan"}</UiText>
              </button>
            </div>
          </form>
        </main>
      </div>
    </div>
  );
}

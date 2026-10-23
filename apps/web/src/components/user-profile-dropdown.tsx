"use client";
import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ChevronDown, LogOut, User, ShieldCheck, GraduationCap, BookOpen, LoaderCircle } from "lucide-react";
import { logout } from "@/app/actions";
import { confirmAction } from "@/lib/dialogs";
import { speechOutput } from "@/lib/browser-speech";
import { useI18n } from "./language-provider";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "./ui/dropdown-menu";

export function UserProfileDropdown({ user, roleLabel, role = "student" }: {
  user: { full_name: string; username: string }; roleLabel: string; role?: "admin" | "teacher" | "student";
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false), [pending, startTransition] = useTransition();
  const trigger = useRef<HTMLButtonElement>(null), confirming = useRef(false);
  async function handleLogout() {
    confirming.current = true;
    speechOutput.stop(); setOpen(false);
    try {
      if (await confirmAction({ title: "Yakin ingin keluar?", text: "Anda perlu masuk kembali untuk mengakses ruang KODMOD.", confirmText: "Ya, keluar", destructive: true })) {
        startTransition(async () => { await logout(); });
      } else trigger.current?.focus();
    } finally { confirming.current = false; }
  }
  const roleIcon = role === "admin" ? <ShieldCheck size={16} aria-hidden="true" /> : role === "teacher" ? <GraduationCap size={16} aria-hidden="true" /> : <BookOpen size={16} aria-hidden="true" />;
  const initial = user.full_name.trim().slice(0, 1).toUpperCase() || "U";
  const destination = role === "admin" ? "/admin" : role === "teacher" ? "/teacher" : "/student/progress";
  const label = role === "admin" ? "Ruang administrasi" : role === "teacher" ? "Ruang mengajar" : "Progres saya";
  return <div className="profile-dropdown-container"><DropdownMenu open={open} onOpenChange={setOpen}>
    <DropdownMenuTrigger asChild><button ref={trigger} type="button" className={`profile-dropdown-trigger ${open ? "open" : ""}`} aria-label={t(pending ? "Keluar…" : "Menu profil pengguna")} aria-busy={pending} disabled={pending}>
      <span className="avatar" aria-hidden="true">{pending ? <LoaderCircle className="spin" size={18} aria-hidden="true" /> : initial}</span>
      <span className="profile-dropdown-text"><strong>{user.full_name}</strong><small>{t(roleLabel)}</small></span>
      <ChevronDown size={15} className={`profile-dropdown-chevron ${open ? "rotate" : ""}`} aria-hidden="true" />
    </button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="profile-dropdown-menu" aria-label={t("Profil pengguna")} onCloseAutoFocus={event => { if (confirming.current) event.preventDefault(); }}>
      <DropdownMenuLabel className="profile-dropdown-header"><span className="avatar large" aria-hidden="true">{initial}</span>
        <span className="profile-dropdown-info"><strong className="profile-name">{user.full_name}</strong><span className="profile-username">@{user.username}</span><span className="profile-badge">{roleIcon}<span>{t(roleLabel)}</span></span></span>
      </DropdownMenuLabel>
      <DropdownMenuSeparator className="profile-dropdown-divider" />
      <DropdownMenuItem asChild><Link href={destination} className="profile-dropdown-item"><User size={17} aria-hidden="true" />{t(label)}</Link></DropdownMenuItem>
      <DropdownMenuSeparator className="profile-dropdown-divider" />
      <DropdownMenuItem className="profile-dropdown-item logout" disabled={pending} onSelect={() => void handleLogout()}>
        {pending ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : <LogOut size={17} aria-hidden="true" />}{t(pending ? "Keluar…" : "Keluar dari akun")}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu></div>;
}

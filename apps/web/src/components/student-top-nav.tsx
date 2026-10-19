"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import { Brand } from "./ui";
import { ExperienceToolbar } from "./experience-toolbar";
import { UserProfileDropdown } from "./user-profile-dropdown";
import { useI18n } from "./language-provider";
import type { User } from "@/lib/types";

interface StudentTopNavProps {
  user: User;
}

const pageTitles: Record<string, string> = {
  "/siswa/kelas": "Kelas Saya",
  "/siswa/materi": "Pustaka Materi",
  "/siswa/tutor": "Tutor AI",
  "/siswa/latihan": "Asesmen Mandiri",
  "/siswa/tugas": "Tugas Siswa",
  "/siswa/progres": "Progres Belajar",
};

export function StudentTopNav({ user }: StudentTopNavProps) {
  const { t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const isHub = pathname === "/siswa";

  // Match active title for sub-pages
  let activeTitle = "";
  if (!isHub) {
    for (const [route, label] of Object.entries(pageTitles)) {
      if (pathname === route || pathname.startsWith(`${route}/`)) {
        activeTitle = label;
        break;
      }
    }
    if (!activeTitle) {
      activeTitle = "Ruang Belajar";
    }
  }

  // Keyboard shortcut: Escape returns to Game Hub when on sub-pages
  useEffect(() => {
    if (isHub) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const active = document.activeElement;
        const isInput =
          active &&
          ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName);
        const isModal = document.querySelector(".swal2-shown, dialog[open]");
        if (!isInput && !isModal) {
          e.preventDefault();
          router.push("/siswa");
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isHub, router]);

  return (
    <header className="student-header" role="banner">
      <div className="student-header-inner">
        <div className="student-header-left">
          <Brand href="/siswa" />
          {!isHub && (
            <div className="student-nav-context">
              <Link
                href="/siswa"
                className="student-back-to-hub-btn"
                data-voice-menu="back-home"
                aria-label={t("Kembali ke Menu Utama Belajar. Pintasan tombol Escape.")}
              >
                <ArrowLeft size={18} aria-hidden="true" />
                <span className="student-back-label">{t("Menu Utama")}</span>
                <kbd className="student-kbd-hint">Esc</kbd>
              </Link>
              {activeTitle && (
                <span className="student-current-page-pill" aria-current="page">
                  {t(activeTitle)}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="student-header-right">
          <div className="student-header-toolbar-wrap">
            <ExperienceToolbar />
          </div>
          <UserProfileDropdown
            user={user}
            roleLabel={t("Siswa")}
            role="student"
          />
        </div>
      </div>
    </header>
  );
}

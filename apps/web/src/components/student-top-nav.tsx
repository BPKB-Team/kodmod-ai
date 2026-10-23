"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import { Brand } from "./ui";
import { ExperienceToolbar } from "./experience-toolbar";
import { UserProfileDropdown } from "./user-profile-dropdown";
import { useI18n } from "./language-provider";
import { speechOutput } from "@/lib/browser-speech";
import type { User } from "@/lib/types";

interface StudentTopNavProps {
  user: User;
}

export function StudentTopNav({ user }: StudentTopNavProps) {
  const { t } = useI18n();

  return (
    <header className="student-header" role="banner">
      <div className="student-header-inner">
        <div className="student-header-left">
          <Brand href="/student" />
        </div>

        <div className="student-header-toolbar-wrap">
          <ExperienceToolbar />
        </div>

        <div className="student-header-right">
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

export function StudentBackBar() {
  const { t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const isHub = pathname === "/student";

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
          speechOutput.stop();
          router.push("/student");
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isHub, router]);

  if (isHub) return null;

  return (
    <div className="student-back-bar">
      <Link
        href="/student"
        className="student-back-to-hub-btn"
        data-voice-menu="back-home"
        aria-label={t("Kembali ke Menu Utama Belajar. Pintasan tombol Escape.")}
        onClick={() => speechOutput.stop()}
      >
        <ArrowLeft size={16} aria-hidden="true" />
        <span className="student-back-label">{t("Menu Utama")}</span>
        <kbd className="student-kbd-hint">Esc</kbd>
      </Link>
    </div>
  );
}

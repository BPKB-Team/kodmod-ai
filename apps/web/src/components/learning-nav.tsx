"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { speechOutput } from "@/lib/browser-speech";
import { useI18n } from "./language-provider";
import { LogoutButton } from "./logout-button";
import {
  LayoutDashboard,
  Library,
  BookOpen,
  ListChecks,
  MessageCircle,
  LineChart,
  ChevronRight,
  ClipboardList,
  Menu,
  X,
} from "lucide-react";

export function LearningNav({ base }: { base: string }) {
  const { t } = useI18n();
  const path = usePathname();
  const navigationId = useId();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [menuOpen]);

  const handleNavClick = () => {
    speechOutput.stop();
    setMenuOpen(false);
  };

  return (
    <>
    <button
      type="button"
      className="learning-nav-toggle"
      aria-expanded={menuOpen}
      aria-controls={navigationId}
      aria-label={t(menuOpen ? "Tutup menu ruang belajar" : "Menu ruang belajar")}
      onClick={() => setMenuOpen(open => !open)}
    >
      {menuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
      <span>{t("Menu ruang belajar")}</span>
      <ChevronRight size={18} aria-hidden="true" />
    </button>
    {menuOpen && (
      <div
        className="learning-nav-backdrop"
        aria-hidden="true"
        onClick={() => setMenuOpen(false)}
      />
    )}
    <nav id={navigationId} className={`admin-nav${menuOpen ? " is-open" : ""}`} aria-label={t("Menu ruang belajar")}>
      {[
        { href: base, title: "Ringkasan", icon: LayoutDashboard },
        ...(base === "/teacher"
          ? [
              { href: "/teacher/classes", title: "Kelas", icon: Library },
              { href: "/teacher/materials", title: "Materi", icon: BookOpen },
              { href: "/teacher/quizzes", title: "Kuis & Tugas", icon: ListChecks },
              { href: "/teacher/analytics", title: "Analitik", icon: LineChart },
            ]
          : []),
        ...(base === "/student"
          ? [
              { href: "/student/tutor", title: "Tutor AI", icon: MessageCircle },
              { href: "/student/practice", title: "Latihan & Kuis", icon: ListChecks },
              { href: "/student/assignments", title: "Tugas", icon: ClipboardList },
              { href: "/student/progress", title: "Progres", icon: LineChart },
              { href: "/student/classes", title: "Kelas", icon: Library },
              { href: "/student/materials", title: "Materi", icon: BookOpen },
            ]
          : []),
      ].map(({ href, title, icon: Icon }) => {
        const active = href === base ? path === href : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={handleNavClick}
            data-voice-menu={
              href === base
                ? "dashboard"
                : (
                    {
                      classes: "classes",
                      materials: "materials",
                      tutor: "tutor",
                      practice: "practice",
                      assignments: "assignments",
                      progress: "progress",
                      quizzes: "quizzes",
                      "quiz-reviews": "review",
                      analytics: "analytics",
                    } as Record<string, string>
                  )[href.split("/").at(-1) ?? ""]
            }
            aria-current={active ? "page" : undefined}
          >
            <Icon size={19} aria-hidden="true" />
            <span>{t(title)}</span>
            {active && (
              <ChevronRight
                className="nav-arrow"
                size={16}
                aria-hidden="true"
              />
            )}
          </Link>
        );
      })}
      <div className="admin-nav-divider" aria-hidden="true" />
      <LogoutButton variant="nav" />
    </nav>
    </>
  );
}

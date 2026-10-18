"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useState } from "react";
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
  FileCheck2,
  ClipboardList,
  Menu,
} from "lucide-react";

export function LearningNav({ base }: { base: string }) {
  const { t } = useI18n();
  const path = usePathname();
  const navigationId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <>
    <button type="button" className="learning-nav-toggle" aria-expanded={menuOpen} aria-controls={navigationId}
      onClick={() => setMenuOpen(open => !open)}><Menu size={20} aria-hidden="true" />{t("Menu ruang belajar")}
      <ChevronRight size={18} aria-hidden="true" /></button>
    <nav id={navigationId} className={`admin-nav${menuOpen ? " is-open" : ""}`} aria-label={t("Menu ruang belajar")}>
      {[
        { href: base, title: "Ringkasan", icon: LayoutDashboard },
        { href: `${base}/kelas`, title: "Kelas", icon: Library },
        ...(base === "/guru"
          ? [
              { href: "/guru/materi", title: "Materi", icon: BookOpen },
              { href: "/guru/kuis", title: "Kuis & Tugas", icon: ListChecks },
              { href: "/guru/review-kuis", title: "Review kuis", icon: FileCheck2 },
              { href: "/guru/analitik", title: "Analitik", icon: LineChart },
            ]
          : []),
        ...(base === "/siswa"
          ? [
              { href: "/siswa/materi", title: "Materi", icon: BookOpen },
              { href: "/siswa/tutor", title: "Tutor AI", icon: MessageCircle },
              { href: "/siswa/latihan", title: "Asesmen mandiri", icon: ListChecks },
              { href: "/siswa/tugas", title: "Tugas", icon: ClipboardList },
              { href: "/siswa/progres", title: "Progres", icon: LineChart },
            ]
          : []),
      ].map(({ href, title, icon: Icon }) => {
        const active = href === base ? path === href : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setMenuOpen(false)}
            data-voice-menu={
              href === base
                ? "dashboard"
                : (
                    {
                      kelas: "classes",
                      materi: "materials",
                      tutor: "tutor",
                      latihan: "practice",
                      tugas: "assignments",
                      progres: "progress",
                      kuis: "quizzes",
                      "review-kuis": "review",
                      analitik: "analytics",
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

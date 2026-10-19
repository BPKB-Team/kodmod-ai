"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, LayoutDashboard, Users, ChevronRight, FileCheck2, Bot, BookOpen } from "lucide-react";
import { speechOutput } from "@/lib/browser-speech";
import { useI18n } from "./language-provider";
import { LogoutButton } from "./logout-button";
const links = [
  { href: "/admin", label: "Ringkasan", Icon: LayoutDashboard },
  { href: "/admin/pengguna", label: "Pengguna", Icon: Users },
  { href: "/admin/materi", label: "Materi", Icon: BookOpen },
  { href: "/admin/review-kuis", label: "Review kuis", Icon: FileCheck2 },
  { href: "/admin/aktivitas", label: "Aktivitas", Icon: Activity },
  { href: "/admin/pemantauan-ai", label: "Pantau AI", Icon: Bot },
];
export function AdminNav() {
  const { t } = useI18n();
  const path = usePathname();

  const handleNavClick = () => {
    speechOutput.stop();
  };

  return (
    <nav className="admin-nav" aria-label={t("Navigasi admin")}>
      {links.map(({ href, label, Icon }) => {
        const active =
          href === "/admin" ? path === href : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={handleNavClick}
            data-voice-menu={{ "/admin": "dashboard", "/admin/pengguna": "users", "/admin/materi": "materials", "/admin/review-kuis": "review", "/admin/aktivitas": "activity", "/admin/pemantauan-ai": "ai-monitor" }[href]}
            aria-current={active ? "page" : undefined}
          >
            <Icon size={20} aria-hidden="true" />
            <span>{t(label)}</span>
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
  );
}

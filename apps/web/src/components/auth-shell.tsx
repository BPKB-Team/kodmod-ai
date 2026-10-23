import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import { ExperienceToolbar } from "./experience-toolbar";
import { getServerI18n } from "@/lib/server-language";
import "../styles/public-learning.css";

export async function AuthShell({
  children,
  register = false,
}: {
  children: ReactNode;
  register?: boolean;
}) {
  const { t } = await getServerI18n();
  return (
    <div className={`auth-page learning-auth${register ? " auth-register" : ""}`}>
      <div className="auth-cosmic-grid" aria-hidden="true" />
      <div className="auth-globe-mesh" aria-hidden="true">
        <svg viewBox="0 0 1000 1000" fill="none" className="auth-globe-svg" aria-hidden="true">
          <defs>
            <radialGradient id="authGlobeGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.14" />
              <stop offset="50%" stopColor="#2563eb" stopOpacity="0.05" />
              <stop offset="90%" stopColor="#020817" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="authGlobeLine" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.28" />
              <stop offset="50%" stopColor="#60a5fa" stopOpacity="0.14" />
              <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0.04" />
            </linearGradient>
          </defs>
          <circle cx="500" cy="500" r="440" fill="url(#authGlobeGlow)" />
          <circle cx="500" cy="500" r="440" stroke="url(#authGlobeLine)" strokeWidth="1.5" strokeDasharray="6 6" />
          <circle cx="500" cy="500" r="350" stroke="url(#authGlobeLine)" strokeWidth="1" strokeDasharray="4 6" opacity="0.6" />
          <ellipse cx="500" cy="500" rx="440" ry="130" stroke="url(#authGlobeLine)" strokeWidth="1" strokeDasharray="3 5" />
          <ellipse cx="500" cy="500" rx="440" ry="260" stroke="url(#authGlobeLine)" strokeWidth="1" strokeDasharray="3 5" />
          <ellipse cx="500" cy="500" rx="150" ry="440" stroke="url(#authGlobeLine)" strokeWidth="1" strokeDasharray="3 5" />
        </svg>
      </div>

      <header className="auth-topbar">
        <ExperienceToolbar />
      </header>

      <main id="konten-utama" tabIndex={-1} className="auth-main">
        <div className="auth-card">
          <div className="auth-card-brand">
            <Link href="/" aria-label={t("KODMOD, halaman utama")} data-voice-menu="home" className="auth-brand-logo">
              <Image src="/brand/symbol.png" alt="" width={28} height={30} />
              <span>KODMOD<span className="auth-brand-dot">.</span></span>
            </Link>
          </div>
          {children}
        </div>
      </main>

      <footer className="auth-footer">
        <p className="auth-copyright">
          KODMOD · {t("Ruang belajar untuk semua.")}
        </p>
      </footer>
    </div>
  );
}

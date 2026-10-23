"use client";

import Image from "next/image";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { useI18n } from "./language-provider";

export function LandingFooter() {
  const { t } = useI18n();

  return (
    <footer className="lp-master-footer">
      <div className="lp-master-footer-glow" aria-hidden="true" />
      <div className="lp-container lp-master-footer-inner">
        {/* Kolom Kiri: Brand & Misi Singkat */}
        <div className="lp-footer-brand-col">
          <Link href="/" className="lp-brand" aria-label="KODMOD" data-voice-menu="footer-brand">
            <Image src="/brand/symbol.png" alt="" width={38} height={40} />
            <span>KODMOD<span className="lp-brand-dot">.</span></span>
          </Link>
          <div className="lp-footer-slogan-tag" data-voice-menu="slogan" tabIndex={0}>
            <Sparkles size={14} className="lp-footer-slogan-sparkle" aria-hidden="true" />
            <span>{t("BEYOND ACCESS, BEYOND SIGHT")}</span>
          </div>
          <p className="lp-footer-mission" data-voice-menu="footer-brand" tabIndex={0}>
            {t("Platform belajar audio-first berbasis AI untuk kesetaraan pendidikan.")}
          </p>
        </div>

        <div className="lp-footer-divider" aria-hidden="true" />

        {/* Navigasi Ringkas Ditengahkan */}
        <div className="lp-footer-nav-col">
          <div className="lp-footer-nav-group">
            <h4 className="lp-footer-col-title">{t("Navigasi")}</h4>
            <ul className="lp-footer-links">
              <li>
                <a href="#tentang" data-voice-menu="footer-nav-about">{t("Tentang KODMOD")}</a>
              </li>
              <li>
                <a href="#pilar-solusi" data-voice-menu="footer-nav-pillars">{t("Pilar Solusi")}</a>
              </li>
              <li>
                <a href="#faq" data-voice-menu="footer-nav-faq">{t("Pertanyaan umum")}</a>
              </li>
              <li>
                <a href="#sponsor" data-voice-menu="footer-nav-sponsor">{t("Sponsor")}</a>
              </li>
            </ul>
          </div>

          <div className="lp-footer-nav-group">
            <h4 className="lp-footer-col-title">{t("Ruang Belajar")}</h4>
            <ul className="lp-footer-links">
              <li>
                <Link href="/siswa" data-voice-menu="footer-room-student">{t("Ruang siswa")}</Link>
              </li>
              <li>
                <Link href="/guru" data-voice-menu="footer-room-teacher">{t("Ruang guru")}</Link>
              </li>
              <li>
                <Link href="/daftar" data-voice-menu="cta-register">{t("Mulai belajar")}</Link>
              </li>
              <li>
                <Link href="/masuk" data-voice-menu="login">{t("Masuk")}</Link>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Baris Bawah (Copyright) */}
      <div className="lp-footer-bottom-bar">
        <div className="lp-container lp-footer-bottom-layout">
          <span className="lp-footer-copyright">
            © {new Date().getFullYear()} KODMOD. {t("Ruang belajar untuk semua.")}
          </span>
        </div>
      </div>
    </footer>
  );
}

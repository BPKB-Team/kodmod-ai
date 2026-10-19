"use client";

import Image from "next/image";
import Link from "next/link";
import { Sliders, Volume2, ShieldCheck, Sparkles, Globe } from "lucide-react";
import { useI18n } from "./language-provider";
import { useVoicePreferences } from "./voice-preferences-provider";

export function LandingFooter() {
  const { t } = useI18n();
  const { openVoicePreferences } = useVoicePreferences();

  return (
    <footer className="lp-master-footer">
      <div className="lp-master-footer-glow" aria-hidden="true" />
      <div className="lp-container lp-master-footer-inner">
        {/* Kolom 1: Brand & Misi */}
        <div className="lp-footer-col lp-footer-brand-col">
          <Link href="/" className="lp-brand" aria-label="KODMOD" data-voice-menu="footer-brand">
            <Image src="/brand/symbol.png" alt="" width={38} height={40} />
            <span>KODMOD<span className="lp-brand-dot">.</span></span>
          </Link>
          <div className="lp-footer-slogan-tag" data-voice-menu="slogan" tabIndex={0}>
            <Sparkles size={14} className="lp-footer-slogan-sparkle" aria-hidden="true" />
            <span>{t("BEYOND ACCESS, BEYOND SIGHT")}</span>
          </div>
          <p className="lp-footer-mission" data-voice-menu="footer-brand" tabIndex={0}>
            {t("Asisten belajar interaktif berbasis Agentic AI untuk siswa disabilitas netra dan guru inklusif. Menghadirkan pembelajaran multi-sensori yang adil, mandiri, dan mendalam.")}
          </p>
          <div className="lp-footer-status-pill" data-voice-menu="footer-status" tabIndex={0} role="status" aria-label={`${t("Mesin Suara AI Aktif")}. ${t("Audio-First")}`}>
            <span className="lp-status-indicator-dot" aria-hidden="true" />
            <span>{t("Mesin Suara AI Aktif")} • {t("Audio-First")}</span>
          </div>
        </div>

        {/* Kolom 2: Navigasi */}
        <div className="lp-footer-col">
          <h4 className="lp-footer-col-title">{t("Navigasi")}</h4>
          <ul className="lp-footer-links">
            <li>
              <a href="#konten-utama" data-voice-menu="footer-nav-home">{t("Beranda")}</a>
            </li>
            <li>
              <a href="#tentang" data-voice-menu="footer-nav-about">{t("Tentang KODMOD")}</a>
            </li>
            <li>
              <a href="#demo-tutor" data-voice-menu="footer-nav-demo">{t("Simulasi AI")}</a>
            </li>
            <li>
              <a href="#pilar-solusi" data-voice-menu="footer-nav-pillars">{t("Pilar Solusi")}</a>
            </li>
            <li>
              <a href="#cara-belajar" data-voice-menu="footer-nav-how">{t("Cara belajar")}</a>
            </li>
            <li>
              <a href="#faq" data-voice-menu="footer-nav-faq">{t("Pertanyaan umum")}</a>
            </li>
          </ul>
        </div>

        {/* Kolom 3: Ruang Belajar */}
        <div className="lp-footer-col">
          <h4 className="lp-footer-col-title">{t("Ruang Belajar")}</h4>
          <ul className="lp-footer-links">
            <li>
              <Link href="/siswa" data-voice-menu="footer-room-student">{t("Ruang siswa")}</Link>
            </li>
            <li>
              <Link href="/guru" data-voice-menu="footer-room-teacher">{t("Ruang guru")}</Link>
            </li>
            <li>
              <Link href="/admin" data-voice-menu="footer-room-admin">{t("Ruang admin")}</Link>
            </li>
            <li>
              <Link href="/daftar" data-voice-menu="cta-register">{t("Mulai belajar")}</Link>
            </li>
            <li>
              <Link href="/masuk" data-voice-menu="login">{t("Masuk")}</Link>
            </li>
          </ul>
        </div>

        {/* Kolom 4: Aksesibilitas & Bantuan */}
        <div className="lp-footer-col">
          <h4 className="lp-footer-col-title">{t("Aksesibilitas & Bantuan")}</h4>
          <ul className="lp-footer-links">
            <li>
              <button
                type="button"
                className="lp-footer-btn-action"
                data-voice-menu="footer-voice-settings"
                onClick={openVoicePreferences}
                aria-label={t("Pengaturan suara")}
              >
                <Sliders size={15} aria-hidden="true" />
                <span>{t("Pengaturan suara")}</span>
              </button>
            </li>
            <li>
              <a href="#cara-belajar" data-voice-menu="footer-keyboard" className="lp-footer-link-icon">
                <Volume2 size={15} aria-hidden="true" />
                <span>{t("Navigasi keyboard")}</span>
              </a>
            </li>
            <li>
              <span className="lp-footer-static-info" data-voice-menu="footer-accessibility" tabIndex={0}>
                <ShieldCheck size={15} aria-hidden="true" />
                <span>{t("Komitmen Aksesibilitas WCAG 2.1 AA")}</span>
              </span>
            </li>
            <li>
              <span className="lp-footer-static-info" data-voice-menu="sdg-badge" tabIndex={0}>
                <Globe size={15} aria-hidden="true" />
                <span>{t("Mendukung UN SDG 4: Quality Education")}</span>
              </span>
            </li>
          </ul>
        </div>
      </div>

      {/* Baris Bawah (Copyright & Badge) */}
      <div className="lp-footer-bottom-bar">
        <div className="lp-container lp-footer-bottom-layout">
          <span className="lp-footer-copyright">
            © {new Date().getFullYear()} KODMOD. {t("BEYOND ACCESS, BEYOND SIGHT")}. {t("Hak Cipta Dilindungi")}.
          </span>
          <div className="lp-footer-bottom-badges">
            <span className="lp-footer-badge-tag" data-voice-menu="footer-accessibility" tabIndex={0}>
              WCAG 2.1 AA
            </span>
            <span className="lp-footer-badge-tag" data-voice-menu="sdg-badge" tabIndex={0}>
              UN SDG 4
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}

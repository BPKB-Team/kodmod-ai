"use client";
import { UiText } from "@/components/language-provider";

export default function ErrorPage() {
  return (
    <main id="main-content" tabIndex={-1} className="error-page">
      <h1><UiText>{"Ruang ini belum dapat dimuat."}</UiText></h1>
      <p><UiText>{"Layanan mungkin sedang tidak tersedia. Coba muat ulang beberapa saat lagi."}</UiText></p>
      <div className="hero-actions">
        <button className="button primary" onClick={() => window.location.reload()}><UiText>{"Coba lagi"}</UiText></button>
        {/* A full navigation recovers from an outdated client bundle after a deployment. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="button secondary"><UiText>{"Ke beranda"}</UiText></a>
      </div>
    </main>
  );
}

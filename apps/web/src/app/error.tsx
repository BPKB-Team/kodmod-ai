"use client";
import { UiText } from "@/components/language-provider";

import Link from "next/link";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main-content" tabIndex={-1} className="error-page">
      <h1><UiText>{"Ruang ini belum dapat dimuat."}</UiText></h1>
      <p><UiText>{"Layanan mungkin sedang tidak tersedia. Coba muat ulang beberapa saat lagi."}</UiText></p>
      <div className="hero-actions">
        <button className="button primary" onClick={reset}><UiText>{"Coba lagi"}</UiText></button>
        <Link href="/" className="button secondary"><UiText>{"Ke beranda"}</UiText></Link>
      </div>
    </main>
  );
}

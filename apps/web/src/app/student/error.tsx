"use client";
import { UiText } from "@/components/language-provider";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className="panel learning-section">
      <h1><UiText>{"Ruang belajar belum dapat dimuat."}</UiText></h1>
      <p className="muted"><UiText>{"Koneksi layanan sedang bermasalah. Data Anda tetap tersimpan. Coba muat ulang beberapa saat lagi."}</UiText></p>
      <button className="button primary" onClick={reset}><UiText>{"Coba lagi"}</UiText></button>
    </section>
  );
}

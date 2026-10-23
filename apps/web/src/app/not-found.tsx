
import { UiText } from "@/components/language-provider";
import Link from "next/link";
import { BookOpen } from "lucide-react";
export default function NotFound() {
  return (
    <main id="main-content" tabIndex={-1} className="error-page">
      <BookOpen size={48} aria-hidden="true" />
      <h1><UiText>{"Halaman tidak ditemukan."}</UiText></h1>
      <p><UiText>{"Halaman atau data ini mungkin sudah tidak tersedia."}</UiText></p>
      <Link href="/" className="button primary"><UiText>{"Kembali ke beranda"}</UiText></Link>
    </main>
  );
}

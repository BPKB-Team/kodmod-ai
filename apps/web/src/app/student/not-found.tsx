
import { UiText } from "@/components/language-provider";
import Link from "next/link";
export default function NotFound() {
  return (
    <section className="panel learning-section">
      <h1><UiText>{"Ruang ini tidak tersedia."}</UiText></h1>
      <p className="muted"><UiText>{"Kelas atau materi mungkin sudah diarsipkan, belum diterbitkan, atau tidak dapat diakses akun Anda."}</UiText></p>
      <Link className="button primary" href="/student/classes"><UiText>{"Kembali ke kelas saya"}</UiText></Link>
    </section>
  );
}

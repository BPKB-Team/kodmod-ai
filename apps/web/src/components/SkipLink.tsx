/**
 * Tautan lewati-navigasi. Harus jadi elemen fokusable PERTAMA di halaman
 * (WCAG 2.4.1 Bypass Blocks) supaya pengguna keyboard/screen reader tidak
 * perlu menelusuri seluruh nav di setiap halaman.
 */
import { UiText } from "./language-provider";
export default function SkipLink() {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-3 focus:text-kodmod-ink focus:shadow-lg"
    >
      <UiText>Lewati ke konten utama</UiText>
    </a>
  );
}

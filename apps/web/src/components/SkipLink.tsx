/**
 * Tautan lewati-navigasi. Harus jadi elemen fokusable PERTAMA di halaman
 * (WCAG 2.4.1 Bypass Blocks) supaya pengguna keyboard/screen reader tidak
 * perlu menelusuri seluruh nav di setiap halaman.
 */
export default function SkipLink() {
  return (
    <a
      href="#konten-utama"
      className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-3 focus:text-kodmod-ink focus:shadow-lg"
    >
      Lewati ke konten utama
    </a>
  );
}

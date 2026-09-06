import { useEffect, useRef } from "react";

type Politeness = "polite" | "assertive";

/**
 * Kanal pengumuman untuk screen reader.
 *
 * Ini padanan non-audio dari TTS: setiap perubahan status yang terdengar
 * lewat suara HARUS punya jalur setara di sini, supaya pengguna yang memakai
 * NVDA/JAWS/TalkBack (mode screen-reader-native) mendapat informasi yang sama
 * tanpa dua suara bicara bersamaan.
 *
 * `polite`    → menunggu screen reader selesai bicara (default).
 * `assertive` → memotong. Pakai hanya untuk error atau hal mendesak.
 */
export default function LiveRegion({
  message,
  politeness = "polite",
}: {
  message: string;
  politeness?: Politeness;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Kosongkan lalu isi ulang: memaksa screen reader membacakan kembali
    // pesan yang sama persis (mis. "salah" dua kali berturut-turut).
    const node = ref.current;
    if (!node) return;
    node.textContent = "";
    const id = window.setTimeout(() => {
      node.textContent = message;
    }, 50);
    return () => window.clearTimeout(id);
  }, [message]);

  return <div ref={ref} role="status" aria-live={politeness} aria-atomic="true" className="sr-only" />;
}

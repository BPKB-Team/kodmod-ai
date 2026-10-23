"use client";

import { useState } from "react";
import SkipLink from "./components/SkipLink";
import LiveRegion from "./components/LiveRegion";
import { useI18n } from "./components/language-provider";

/**
 * Kerangka aplikasi.
 *
 * Ini SENGAJA masih kosong secara visual - desain UI/UX tim akan mengisinya.
 * Yang sudah dipasang di sini adalah hal-hal yang mahal kalau ditambahkan
 * belakangan: struktur landmark, skip link, live region, dan pemilih mode
 * screen reader.
 */
export default function App() {
  const { t } = useI18n();
  const [srMode, setSrMode] = useState<"native" | "conversational">("native");
  const [pengumuman, setPengumuman] = useState("");

  function gantiMode(mode: "native" | "conversational") {
    setSrMode(mode);
    setPengumuman(
      mode === "native"
        ? t("Mode pembaca layar aktif. Aplikasi tidak akan bersuara sendiri.")
        : t("Mode percakapan aktif. Aplikasi akan bersuara. Matikan pembaca layar Anda."),
    );
  }

  return (
    <>
      <SkipLink />
      <LiveRegion message={pengumuman} />

      <header className="border-b border-black/10 px-6 py-4">
        <h1 className="text-2xl font-bold">KODMOD</h1>
        <p className="text-sm opacity-70">{t("Asisten belajar untuk siswa tunanetra")}</p>
      </header>

      <nav aria-label={t("Navigasi utama")} className="border-b border-black/10 px-6 py-2">
        {/* Diisi saat rute ditambahkan. */}
      </nav>

      <main id="main-content" tabIndex={-1} className="px-6 py-8">
        <h2 className="text-xl font-semibold">{t("Mode suara")}</h2>
        <p className="mt-2 max-w-prose">
          {t("Pilih bagaimana KODMOD menyampaikan informasi. Ini menentukan apakah aplikasi bersuara sendiri atau menyerahkannya ke pembaca layar Anda.")}
        </p>

        <fieldset className="mt-6 max-w-prose">
          <legend className="font-medium">{t("Cara mendengarkan")}</legend>

          <label className="mt-3 flex items-center gap-3">
            <input
              type="radio"
              name="mode-suara"
              value="native"
              checked={srMode === "native"}
              onChange={() => gantiMode("native")}
            />
            <span>
              <strong>{t("Pembaca layar saya")}</strong> — {t("KODMOD diam, pembaca layar yang membacakan.")}
            </span>
          </label>

          <label className="mt-3 flex items-center gap-3">
            <input
              type="radio"
              name="mode-suara"
              value="conversational"
              checked={srMode === "conversational"}
              onChange={() => gantiMode("conversational")}
            />
            <span>
              <strong>{t("Suara KODMOD")}</strong> — {t("KODMOD berbicara dua arah. Matikan pembaca layar agar tidak ada dua suara bersamaan.")}
            </span>
          </label>
        </fieldset>
      </main>

      <footer className="border-t border-black/10 px-6 py-4 text-sm opacity-70">
        <p><span>KODMOD</span> — {t("Pendidikan inklusif untuk siswa tunanetra.")}</p>
      </footer>
    </>
  );
}

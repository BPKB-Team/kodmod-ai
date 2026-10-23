"use client";
import { Spinner } from "./ui/spinner";
import { NativeSelect } from "@/components/ui/native-select";

import { UiText, useI18n } from "@/components/language-provider";

import { useState } from "react";
import Link from "next/link";
import { Bookmark, CheckCircle2, MessageCircle } from "lucide-react";
import { ActionFeedback, useConfirmedAction } from "./action-feedback";
import {
  saveReadingProgress,
  saveReadingSettings,
} from "@/app/student-actions";
import {
  readingDefaults,
  type ReadingPreferences,
} from "@/lib/reading-preferences";
import type { Material } from "@/lib/class-types";
import { VoiceControls } from "./voice-controls";
import {MaterialRenderer} from "./material-renderer";
import {legacyMaterialDocument,materialPlainText} from "@/lib/material-document-adapter.mjs";

function ProgressButton({
  classId,
  materialId,
  field,
  active,
}: {
  classId: string;
  materialId: string;
  field: "completed" | "bookmarked";
  active: boolean;
}) {
  const { t } = useI18n();
  const completion = field === "completed";
  const label = completion
    ? active
      ? "Batalkan tanda selesai"
      : "Tandai sudah dipelajari"
    : active
      ? "Hapus bookmark"
      : "Simpan bookmark";
  const [state, action, pending] = useConfirmedAction(
    saveReadingProgress.bind(null, classId, materialId),
    {
      title: `${t(label)}?`,
      text: completion
        ? "Penanda ini membantu Anda mengatur bacaan. Ini bukan nilai atau penilaian penguasaan materi."
        : active
          ? "Materi tetap tersedia di pustaka selama Anda memiliki akses."
          : "Materi akan mudah ditemukan melalui filter Bookmark di pustaka Anda.",
      confirmText: "Ya, simpan",
      destructive: active,
    },
  );
  const Icon = completion ? CheckCircle2 : Bookmark;
  return (
    <form action={action}>
      <input type="hidden" name="field" value={field} />
      <input type="hidden" name="value" value={String(!active)} />
      <button
        className={`button ${completion ? "primary" : "secondary"}`}
        disabled={pending}
      >
        {pending ? <Spinner /> : <Icon size={18} aria-hidden="true" />}
        {pending ? <UiText>{"Menyimpan…"}</UiText> : <UiText>{label}</UiText>}
      </button>
      <ActionFeedback state={state} pending={pending} />
    </form>
  );
}

export function StudentReader({
  classId,
  material,
  preferences,
}: {
  classId: string;
  material: Material;
  preferences: ReadingPreferences;
}) {
  const { t } = useI18n();
  const [size, setSize] = useState(preferences.size);
  const [contrast, setContrast] = useState(preferences.contrast);
  const [spacing, setSpacing] = useState(preferences.spacing);
  const [settingsState, settingsAction, saving] = useConfirmedAction(
    saveReadingSettings,
    {
      title: "Simpan tampilan bacaan?",
      text: "Ukuran teks, jarak baris, dan kontras akan digunakan untuk materi lain saat akun ini dibuka di browser yang sama.",
      confirmText: "Ya, simpan",
    },
  );
  return (
    <div className="student-reader">
      <form
        action={settingsAction}
        onReset={(e) => e.preventDefault()}
        className="panel reader-controls"
        aria-label={t("Pengaturan bacaan")}
      >
        <div>
          <strong><UiText>{"Nyaman dibaca, sesuai kebutuhanmu."}</UiText></strong>
          <p><UiText>{"Pratinjau langsung di bawah. Simpan untuk memakai tampilan ini pada materi lain di browser yang sama."}</UiText></p>
        </div>
        <label className="field"><UiText>{"Ukuran teks"}</UiText><NativeSelect
            name="size"
            value={size}
            disabled={saving}
            onChange={(e) => setSize(e.target.value)}
          >
            <option value="18"><UiText>{"Standar"}</UiText></option>
            <option value="20"><UiText>{"Besar"}</UiText></option>
            <option value="24"><UiText>{"Lebih besar"}</UiText></option>
            <option value="28"><UiText>{"Sangat besar"}</UiText></option>
          </NativeSelect>
        </label>
        <label className="field"><UiText>{"Jarak baris"}</UiText><NativeSelect
            name="spacing"
            value={spacing}
            disabled={saving}
            onChange={(e) => setSpacing(e.target.value)}
          >
            <option value="1.65"><UiText>{"Rapat"}</UiText></option>
            <option value="1.95"><UiText>{"Nyaman"}</UiText></option>
            <option value="2.3"><UiText>{"Lega"}</UiText></option>
          </NativeSelect>
        </label>
        <label className="reader-contrast">
          <input
            type="checkbox"
            name="contrast"
            disabled={saving}
            checked={contrast}
            onChange={(e) => setContrast(e.target.checked)}
          /><UiText>{"Kontras tinggi"}</UiText></label>
        <div className="reader-settings-actions">
          <button className="button primary" disabled={saving}>
            {saving && <Spinner />}
            {saving ? <UiText>{"Menyimpan…"}</UiText> : <UiText>{"Simpan tampilan"}</UiText>}
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={saving}
            onClick={() => {
              setSize(readingDefaults.size);
              setSpacing(readingDefaults.spacing);
              setContrast(readingDefaults.contrast);
            }}
          ><UiText>{"Pratinjau bawaan"}</UiText></button>
          <ActionFeedback state={settingsState} pending={saving} />
        </div>
      </form>
      <div className="reader-status" role="status">
        {material.progress?.completed
          ? <UiText>{"Sudah Anda tandai dipelajari"}</UiText>
          : <UiText>{"Belum ditandai selesai"}</UiText>}
        {material.progress?.bookmarked ? <UiText>{" · Tersimpan di bookmark"}</UiText> : ""}
      </div>
      <VoiceControls text={material.speech_text??materialPlainText(material.document??legacyMaterialDocument(material.content??""))} />
      <article
        className={`panel material-reader ${contrast ? "reader-high-contrast" : ""}`}
        aria-label={t("Isi materi")}
        style={{ fontSize: `${size}px`, lineHeight: spacing }}
      >
        <MaterialRenderer document={material.document??legacyMaterialDocument(material.content??"")} classId={classId}/>
      </article>
      <section className="panel reader-tutor" aria-label={t("Belajar bersama Tutor")}>
        <div>
          <h2><UiText>{"Ada bagian yang ingin kamu pahami?"}</UiText></h2>
          <p><UiText>{"Bawa materi ini ke Tutor. Kamu bisa meminta penjelasan, contoh, atau latihan singkat berdasarkan bacaan."}</UiText></p>
          {material.rag_status && material.rag_status !== "ready" && <p role="status"><UiText>{"Materi masih disiapkan untuk Tutor. Kamu tetap bisa membaca atau mendengarkannya di sini."}</UiText></p>}
        </div>
        <Link className="button primary" href={`/student/tutor?class_id=${encodeURIComponent(classId)}&material_id=${encodeURIComponent(material.id)}`}><MessageCircle size={18} aria-hidden="true" /><UiText>{" Tanya Tutor tentang materi ini"}</UiText></Link>
      </section>
      <section className="panel reader-finish" aria-label={t("Progres bacaan")}>
        <div>
          <h2><UiText>{"Satu materi, satu langkah baru."}</UiText></h2>
          <p><UiText>{"Tandai setelah Anda selesai mempelajari materi ini. Anda bisa membacanya kembali kapan saja selama masih memiliki akses."}</UiText></p>
        </div>
        <div className="reader-actions">
          <ProgressButton
            classId={classId}
            materialId={material.id}
            field="completed"
            active={!!material.progress?.completed}
          />
          <ProgressButton
            classId={classId}
            materialId={material.id}
            field="bookmarked"
            active={!!material.progress?.bookmarked}
          />
        </div>
      </section>
    </div>
  );
}

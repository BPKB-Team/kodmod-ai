"use client";
import { Input } from "@/components/ui/input";


import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Save } from "lucide-react";
import type { AdminMaterial } from "@/lib/admin-material-types";
import { confirmAction, notifyResult } from "@/lib/dialogs";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { UiText, useI18n } from "./language-provider";
import type { MaterialImportRecord } from "@/lib/import-types";
import { LoadingStatus } from "./loading-feedback";
import {MaterialRichEditor} from "./material-rich-editor";
import {MaterialSourceReview} from "./material-source-review";
import {legacyMaterialDocument,validateMaterialDocument} from "@/lib/material-document-adapter.mjs";
import type {MaterialDocument} from "@/lib/material-document-types";

export function AdminMaterialEditor({ material }: { material: AdminMaterial }) {
  const router = useRouter();
  const { t } = useI18n();
  const [source, setSource] = useState<MaterialImportRecord | null>(null);
  const [title, setTitle] = useState(material.title);
  const [document,setDocument]=useState<MaterialDocument>(()=>material.document??legacyMaterialDocument(material.content??""));
  const [editorValid,setEditorValid]=useState(true);
  const [published, setPublished] = useState(material.published);
  const [busy, setBusy] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [sourceLoading, setSourceLoading] = useState(false);
  async function update(index = false) {
    if (busy || material.is_archived) return;
    if (!(await confirmAction({ title: index ? "Proses ulang materi?" : "Simpan perubahan materi?", text: index ? "Materi akan disiapkan kembali untuk Tutor." : "Perubahan berlaku untuk kelas ini. Materi yang terbit akan disiapkan untuk Tutor kembali jika isinya berubah.", confirmText: index ? "Proses ulang" : "Simpan perubahan" }))) return;
    setBusy(true);
    setIndexing(index);
    try {
      const response = await fetch(`/api/admin/materials/${material.id}${index ? "/index" : ""}`, {
        method: index ? "POST" : "PUT", headers: { "Content-Type": "application/json" },
        ...(!index ? { body: JSON.stringify({ title, document, expected_version:material.content_version, published, source_filename: material.source_filename ?? null, source_import_id: material.source_import_id ?? null }) } : {}),
      });
      if (!response.ok) { const body = await response.json(); throw new Error(response.status===409?"Materi sudah berubah. Draft Anda tetap ada. Buka revisi terbaru sebelum menyimpan kembali.":body.message || "Materi belum dapat disimpan."); }
      await notifyResult(index ? "Materi sedang disiapkan ulang." : "Perubahan materi berhasil disimpan.");
      router.refresh();
    } catch (caught) { await notifyResult(caught instanceof Error ? caught.message : "Materi belum dapat disimpan.", true); }
    finally { setBusy(false); }
  }
  return <form className="panel admin-material-form" onSubmit={(event) => { event.preventDefault(); void update(); }}>
    <LoadingStatus active={busy} label={indexing ? "Menyiapkan ulang materi…" : "Menyimpan materi…"} />
    {material.source_import_id && <section className="material-import-notice">
      <strong>{t("Berkas sumber")}</strong>
      <div className="material-status-actions"><a className="button secondary" href={`/api/admin/materials/${material.id}/original`} download>{t("Unduh berkas asli")}</a>
      <Button type="button" variant="outline" loading={sourceLoading} loadingText={t("Membuka sumber dokumen…")} onClick={async () => {
        if (sourceLoading) return;
        setSourceLoading(true);
        try { const response = await fetch(`/api/admin/materials/${material.id}/source`); if (!response.ok) throw new Error("Berkas sumber belum dapat dibuka."); setSource(await response.json()); }
        catch (caught) { await notifyResult(caught instanceof Error ? caught.message : "Berkas sumber belum dapat dibuka.", true); }
        finally { setSourceLoading(false); }
      }}>{t("Lihat asal halaman")}</Button></div>
      <LoadingStatus active={sourceLoading} label="Membuka sumber dokumen…" compact />
      {source && <div><p>{source.filename}</p><ul>{source.preview?.pages?.map(page => <li key={page.page}>{t("Halaman {page}", { page: page.page })} · {page.method === "ocr" ? t("Dibaca dari gambar") : t("Teks asli")}{page.confidence != null && ` · ${t("Keyakinan pembacaan {confidence}%", { confidence: page.confidence })}`}</li>)}</ul></div>}
    </section>}
    <label className="field"><UiText>{"Judul materi"}</UiText><Input required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} disabled={busy || material.is_archived} /></label>
    <MaterialRichEditor value={document} onChange={setDocument} classId={material.class_id} disabled={busy||material.is_archived} onValidityChange={setEditorValid}/>
    <MaterialSourceReview document={document} onChange={next=>{try{setDocument(validateMaterialDocument(next));setEditorValid(true);}catch{void notifyResult("Periksa format rumus dan teks sebelum menyimpan.",true);}}} classId={material.class_id} disabled={busy||material.is_archived} originalUrl={material.source_import_id&&/\.pdf/i.test(material.source_filename??"")?`/api/admin/materials/${material.id}/original`:undefined}/>

    <label className="admin-material-publish"><Switch checked={published} onCheckedChange={setPublished} disabled={busy || material.is_archived} aria-label="Terbitkan materi" /><span><strong><UiText>{"Terbitkan materi"}</UiText></strong><small><UiText>{"Siswa hanya dapat membuka materi yang terbit di kelasnya."}</UiText></small></span></label>
    <div className="guided-actions"><Button type="submit" loading={busy && !indexing} loadingText={t("Menyimpan materi…")} disabled={busy || material.is_archived || !title.trim() || !document.blocks.length||!editorValid}><Save size={17} aria-hidden="true" /><UiText>{"Simpan perubahan"}</UiText></Button><Button variant="outline" type="button" loading={busy && indexing} loadingText={t("Menyiapkan ulang materi…")} onClick={() => void update(true)} disabled={busy || material.is_archived || !material.published}><RotateCcw size={17} aria-hidden="true" /><UiText>{"Proses ulang"}</UiText></Button></div>
  </form>;
}

"use client";
import { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw, FileCheck2 } from "lucide-react";
import type { MaterialImportRecord } from "@/lib/import-types";
import { confirmAction, notifyResult } from "@/lib/dialogs";
import { Button } from "./ui/button";
import { useI18n } from "./language-provider";
import { LoadingStatus } from "./loading-feedback";
import { Spinner } from "./ui/spinner";
import { Skeleton } from "./ui/skeleton";

export function MaterialImportHistory({ classId, refreshKey, onPreview }: {
  classId: string; refreshKey: number; onPreview: (record: MaterialImportRecord) => Promise<void>;
}) {
  const { t } = useI18n();
  const [records, setRecords] = useState<MaterialImportRecord[]>([]), [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyLabel, setBusyLabel] = useState("");
  const base = `/api/classes/${classId}/imports`;
  const refresh = useCallback(async (signal?: AbortSignal, showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const response = await fetch(base, { signal, cache: "no-store" });
      if (!response.ok) throw new Error(t("Riwayat dokumen belum dapat dibuka."));
      const data = await response.json();
      if (signal?.aborted) return;
      if (!Array.isArray(data)) throw new Error(t("Riwayat dokumen belum dapat dibuka."));
      setRecords(data); setError("");
    } catch (caught) { if (!signal?.aborted) setError(caught instanceof Error ? caught.message : t("Riwayat dokumen belum dapat dibuka.")); }
    finally { if (showLoading && !signal?.aborted) setLoading(false); }
  }, [base, t]);
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => { if (!controller.signal.aborted) void refresh(controller.signal, true); });
    return () => controller.abort();
  }, [refresh, refreshKey]);
  const processing = records.some(record => ["pending", "running", "retry"].includes(record.state));
  useEffect(() => {
    if (!processing) return;
    const controller = new AbortController();
    const timer = setInterval(() => void refresh(controller.signal), 3000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [processing, refresh]);
  async function open(record: MaterialImportRecord, retry = false) {
    if (busy) return;
    if (retry && !(await confirmAction({ title: "Proses ulang dokumen?", text: "Berkas asli yang tersimpan akan dibaca lagi.", confirmText: "Proses ulang" }))) return;
    setBusy(record.import_id);
    setBusyLabel(retry ? "Mengirim dokumen untuk diproses ulang…" : "Membuka hasil dokumen…");
    try {
      const response = await fetch(`${base}/${record.import_id}${retry ? "/retry" : ""}`, { method: retry ? "POST" : "GET", cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || t("Dokumen belum dapat dibaca."));
      if (!retry) await onPreview(data);
      await refresh();
    } catch (caught) { await notifyResult(caught instanceof Error ? caught.message : "Dokumen belum dapat dibaca.", true); }
    finally { setBusy(""); }
  }
  return <details className="material-import-history" open={processing || undefined}>
    <summary>{(loading || processing) && <Spinner className="loading-inline-icon" />}{t("Dokumen tersimpan")}{processing && ` · ${t("Sedang diproses")}`}</summary>
    <p>{t("Hasil pembacaan tetap tersimpan. Buka dan tinjau sebelum digunakan sebagai materi.")}</p>
    <Button type="button" variant="outline" onClick={() => void refresh(undefined, true)} disabled={loading || Boolean(busy)} loading={loading} loadingText={t("Memuat riwayat dokumen…")}><RefreshCw size={16} aria-hidden="true" />{t("Perbarui status")}</Button>
    <LoadingStatus active={loading || Boolean(busy)} label={busy ? busyLabel : "Memuat riwayat dokumen…"} compact />
    {error && <p role="alert">{t(error)}</p>}
    {loading && !records.length && <div aria-hidden="true"><Skeleton className="page-loading-field" /><Skeleton className="page-loading-field" /></div>}
    {!loading && !error && !records.length && <p>{t("Belum ada dokumen tersimpan.")}</p>}
    <ul className="import-records" aria-busy={loading}>{records.map(record => <li key={record.import_id}>
      <div><strong>{record.filename}</strong><p>{["pending", "running", "retry"].includes(record.state) && <Spinner className="loading-inline-icon" />}{t(({ complete: "Siap ditinjau", failed: "Perlu diproses ulang", running: "Sedang diproses", pending: "Dalam antrean", retry: "Menunggu percobaan ulang" })[record.state])}</p></div>
      <div className="material-status-actions">
        {record.state === "complete" && <Button type="button" onClick={() => void open(record)} disabled={loading || Boolean(busy)} loading={busy === record.import_id} loadingText={t("Membuka hasil…")}><FileCheck2 size={16} aria-hidden="true" />{t("Tinjau hasil")}</Button>}
        {record.state === "failed" && <Button type="button" variant="outline" onClick={() => void open(record, true)} disabled={loading || Boolean(busy)} loading={busy === record.import_id} loadingText={t("Memproses ulang…")}>{t("Proses ulang")}</Button>}
        <a className="button secondary" href={`${base}/${record.import_id}/original`} download><Download size={16} aria-hidden="true" />{t("Berkas asli")}</a>
      </div>
    </li>)}</ul>
  </details>;
}

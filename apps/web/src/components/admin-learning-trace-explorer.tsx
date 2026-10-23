"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Code2,
  Copy,
  Layers,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Volume2,
  Zap,
} from "lucide-react";
import { Heading } from "./ui";
import { UiText, UiDate, useI18n } from "./language-provider";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import type { AdminLearningTraces, AdminLearningTraceItem } from "@/lib/admin-insights-types";

export function AdminLearningTraceExplorer({
  initialData,
  initialRequestId = "",
}: {
  initialData: AdminLearningTraces;
  initialRequestId?: string;
}) {
  const { t, language } = useI18n();
  const locale = language === "en" ? "en-US" : "id-ID";
  const router = useRouter();

  const metric = (value: number | null | undefined) =>
    value === null || value === undefined ? t("Belum tersedia") : value.toLocaleString(locale);
  const cost = (value: number | null | undefined) =>
    value == null
      ? t("Belum tersedia")
      : new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 6 }).format(value);

  const [data, setData] = useState<AdminLearningTraces>(initialData);
  const [searchInput, setSearchInput] = useState(initialRequestId);
  const [activeRequestId, setActiveRequestId] = useState(initialRequestId);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [expandedJson, setExpandedJson] = useState<Record<string, boolean>>({});

  async function fetchTraces(requestId: string, page = 1) {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (requestId.trim()) query.set("request_id", requestId.trim());
      query.set("page", String(page));
      query.set("limit", "15");

      const res = await fetch(`/api/admin/insights/learning-traces?${query.toString()}`);
      if (!res.ok) throw new Error("Gagal memuat jejak");
      const json = (await res.json()) as AdminLearningTraces;
      setData(json);
      setActiveRequestId(requestId.trim());

      // Update URL query string without reloading page
      const sp = new URLSearchParams();
      if (requestId.trim()) sp.set("request_id", requestId.trim());
      if (page > 1) sp.set("page", String(page));
      const qs = sp.toString();
      router.replace(`/admin/pemantauan-ai/jejak${qs ? `?${qs}` : ""}`, { scroll: false });
    } catch {
      // silent or handled
    } finally {
      setLoading(false);
    }
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    void fetchTraces(searchInput, 1);
  }

  function handleReset() {
    setSearchInput("");
    void fetchTraces("", 1);
  }

  function handleSelectRequestId(id: string) {
    setSearchInput(id);
    void fetchTraces(id, 1);
  }

  function handleCopy(text: string) {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    }).catch(() => {});
  }

  function toggleJson(id: string) {
    setExpandedJson((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  // Calculate summary metrics if viewing a single trace request
  const totalStages = data.items.length;
  const totalLatencyMs = data.items.reduce((acc, it) => acc + (it.latency_ms || 0), 0);
  const totalCalls = data.items.reduce((acc, it) => acc + (it.provider_usage?.calls || 0), 0);
  const totalCostUsd = data.items.reduce(
    (acc, it) => acc + (typeof it.trace_cost_usd === "number" ? it.trace_cost_usd : 0),
    0
  );

  return (
    <div className="trace-explorer-page">
      <div className="trace-breadcrumb-nav">
        <Link href="/admin/pemantauan-ai" className="trace-back-btn">
          <ArrowLeft size={15} aria-hidden="true" />
          <span><UiText>{"Kembali ke Pantau AI"}</UiText></span>
        </Link>
        <span className="trace-crumb-divider" aria-hidden="true">/</span>
        <span className="trace-crumb-current"><UiText>{"Jejak Diagnostik AI"}</UiText></span>
      </div>

      <Heading
        icon={<Activity size={24} aria-hidden="true" />}
        title={<UiText>{"Jejak Diagnostik AI"}</UiText>}
        description={
          <UiText>
            {"Periksa alur LangGraph, pencarian materi, pembuatan kuis, dan penggunaan layanan AI secara terperinci."}
          </UiText>
        }
      >
        <button
          type="button"
          className="button secondary refresh-btn"
          onClick={() => void fetchTraces(activeRequestId, data.page)}
          disabled={loading}
        >
          <RefreshCw size={16} className={loading ? "spin" : undefined} aria-hidden="true" />
          <UiText>{"Perbarui Data"}</UiText>
        </button>
      </Heading>

      {/* Search Toolbar */}
      <section className="panel trace-search-panel" aria-label={t("Pencarian jejak")}>
        <form className="trace-search-form" onSubmit={handleSearch}>
          <div className="trace-search-input-wrap">
            <Search size={18} className="trace-search-icon" aria-hidden="true" />
            <input
              type="text"
              className="trace-search-input"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t("Cari berdasarkan nomor permintaan…")}
              aria-label={t("Nomor permintaan")}
              maxLength={64}
            />
            {searchInput && (
              <button
                type="button"
                className="trace-clear-btn"
                onClick={handleReset}
                aria-label={t("Reset pencarian")}
              >
                <RotateCcw size={14} aria-hidden="true" />
              </button>
            )}
          </div>
          <button type="submit" className="button primary trace-search-submit" disabled={loading}>
            <Search size={15} aria-hidden="true" />
            <UiText>{"Cari jejak"}</UiText>
          </button>
          {activeRequestId && (
            <button
              type="button"
              className="button secondary trace-all-btn"
              onClick={handleReset}
              disabled={loading}
            >
              <RotateCcw size={14} aria-hidden="true" />
              <UiText>{"Kembali ke semua jejak"}</UiText>
            </button>
          )}
        </form>
      </section>

      {/* When filtering by specific Nomor permintaan */}
      {activeRequestId ? (
        <section className="trace-detail-section">
          {/* Request Overview Banner */}
          <div className="panel trace-overview-card">
            <div className="trace-overview-top">
              <div className="trace-reqid-display">
                <span className="trace-meta-label"><UiText>{"Nomor permintaan"}</UiText></span>
                <code>{activeRequestId}</code>
                <button
                  type="button"
                  className="trace-copy-btn"
                  onClick={() => handleCopy(activeRequestId)}
                  title={t("Salin nomor permintaan")}
                >
                  {copiedId ? (
                    <>
                      <Check size={13} aria-hidden="true" />
                      <span><UiText>{"Tersalin!"}</UiText></span>
                    </>
                  ) : (
                    <>
                      <Copy size={13} aria-hidden="true" />
                      <span><UiText>{"Salin"}</UiText></span>
                    </>
                  )}
                </button>
              </div>
              <div className="trace-overview-stats">
                <div className="trace-stat-item">
                  <span className="trace-stat-label">
                    <Layers size={13} aria-hidden="true" />
                    <UiText>{"Tahapan"}</UiText>
                  </span>
                  <strong>{totalStages}</strong>
                </div>
                <div className="trace-stat-item">
                  <span className="trace-stat-label">
                    <Clock size={13} aria-hidden="true" />
                    <UiText>{"Latensi akumulasi"}</UiText>
                  </span>
                  <strong>{metric(totalLatencyMs)} <UiText>{"milidetik"}</UiText></strong>
                </div>
                <div className="trace-stat-item">
                  <span className="trace-stat-label">
                    <Zap size={13} aria-hidden="true" />
                    <UiText>{"Panggilan layanan AI"}</UiText>
                  </span>
                  <strong>{totalCalls}</strong>
                </div>
                {totalCostUsd > 0 && (
                  <div className="trace-stat-item">
                    <span className="trace-stat-label">
                      <Sparkles size={13} aria-hidden="true" />
                      <UiText>{"Estimasi biaya"}</UiText>
                    </span>
                    <strong>{cost(totalCostUsd)}</strong>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Trace Stages Timeline */}
          {totalStages > 0 ? (
            <div className="trace-stages-container">
              <div className="trace-stages-title-row">
                <h2>
                  <Layers size={18} aria-hidden="true" />
                  <UiText>{"Tahapan Inferensi LangGraph"}</UiText>
                  <span className="count">{totalStages}</span>
                </h2>
              </div>

              <div className="trace-stages-timeline">
                {data.items.map((stage: AdminLearningTraceItem, idx: number) => {
                  const isJsonOpen = Boolean(expandedJson[stage.id]);
                  return (
                    <article key={stage.id} className="panel trace-stage-card">
                      <div className="trace-stage-rail">
                        <span className="trace-step-num">{idx + 1}</span>
                        {idx < totalStages - 1 && <span className="trace-rail-line" aria-hidden="true" />}
                      </div>

                      <div className="trace-stage-main">
                        <header className="trace-stage-header">
                          <div className="trace-stage-title-wrap">
                            <span className="trace-stage-badge">{t(stage.stage)}</span>
                            {stage.node && <code className="trace-node-pill">{stage.node}</code>}
                            {stage.prompt_version && (
                              <span className="trace-version-pill">
                                v{stage.prompt_version}
                              </span>
                            )}
                          </div>
                          <div className="trace-stage-timing">
                            {stage.latency_ms != null && (
                              <span className="trace-latency-tag">
                                <Zap size={13} aria-hidden="true" />
                                {stage.latency_ms} <UiText>{"milidetik"}</UiText>
                              </span>
                            )}
                            {stage.occurred_at && (
                              <span className="trace-time-tag">
                                <Clock size={13} aria-hidden="true" />
                                <UiDate value={stage.occurred_at} time />
                              </span>
                            )}
                          </div>
                        </header>

                        {/* Diagnostics Attributes Grid */}
                        <div className="trace-stage-grid">
                          {stage.source_ids && stage.source_ids.length > 0 && (
                            <div className="trace-attr-item">
                              <span className="trace-attr-label"><UiText>{"ID sumber"}</UiText></span>
                              <div className="trace-sources-list">
                                {stage.source_ids.map((sid) => (
                                  <code key={sid} className="trace-source-code">{sid}</code>
                                ))}
                              </div>
                            </div>
                          )}

                          {(stage.candidate_count != null || stage.accepted_count != null) && (
                            <div className="trace-attr-item">
                              <span className="trace-attr-label"><UiText>{"Kandidat / diterima / hasil"}</UiText></span>
                              <strong>
                                {stage.candidate_count ?? "—"} / {stage.accepted_count ?? "—"} / {stage.returned_count ?? "—"}
                              </strong>
                            </div>
                          )}

                          {stage.quality_reasons && stage.quality_reasons.length > 0 && (
                            <div className="trace-attr-item">
                              <span className="trace-attr-label"><UiText>{"Alasan kualitas"}</UiText></span>
                              <span className="trace-quality-chip">{stage.quality_reasons.join(", ")}</span>
                            </div>
                          )}

                          {stage.fallback_reason && (
                            <div className="trace-attr-item">
                              <span className="trace-attr-label"><UiText>{"Layanan cadangan"}</UiText></span>
                              <span className="trace-fallback-chip">{stage.fallback_reason}</span>
                            </div>
                          )}

                          {stage.provider_usage && stage.provider_usage.calls > 0 && (
                            <div className="trace-attr-item">
                              <span className="trace-attr-label"><UiText>{"Panggilan layanan AI"}</UiText></span>
                              <span>
                                {stage.provider_usage.calls} <UiText>{"panggilan"}</UiText>
                                {stage.provider_usage.failures > 0 && <> ({stage.provider_usage.failures} <UiText>{"gagal"}</UiText>)</>}
                                {stage.provider_usage.estimated_cost_usd > 0
                                  ? ` · ${cost(stage.provider_usage.estimated_cost_usd)}`
                                  : ""}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Expandable Raw JSON */}
                        <div className="trace-json-wrap">
                          <button
                            type="button"
                            className="trace-json-toggle"
                            onClick={() => toggleJson(stage.id)}
                            aria-expanded={isJsonOpen}
                          >
                            <Code2 size={13} aria-hidden="true" />
                            <span>{isJsonOpen ? t("Tutup JSON") : t("Inspeksi Raw JSON")}</span>
                            {isJsonOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                          {isJsonOpen && (
                            <pre className="trace-json-pre">
                              <code>{JSON.stringify(stage, null, 2)}</code>
                            </pre>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="panel trace-direct-call-card">
              <div className="trace-direct-icon">
                <Volume2 size={32} aria-hidden="true" />
              </div>
              <div className="trace-direct-info">
                <h3><UiText>{"Panggilan langsung ke layanan AI"}</UiText></h3>
                <p>
                  <UiText>
                    {
                      "Panggilan teks menjadi suara dijalankan langsung melalui layanan AI, tanpa melewati alur inferensi LangGraph. Waktu respons, durasi audio, dan biaya tercatat pada rincian di atas."
                    }
                  </UiText>
                </p>
                <div className="trace-direct-actions">
                  <button type="button" className="button secondary" onClick={handleReset}>
                    <RotateCcw size={14} aria-hidden="true" />
                    <UiText>{"Lihat semua jejak alur belajar"}</UiText>
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      ) : (
        /* When viewing ALL learning traces across the system */
        <section className="panel table-panel trace-all-panel" aria-labelledby="all-traces-title">
          <div className="panel-heading">
            <div>
              <h2 id="all-traces-title">
                <UiText>{"Semua jejak alur belajar"}</UiText>
                <span className="count">{data.total}</span>
              </h2>
              <p>
                <UiText>
                  {"Telusuri pencarian materi, pembuatan soal, peninjauan, sesi, dan penggunaan layanan AI berdasarkan nomor permintaan."}
                </UiText>
              </p>
            </div>
          </div>

          {data.items.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead><UiText>{"Waktu"}</UiText></TableHead>
                  <TableHead><UiText>{"Tahapan"}</UiText></TableHead>
                  <TableHead><UiText>{"Node"}</UiText></TableHead>
                  <TableHead><UiText>{"Nomor permintaan"}</UiText></TableHead>
                  <TableHead><UiText>{"Kandidat / diterima / hasil"}</UiText></TableHead>
                  <TableHead><UiText>{"Latensi"}</UiText></TableHead>
                  <TableHead><UiText>{"Tindakan"}</UiText></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((it: AdminLearningTraceItem) => (
                  <TableRow key={it.id}>
                    <TableCell>
                      {it.occurred_at ? <UiDate value={it.occurred_at} time /> : "—"}
                    </TableCell>
                    <TableCell>
                      <span className="trace-stage-badge">{t(it.stage)}</span>
                    </TableCell>
                    <TableCell>
                      {it.node ? <code className="trace-node-pill">{it.node}</code> : "—"}
                    </TableCell>
                    <TableCell>
                      {it.request_id ? (
                        <div className="trace-table-reqid">
                          <code>{it.request_id.slice(0, 14)}…</code>
                          <button
                            type="button"
                            className="trace-mini-copy"
                            onClick={() => handleCopy(it.request_id!)}
                            title={t("Salin nomor permintaan")}
                          >
                            <Copy size={11} aria-hidden="true" />
                          </button>
                        </div>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {it.candidate_count != null || it.accepted_count != null
                        ? `${it.candidate_count ?? "—"} / ${it.accepted_count ?? "—"} / ${it.returned_count ?? "—"}`
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {it.latency_ms != null ? <>{it.latency_ms} <UiText>{"milidetik"}</UiText></> : "—"}
                    </TableCell>
                    <TableCell>
                      {it.request_id && (
                        <button
                          type="button"
                          className="button secondary trace-action-btn"
                          onClick={() => handleSelectRequestId(it.request_id!)}
                        >
                          <Activity size={12} aria-hidden="true" />
                          <span><UiText>{"Buka jejak"}</UiText></span>
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="trace-empty-state">
              <Sparkles size={36} aria-hidden="true" className="muted" />
              <h3><UiText>{"Belum ada jejak alur belajar"}</UiText></h3>
              <p>
                <UiText>
                  {"Jejak alur inferensi LangGraph akan muncul di sini saat aktivitas belajar, penalaran tutor, atau generasi kuis berlangsung."}
                </UiText>
              </p>
            </div>
          )}

          {data.total > 0 && (
            <nav className="admin-pagination" aria-label={t("Navigasi halaman")}>
              <button
                type="button"
                className="button secondary"
                disabled={loading || data.page <= 1}
                onClick={() => void fetchTraces(activeRequestId, data.page - 1)}
              >
                <ArrowLeft size={15} aria-hidden="true" />
                <UiText>{"Sebelumnya"}</UiText>
              </button>
              <span>
                {t("Halaman {page}", { page: data.page })} · {metric(data.total)} {t("jejak alur belajar")}
              </span>
              <button
                type="button"
                className="button secondary"
                disabled={loading || !data.has_next}
                onClick={() => void fetchTraces(activeRequestId, data.page + 1)}
              >
                <UiText>{"Berikutnya"}</UiText>
                <ArrowRight size={15} aria-hidden="true" />
              </button>
            </nav>
          )}
        </section>
      )}
    </div>
  );
}

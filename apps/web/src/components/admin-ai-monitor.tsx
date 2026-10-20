"use client";
import { LoadingStatus } from "./loading-feedback";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";


import { useState } from "react";
import {
  Bot,
  CheckCircle2,
  CircleAlert,
  Clock,
  Cpu,
  Filter,
  RefreshCw,
  Search,
  Sparkles,
  Volume2,
  Zap,
} from "lucide-react";
import { UiText, UiDate, useI18n } from "./language-provider";
import type { AdminAiUsage, AdminLearningTraces } from "@/lib/admin-insights-types";
import { notifyResult } from "@/lib/dialogs";

export function AdminAiMonitor({
  initialData,
}: {
  initialData: AdminAiUsage;
}) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<AdminAiUsage>(initialData);
  const [loading, setLoading] = useState(false);
  const [filterProvider, setFilterProvider] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [traceRequestId, setTraceRequestId] = useState("");
  const [traceData, setTraceData] = useState<AdminLearningTraces | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);

  async function handleRefresh(page = 1, provider = filterProvider, status = filterStatus) {
    setLoading(true);
    try {
      const query = new URLSearchParams({ days: "7", page: String(page), limit: "20", search: searchQuery.trim() });
      if (provider !== "all") query.set("provider", provider);
      if (status !== "all") query.set("status", status);
      const res = await fetch(`/api/admin/insights/ai-usage?${query}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Gagal memuat status penggunaan AI.");
      const updated = (await res.json()) as AdminAiUsage;
      setData(updated);
      setFilterProvider(provider); setFilterStatus(status);
    } catch (err) {
      await notifyResult(err instanceof Error ? err.message : "Gagal memperbarui data.", true);
    } finally {
      setLoading(false);
    }
  }

  async function handleTraceLookup(requestId = traceRequestId) {
    const value = requestId.trim();
    if (!value) return;
    setTraceLoading(true);
    setTraceRequestId(value);
    try {
      const query = new URLSearchParams({ request_id: value, page: "1", limit: "50" });
      const res = await fetch(`/api/admin/insights/learning-traces?${query}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Gagal memuat jejak alur belajar untuk request ID ini.");
      setTraceData((await res.json()) as AdminLearningTraces);
    } catch (err) {
      await notifyResult(err instanceof Error ? err.message : "Gagal memuat jejak alur belajar.", true);
    } finally {
      setTraceLoading(false);
    }
  }

  const { elevenlabs, openai } = data;

  // ElevenLabs Calculations
  const elUsed = elevenlabs.character_count ?? 0;
  const elLimit = elevenlabs.character_limit ?? 0;
  const elRemaining = Math.max(0, elLimit - elUsed);
  const elPct = elLimit > 0 ? Math.min(100, Math.round((elUsed / elLimit) * 100)) : 0;
  const metric = (value: number | null | undefined) => value === null || value === undefined ? t("Belum tersedia") : value.toLocaleString(locale);
  const cost = (value: number | null | undefined) => value == null ? t("Belum tersedia") : new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 6 }).format(value);

  // Filter requests
  const filteredRequests = data.recent_requests || [];
  const serviceLabels: Record<string, string> = { tutor: "Pengajaran", quiz: "Pembuatan soal", router: "Pemilihan alur", scoring: "Penilaian", recommendation: "Rekomendasi", reflection: "Review jawaban", embedding: "Pencarian materi", tts: "Pembacaan suara", stt: "Transkripsi suara" };

  return (
    <div className="admin-ai-monitor-layout">
      <LoadingStatus active={loading} label="Memuat penggunaan layanan AI…" />
      {/* Top Header Controls */}
      <div className="admin-activity-page-header">
        <div>
          <span className="analytics-kicker">
            <Cpu size={14} aria-hidden="true" />
            <UiText>{" PEMANTAUAN MESIN AI"}</UiText>
          </span>
          <h1><UiText>{"Status Kuota & Penggunaan API Eksternal"}</UiText></h1>
          <p><UiText>{"Periksa konfigurasi layanan dan kuota suara yang berhasil dimuat dari penyedia."}</UiText></p>
        </div>
        <button
          type="button"
          onClick={() => void handleRefresh(data.pagination?.page || 1)}
          disabled={loading}
          className="button secondary refresh-btn"
        >
          <RefreshCw size={16} className={loading ? "spin" : undefined} aria-hidden="true" />
          <UiText>{"Perbarui Data"}</UiText>
        </button>
      </div>

      <div className="ai-usage-summary" aria-label={t("Penggunaan 7 hari terakhir")}>
        <div className="ai-stat-card">
          <div className="ai-stat-header">
            <span>{t("Panggilan layanan")}</span>
            <span className="ai-stat-icon-wrap blue"><Zap size={16} aria-hidden="true" /></span>
          </div>
          <strong>{metric(data.summary?.provider_calls)}</strong>
          <small>{t("Total request 7 hari")}</small>
        </div>
        <div className="ai-stat-card">
          <div className="ai-stat-header">
            <span>{t("Audio dari cache")}</span>
            <span className="ai-stat-icon-wrap indigo"><Volume2 size={16} aria-hidden="true" /></span>
          </div>
          <strong>{metric(data.summary?.cache_hits)}</strong>
          <small>{t("Efisiensi kuota audio")}</small>
        </div>
        <div className="ai-stat-card">
          <div className="ai-stat-header">
            <span>{t("Permintaan gagal")}</span>
            <span className="ai-stat-icon-wrap red"><CircleAlert size={16} aria-hidden="true" /></span>
          </div>
          <strong>{metric(data.summary?.errors)}</strong>
          <small>{t("Error atau fallback")}</small>
        </div>
        <div className="ai-stat-card">
          <div className="ai-stat-header">
            <span>{t("Estimasi biaya (USD)")}</span>
            <span className="ai-stat-icon-wrap amber"><Sparkles size={16} aria-hidden="true" /></span>
          </div>
          <strong>{cost(data.summary?.estimated_cost_usd)}</strong>
          <small>{t("Berdasarkan token & audio")}</small>
        </div>
      </div>
      <p className="muted" style={{ margin: "-8px 0 8px 4px", fontSize: "0.82rem", color: "#64748b" }}>
        {t("Ringkasan 7 hari terakhir. Estimasi biaya memerlukan tarif dan angka penggunaan yang tersedia.")}
      </p>

      {/* Grid: 2 Provider Quota Cards */}
      <div className="ai-quota-grid">
        {/* Card 1: ElevenLabs */}
        <article className="panel ai-provider-card elevenlabs-card">
          <div className="ai-provider-header">
            <div className="ai-provider-title">
              <span className="ai-provider-icon indigo">
                <Volume2 size={22} aria-hidden="true" />
              </span>
              <div>
                <h3><UiText>{"ElevenLabs Speech Synthesis"}</UiText></h3>
                <small><UiText>{"Layanan Text-to-Speech untuk audio siswa tunanetra"}</UiText></small>
              </div>
            </div>
            <span className={`ai-status-tag ${elevenlabs.configured ? "ready" : "fallback"}`}>
              {elevenlabs.configured ? (
                <>
                  <CheckCircle2 size={14} aria-hidden="true" />
                  <UiText>{"Terkonfigurasi"}</UiText>
                </>
              ) : (
                <>
                  <CircleAlert size={14} aria-hidden="true" />
                  <UiText>{"Belum Ada Key"}</UiText>
                </>
              )}
            </span>
          </div>

          {/* Quota Progress */}
          <div className="ai-quota-meter">
            <div className="quota-meter-header">
              <span><UiText>{"Karakter Terpakai"}</UiText></span>
              <strong>
                {elevenlabs.available ? <>{elUsed.toLocaleString()} / {elLimit.toLocaleString()} <span className="quota-pct">({elPct}%)</span></> : <UiText>{"Kuota belum dapat dimuat"}</UiText>}
              </strong>
            </div>
            <div className="quota-progress-track">
              <div
                className={`quota-progress-fill ${elPct > 85 ? "danger" : elPct > 60 ? "warning" : "normal"}`}
                style={{ width: `${elPct}%` }}
              />
            </div>
            <div className="quota-meter-footer">
              <small>
                <UiText>{"Sisa kuota: "}</UiText>
                <strong>{elevenlabs.available ? elRemaining.toLocaleString() : t("Belum tersedia")}</strong> <UiText>{"karakter"}</UiText>
              </small>
              {elevenlabs.next_reset_unix && (
                <small>
                  <UiText>{"Reset: "}</UiText>
                  <strong><UiDate value={new Date(elevenlabs.next_reset_unix * 1000).toISOString()} /></strong>
                </small>
              )}
            </div>
          </div>

          {/* Specs List */}
          <div className="ai-specs-grid">
            <div className="spec-item">
              <span><UiText>{"Paket / Tier"}</UiText></span>
              <strong>{elevenlabs.tier?.toUpperCase() ?? t("Belum tersedia")}</strong>
            </div>
            <div className="spec-item">
              <span><UiText>{"Model Suara"}</UiText></span>
              <strong>{elevenlabs.tts_model}</strong>
            </div>
            <div className="spec-item">
              <span><UiText>{"Speech to Text"}</UiText></span>
              <strong>{elevenlabs.stt_backend}</strong>
            </div>
          </div>
        </article>

        {/* Card 2: OpenAI (GPT) */}
        <article className="panel ai-provider-card openai-card">
          <div className="ai-provider-header">
            <div className="ai-provider-title">
              <span className="ai-provider-icon emerald">
                <Sparkles size={22} aria-hidden="true" />
              </span>
              <div>
                <h3><UiText>{"OpenAI GPT Intelligence"}</UiText></h3>
                <small><UiText>{"Mesin penalaran Tutor AI, penyusunan kuis, dan embeddings"}</UiText></small>
              </div>
            </div>
            <span className={`ai-status-tag ${openai.configured ? "ready" : "fallback"}`}>
              {openai.configured ? (
                <>
                  <CheckCircle2 size={14} aria-hidden="true" />
                  <UiText>{"Terkonfigurasi"}</UiText>
                </>
              ) : (
                <>
                  <CircleAlert size={14} aria-hidden="true" />
                  <UiText>{"Belum Ada Key"}</UiText>
                </>
              )}
            </span>
          </div>

          {/* Token Usage Summary */}
          <div className="ai-token-stats">
            <div className="token-total-box">
              <span><UiText>{"Token terukur"}</UiText></span>
              <strong>{metric(openai.total_tokens)}</strong>
              <small><UiText>{"Jumlah token dari respons penyedia selama 7 hari terakhir."}</UiText></small>
            </div>
            <div className="token-breakdown-row">
              <div className="breakdown-sub">
                <small><UiText>{"Input (Prompt)"}</UiText></small>
                <strong>{metric(openai.prompt_tokens)}</strong>
              </div>
              <div className="breakdown-sub">
                <small><UiText>{"Output (Jawaban)"}</UiText></small>
                <strong>{metric(openai.completion_tokens)}</strong>
              </div>
            </div>
          </div>

          {/* Model Mapping */}
          <div className="ai-specs-grid">
            <div className="spec-item">
              <span><UiText>{"Model Tutor"}</UiText></span>
              <strong>{openai.models.tutor}</strong>
            </div>
            <div className="spec-item">
              <span><UiText>{"Model Kuis"}</UiText></span>
              <strong>{openai.models.quiz}</strong>
            </div>
            <div className="spec-item">
              <span><UiText>{"Embeddings"}</UiText></span>
              <strong>{openai.models.embedding}</strong>
            </div>
          </div>
        </article>
      </div>

      {/* Riwayat Panggilan API (Request Log Table) */}
      <section className="panel table-panel ai-logs-panel">
        <div className="panel-heading">
          <div>
            <h2><UiText>{"Riwayat Panggilan API Terakhir"}</UiText></h2>
            <p><UiText>{"Log panggilan AI untuk aktivitas siswa, narasi materi, dan sesi kuis."}</UiText></p>
          </div>
        </div>

        {/* Filter bar untuk log */}
        <div className="ai-log-filter-bar">
          <div className="ai-filter-group" role="tablist" aria-label={t("Filter provider")}>
            <button
              type="button"
              role="tab"
              className={`ai-filter-tab ${filterProvider === "all" ? "active" : ""}`}
              disabled={loading}
              aria-selected={filterProvider === "all"}
              onClick={() => void handleRefresh(1, "all")}
            >
              <UiText>{"Semua Provider"}</UiText>
            </button>
            <button
              type="button"
              role="tab"
              className={`ai-filter-tab ${filterProvider === "openai" ? "active" : ""}`}
              disabled={loading}
              aria-selected={filterProvider === "openai"}
              onClick={() => void handleRefresh(1, "openai")}
            >
              <Sparkles size={14} aria-hidden="true" />
              {"OpenAI"}
            </button>
            <button
              type="button"
              role="tab"
              className={`ai-filter-tab ${filterProvider === "elevenlabs" ? "active" : ""}`}
              disabled={loading}
              aria-selected={filterProvider === "elevenlabs"}
              onClick={() => void handleRefresh(1, "elevenlabs")}
            >
              <Volume2 size={14} aria-hidden="true" />
              {"ElevenLabs"}
            </button>
          </div>

          <div className="ai-log-controls">
            <form className="ai-search-form" onSubmit={event => { event.preventDefault(); void handleRefresh(); }}>
              <div className="ai-search-input-wrap">
                <Search size={15} className="ai-search-icon" aria-hidden="true" />
                <input
                  type="text"
                  className="ai-search-input"
                  placeholder={t("Cari nama atau layanan…")}
                  aria-label={t("Cari nama atau layanan")}
                  maxLength={120}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <button className="button secondary ai-search-btn" type="submit" disabled={loading}>
                {t("Cari")}
              </button>
            </form>

            <div className="ai-status-select-wrap">
              <span className="ai-status-select-icon" aria-hidden="true">
                <Filter size={14} />
              </span>
              <NativeSelect
                disabled={loading}
                value={filterStatus}
                aria-label={t("Status permintaan")}
                onChange={event => void handleRefresh(1, filterProvider, event.target.value)}
              >
                <option value="all">{t("Semua Status")}</option>
                <option value="success">{t("Sukses")}</option>
                <option value="error">{t("Gagal")}</option>
                <option value="cache_hit">{t("Audio dari cache")}</option>
                <option value="cancelled">{t("Dibatalkan")}</option>
              </NativeSelect>
            </div>
          </div>
        </div>

        {/* Tabel Request Log */}
        {filteredRequests.length > 0 ? (
          <div className="table-responsive">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead><UiText>{"Waktu"}</UiText></TableHead>
                  <TableHead><UiText>{"Provider & Layanan"}</UiText></TableHead>
                  <TableHead><UiText>{"Model / Voice"}</UiText></TableHead>
                  <TableHead><UiText>{"Siswa / Target"}</UiText></TableHead>
                  <TableHead><UiText>{"Volume"}</UiText></TableHead>
                  <TableHead><UiText>{"Latensi"}</UiText></TableHead>
                  <TableHead><UiText>{"Status"}</UiText></TableHead>
                  <TableHead><UiText>{"Estimasi biaya (USD)"}</UiText></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRequests.map((req) => (
                  <TableRow key={req.id}>
                    <TableCell>
                      <span className="log-time">
                        <Clock size={13} aria-hidden="true" />
                        <UiDate value={req.timestamp} time empty="Baru saja" />
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="log-service-info">
                        <span className={`provider-badge ${req.provider.toLowerCase()}`}>
                          {req.provider}
                        </span>
                        <strong>{t(serviceLabels[req.service] || req.service)}</strong>
                      </div>
                    </TableCell>
                    <TableCell>
                      <code className="model-code">{req.model}</code>
                    </TableCell>
                    <TableCell>
                      <div className="log-target-cell">
                        <strong>{t(req.actor_name)}</strong>
                        <small>{req.target}</small>
                        <small><code>{req.request_id}</code></small>
                        <button
                          type="button"
                          className="button secondary"
                          disabled={traceLoading}
                          onClick={() => void handleTraceLookup(req.request_id)}
                        >
                          {t("Lihat jejak")}
                        </button>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="log-units">{req.total_tokens != null ? `${metric(req.total_tokens)} ${t("token")}` : req.characters != null ? `${metric(req.characters)} ${t("karakter")}` : req.audio_bytes != null ? `${metric(req.audio_bytes)} ${t("byte audio")}` : t("Belum tersedia")}</span>
                    </TableCell>
                    <TableCell>
                      <span className="log-latency">
                        <Zap size={13} aria-hidden="true" />
                        {metric(req.latency_ms)} ms
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={`log-status-tag ${req.status}`}>
                        {req.status === "success" ? (
                          <UiText>{"Sukses"}</UiText>
                        ) : req.status === "cache_hit" ? (
                          <UiText>{"Audio dari cache"}</UiText>
                        ) : req.status === "cancelled" ? (
                          <UiText>{"Dibatalkan"}</UiText>
                        ) : (
                          <UiText>{"Gagal"}</UiText>
                        )}
                      </span>
                      {req.error_code && <small className="muted">{req.error_code}</small>}
                    </TableCell>
                    <TableCell>{cost(req.estimated_cost_usd)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="ai-logs-empty">
            <Bot size={28} aria-hidden="true" />
            <p><UiText>{"Riwayat penggunaan API belum tersedia."}</UiText></p>
          </div>
        )}
      </section>
      {data.pagination && <nav className="ai-log-pagination" aria-label={t("Halaman riwayat AI")}>
        <button className="button secondary" disabled={loading || data.pagination.page <= 1} onClick={() => void handleRefresh((data.pagination?.page || 1) - 1)}>{t("Sebelumnya")}</button>
        <span>{t("Halaman {page}", { page: data.pagination.page })} · {metric(data.pagination.total)} {t("permintaan")}</span>
        <button className="button secondary" disabled={loading || !data.pagination.has_next} onClick={() => void handleRefresh((data.pagination?.page || 1) + 1)}>{t("Berikutnya")}</button>
      </nav>}
      <section className="panel table-panel ai-logs-panel" aria-labelledby="learning-traces-title">
        <div className="panel-heading">
          <div>
            <h2 id="learning-traces-title"><UiText>{"Jejak alur belajar"}</UiText></h2>
            <p><UiText>{"Telusuri retrieval, generasi soal, review, sesi, dan pemakaian provider memakai request ID."}</UiText></p>
          </div>
        </div>
        <form
          className="ai-log-controls"
          onSubmit={(event) => { event.preventDefault(); void handleTraceLookup(); }}
        >
          <label className="ai-search-input-wrap">
            <span className="sr-only"><UiText>{"Request ID"}</UiText></span>
            <input
              type="text"
              className="ai-search-input"
              aria-label={t("Request ID")}
              placeholder={t("Tempel request ID")}
              maxLength={40}
              value={traceRequestId}
              onChange={(event) => setTraceRequestId(event.target.value)}
            />
          </label>
          <button className="button secondary" type="submit" disabled={traceLoading || !traceRequestId.trim()}>
            {traceLoading ? t("Memuat…") : t("Cari jejak")}
          </button>
        </form>
        {traceData && (
          traceData.items.length > 0 ? (
            <div className="table-responsive">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead><UiText>{"Waktu / tahap"}</UiText></TableHead>
                    <TableHead><UiText>{"Sumber dan versi"}</UiText></TableHead>
                    <TableHead><UiText>{"Validasi / fallback"}</UiText></TableHead>
                    <TableHead><UiText>{"Provider / latensi"}</UiText></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {traceData.items.map((trace) => (
                    <TableRow key={trace.id}>
                      <TableCell>
                        <strong>{t(trace.stage)}</strong>
                        <small className="log-target-cell">{trace.node}</small>
                        <small><UiDate value={trace.occurred_at} empty="Waktu tidak tersedia" /></small>
                      </TableCell>
                      <TableCell>
                        <small>{t("ID sumber")}: {trace.source_ids.length ? trace.source_ids.join(", ") : t("Tidak ada")}</small>
                        <small>{t("Prompt")}: {trace.prompt_version || t("Belum tersedia")}</small>
                        <small>{t("Ekstraktor")}: {trace.extractor_version || t("Belum tersedia")}</small>
                        <small>{t("Kandidat / diterima / hasil")}: {trace.candidate_count ?? "—"} / {trace.accepted_count ?? "—"} / {trace.returned_count ?? "—"}</small>
                      </TableCell>
                      <TableCell>
                        <small>{t("Alasan kualitas")}: {trace.quality_reasons.length ? trace.quality_reasons.join(", ") : t("Tidak ada")}</small>
                        <small>{t("Fallback")}: {trace.fallback_reason || t("Tidak ada")}</small>
                        <small>{t("Versi kebijakan")}: {trace.policy_version ?? "—"}</small>
                      </TableCell>
                      <TableCell>
                        <small>{t("Panggilan provider")}: {trace.provider_usage.calls} ({t("gagal")}: {trace.provider_usage.failures})</small>
                        <small>{t("Layanan")}: {trace.provider_usage.services.join(", ") || t("Belum tersedia")}</small>
                        <small>{t("Panggilan model")}: {trace.model_call_count ?? "—"}</small>
                        <small>{t("Latensi")}: {trace.latency_ms ?? "—"} ms</small>
                        <small>{t("Estimasi biaya")}: {cost(trace.provider_usage.estimated_cost_usd)}</small>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="ai-logs-empty"><p><UiText>{"Belum ada jejak untuk request ID ini."}</UiText></p></div>
          )
        )}
      </section>
    </div>
  );
}

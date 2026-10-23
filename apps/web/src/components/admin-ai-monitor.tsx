"use client";
import { LoadingStatus } from "./loading-feedback";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Dialog } from "@/components/ui/dialog";

import Link from "next/link";
import { useState, useRef, useEffect } from "react";
import {
  Activity,
  ArrowUpRight,
  Bot,
  Check,
  CheckCircle2,
  CircleAlert,
  Clock,
  CircleDollarSign,
  Copy,
  Filter,
  RefreshCw,
  Search,
  Sparkles,
  Volume2,
  X,
  Zap,
} from "lucide-react";
import { UiText, UiDate, useI18n } from "./language-provider";
import type { AdminAiUsage, AdminAiRequestLog, AdminLearningTraces } from "@/lib/admin-insights-types";
import { notifyResult } from "@/lib/dialogs";

const AI_USAGE_CACHE_KEY = "kodmod_admin_ai_usage_cache";

export function AdminAiMonitor({
  initialData,
}: {
  initialData?: AdminAiUsage | null;
}) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<AdminAiUsage | null>(() => {
    if (initialData) return initialData;
    if (typeof window !== "undefined") {
      try {
        const raw = window.sessionStorage?.getItem(AI_USAGE_CACHE_KEY) || window.localStorage?.getItem(AI_USAGE_CACHE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as AdminAiUsage;
          if (parsed && parsed.elevenlabs && parsed.openai) {
            return parsed;
          }
        }
      } catch {
        // ignore cache parse error
      }
    }
    return null;
  });
  const [loading, setLoading] = useState(() => !initialData);
  const [isRevalidating, setIsRevalidating] = useState(() => Boolean(initialData));
  const [filterProvider, setFilterProvider] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [traceRequestId, setTraceRequestId] = useState("");
  const [traceData, setTraceData] = useState<AdminLearningTraces | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<AdminAiRequestLog | null>(null);
  const [copiedId, setCopiedId] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const hasCachedData = useRef(Boolean(data));

  // Background SWR revalidation
  useEffect(() => {
    let active = true;

    const query = new URLSearchParams({ days: "7", page: "1", limit: "20" });
    fetch(`/api/admin/insights/ai-usage?${query}`)
      .then((res) => {
        if (!res.ok) throw new Error("Gagal memuat status penggunaan AI.");
        return res.json();
      })
      .then((fresh: AdminAiUsage) => {
        if (!active) return;
        setData(fresh);
        try {
          const serialized = JSON.stringify(fresh);
          window.sessionStorage?.setItem(AI_USAGE_CACHE_KEY, serialized);
          window.localStorage?.setItem(AI_USAGE_CACHE_KEY, serialized);
        } catch {
          // ignore storage error
        }
      })
      .catch((err) => {
        if (!hasCachedData.current && active) {
          notifyResult(err instanceof Error ? err.message : "Gagal memuat data.", true);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
          setIsRevalidating(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  function handleOpenTrace(req: AdminAiRequestLog) {
    setSelectedRequest(req);
    void handleTraceLookup(req.request_id);
    if (dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal();
    }
  }

  function handleCloseTrace() {
    setSelectedRequest(null);
    dialogRef.current?.close();
  }

  function handleCopyId(id: string) {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(id).then(() => {
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    }).catch(() => {});
  }

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
      try {
        const serialized = JSON.stringify(updated);
        window.sessionStorage?.setItem(AI_USAGE_CACHE_KEY, serialized);
        window.localStorage?.setItem(AI_USAGE_CACHE_KEY, serialized);
      } catch {
        // ignore
      }
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

  const elevenlabs = data?.elevenlabs;
  const openai = data?.openai;
  const actualCosts = data?.openai_costs;

  // ElevenLabs Calculations
  const elUsed = elevenlabs?.character_count ?? 0;
  const elLimit = elevenlabs?.character_limit ?? 0;
  const elRemaining = Math.max(0, elLimit - elUsed);
  const elPct = elLimit > 0 ? Math.min(100, Math.round((elUsed / elLimit) * 100)) : 0;
  const metric = (value: number | null | undefined) => value === null || value === undefined ? t("Belum tersedia") : value.toLocaleString(locale);
  const cost = (value: number | null | undefined) => value == null ? t("Belum tersedia") : new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 6 }).format(value);
  const rupiah = (value: number | null | undefined) => value == null ? t("Belum tersedia") : new Intl.NumberFormat(locale, { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
  const displayRate = (value: number | null | undefined) => value == null ? t("Belum tersedia") : value.toLocaleString(locale, { maximumFractionDigits: 2 });

  // Filter requests
  const filteredRequests = data?.recent_requests || [];
  const serviceLabels: Record<string, string> = { tutor: "Pengajaran", quiz: "Pembuatan soal", router: "Pemilihan alur", scoring: "Penilaian", recommendation: "Rekomendasi", reflection: "Review jawaban", embedding: "Pencarian materi", tts: "Pembacaan suara", stt: "Transkripsi suara" };

  return (
    <div className="admin-ai-monitor-layout">
      <LoadingStatus active={loading && !data} label="Memuat penggunaan layanan AI…" />
      {/* Top Header Controls */}
      <div className="admin-activity-page-header">
        <div className="page-heading-main">
          <div className="heading-icon-badge" aria-hidden="true">
            <Bot size={24} />
          </div>
          <div className="page-heading-text">
            <h1><UiText>{"Status Kuota & Penggunaan API Eksternal"}</UiText></h1>
            <p><UiText>{"Periksa konfigurasi layanan dan kuota suara yang berhasil dimuat dari penyedia."}</UiText></p>
          </div>
        </div>
        <div className="heading-actions">
          {isRevalidating && (
            <span className="revalidating-pill" aria-live="polite">
              <span className="revalidating-dot" aria-hidden="true" />
              <UiText>{"Memperbarui data…"}</UiText>
            </span>
          )}
          <Link href="/admin/pemantauan-ai/jejak" className="button secondary refresh-btn trace-nav-btn">
            <Activity size={15} aria-hidden="true" />
            <UiText>{"Jejak Alur Belajar"}</UiText>
          </Link>
          <button
            type="button"
            onClick={() => void handleRefresh(data?.pagination?.page || 1)}
            disabled={loading}
            className="button secondary refresh-btn"
          >
            <RefreshCw size={16} className={(loading || isRevalidating) ? "spin" : undefined} aria-hidden="true" />
            <UiText>{"Perbarui Data"}</UiText>
          </button>
        </div>
      </div>

      <div className="ai-usage-summary" aria-label={t("Penggunaan 7 hari terakhir")}>
        <div className="ai-stat-card">
          <div className="ai-stat-header">
            <span>{t("Panggilan layanan")}</span>
            <span className="ai-stat-icon-wrap blue"><Zap size={16} aria-hidden="true" /></span>
          </div>
          {data ? (
            <strong>{metric(data.summary?.provider_calls)}</strong>
          ) : (
            <div className="kodmod-skeleton" style={{ height: "1.75rem", width: "55%", margin: "4px 0" }} />
          )}
          <small>{t("Total request 7 hari")}</small>
        </div>
        <div className="ai-stat-card">
          <div className="ai-stat-header">
            <span>{t("Audio dari cache")}</span>
            <span className="ai-stat-icon-wrap indigo"><Volume2 size={16} aria-hidden="true" /></span>
          </div>
          {data ? (
            <strong>{metric(data.summary?.cache_hits)}</strong>
          ) : (
            <div className="kodmod-skeleton" style={{ height: "1.75rem", width: "55%", margin: "4px 0" }} />
          )}
          <small>{t("Efisiensi kuota audio")}</small>
        </div>
        <div className="ai-stat-card">
          <div className="ai-stat-header">
            <span>{t("Permintaan gagal")}</span>
            <span className="ai-stat-icon-wrap red"><CircleAlert size={16} aria-hidden="true" /></span>
          </div>
          {data ? (
            <strong>{metric(data.summary?.errors)}</strong>
          ) : (
            <div className="kodmod-skeleton" style={{ height: "1.75rem", width: "55%", margin: "4px 0" }} />
          )}
          <small>{t("Error atau fallback")}</small>
        </div>
        <div className="ai-stat-card">
          <div className="ai-stat-header">
            <span>{t("Estimasi biaya (USD)")}</span>
            <span className="ai-stat-icon-wrap amber"><Sparkles size={16} aria-hidden="true" /></span>
          </div>
          {data ? (
            <strong>{cost(data.summary?.estimated_cost_usd)}</strong>
          ) : (
            <div className="kodmod-skeleton" style={{ height: "1.75rem", width: "55%", margin: "4px 0" }} />
          )}
          <small>{t("Berdasarkan token & audio")}</small>
        </div>
      </div>
      <p className="muted" style={{ margin: "-8px 0 8px 4px", fontSize: "0.82rem", color: "#64748b" }}>
        {t("Ringkasan 7 hari terakhir. Estimasi biaya memerlukan tarif dan angka penggunaan yang tersedia.")}
      </p>
      <section className="panel ai-cost-actual" aria-labelledby="ai-cost-actual-title">
        <div className="ai-cost-actual-heading">
          <div>
            <span className="analytics-kicker emerald">
              <CircleDollarSign size={14} aria-hidden="true" />
              <UiText>{"BIAYA AKTUAL ORGANISASI"}</UiText>
            </span>
            <h2 id="ai-cost-actual-title"><UiText>{"Biaya aktual OpenAI"}</UiText></h2>
            <p><UiText>{"Biaya seluruh organisasi OpenAI dari Costs API untuk 30 hari terakhir."}</UiText></p>
          </div>
          <span className="ai-cost-actual-source">
            <Sparkles size={13} aria-hidden="true" />
            <UiText>{"Sumber: OpenAI Costs API"}</UiText>
          </span>
        </div>
        <div className="ai-cost-actual-values">
          <div className="ai-cost-val-box">
            <div className="ai-cost-val-header">
              <span><UiText>{"USD aktual"}</UiText></span>
              <span className="ai-cost-icon-wrap emerald"><CircleDollarSign size={16} aria-hidden="true" /></span>
            </div>
            {actualCosts ? (
              <>
                <strong>{cost(actualCosts.total_usd)}</strong>
                <small>{actualCosts.available ? t("Akumulasi biaya 30 hari") : t("Kunci admin diperlukan")}</small>
              </>
            ) : (
              <>
                <div className="kodmod-skeleton" style={{ height: "1.85rem", width: "65%", margin: "6px 0" }} />
                <div className="kodmod-skeleton" style={{ height: "0.85rem", width: "45%" }} />
              </>
            )}
          </div>
          <div className="ai-cost-val-box">
            <div className="ai-cost-val-header">
              <span><UiText>{"Konversi rupiah"}</UiText></span>
              <span className="ai-cost-icon-wrap indigo"><Zap size={16} aria-hidden="true" /></span>
            </div>
            {actualCosts ? (
              <>
                <strong>{rupiah(actualCosts.total_idr)}</strong>
                <small>{actualCosts.exchange_rate ? `1 USD ≈ ${displayRate(actualCosts.exchange_rate)} IDR` : t("Estimasi nilai rupiah")}</small>
              </>
            ) : (
              <>
                <div className="kodmod-skeleton" style={{ height: "1.85rem", width: "65%", margin: "6px 0" }} />
                <div className="kodmod-skeleton" style={{ height: "0.85rem", width: "45%" }} />
              </>
            )}
          </div>
        </div>
        <div className="ai-cost-actual-note">
          <CircleAlert size={15} aria-hidden="true" className="ai-cost-note-icon" />
          <p>
            {!actualCosts ? (
              <span className="kodmod-skeleton" style={{ display: "inline-block", width: "240px", height: "0.85rem" }} />
            ) : actualCosts.exchange_rate !== null && actualCosts.exchange_rate_date ? (
              <>
                <UiText>{"Kurs referensi"}</UiText>: 1 USD = {displayRate(actualCosts.exchange_rate)} IDR · <UiText>{"Data kurs"}</UiText> {actualCosts.exchange_rate_date}.{" "}
                <UiText>{"Konversi rupiah hanya referensi dan bukan nilai tagihan OpenAI."}</UiText>
              </>
            ) : actualCosts.error_code === "admin_key_missing" ? (
              <UiText>{"Tambahkan OPENAI_ADMIN_KEY ke environment backend untuk memuat biaya aktual."}</UiText>
            ) : actualCosts.available ? (
              <UiText>{"Biaya USD tersedia, tetapi kurs konversi rupiah belum dapat dimuat."}</UiText>
            ) : (
              <UiText>{"Biaya aktual belum dapat dimuat. Periksa Admin API key dan akses organisasi OpenAI."}</UiText>
            )}
          </p>
        </div>
      </section>

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
            {elevenlabs ? (
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
            ) : (
              <div className="kodmod-skeleton" style={{ height: "24px", width: "100px", borderRadius: "999px" }} />
            )}
          </div>

          {/* Quota Progress */}
          <div className="ai-quota-meter">
            <div className="quota-meter-header">
              <span className="quota-meter-label">
                <span className="quota-dot-indicator" aria-hidden="true" />
                <UiText>{"Karakter Terpakai"}</UiText>
              </span>
              <strong>
                {elevenlabs ? (
                  elevenlabs.available ? (
                    <>
                      {elUsed.toLocaleString(locale)} / {elLimit.toLocaleString(locale)}{" "}
                      <span className="quota-pct">({elPct}%)</span>
                    </>
                  ) : (
                    <UiText>{"Kuota belum dapat dimuat"}</UiText>
                  )
                ) : (
                  <div className="kodmod-skeleton" style={{ height: "1rem", width: "120px", display: "inline-block" }} />
                )}
              </strong>
            </div>
            <div className="quota-progress-track">
              <div
                className={`quota-progress-fill ${elPct > 85 ? "danger" : elPct > 60 ? "warning" : "normal"}`}
                style={{ width: `${elPct}%` }}
              >
                <div className="quota-liquid-wave" aria-hidden="true" />
              </div>
            </div>
            <div className="quota-meter-footer">
              <span className="quota-remaining-badge">
                <UiText>{"Sisa kuota: "}</UiText>
                <strong>{elevenlabs?.available ? elRemaining.toLocaleString(locale) : t("Belum tersedia")}</strong>{" "}
                <UiText>{"karakter"}</UiText>
              </span>
              {elevenlabs?.next_reset_unix && (
                <span className="quota-reset-badge">
                  <Clock size={12} aria-hidden="true" />
                  <UiText>{"Reset: "}</UiText>
                  <strong><UiDate value={new Date(elevenlabs.next_reset_unix * 1000).toISOString()} /></strong>
                </span>
              )}
            </div>
          </div>

          {/* Specs List */}
          <div className="ai-specs-grid">
            <div className="spec-item">
              <span className="spec-label"><UiText>{"Paket / Tier"}</UiText></span>
              <strong className="spec-value tier-badge">
                {elevenlabs ? (elevenlabs.tier?.toUpperCase() ?? t("Belum tersedia")) : <span className="kodmod-skeleton" style={{ display: "inline-block", width: "60px", height: "1rem" }} />}
              </strong>
            </div>
            <div className="spec-item">
              <span className="spec-label"><UiText>{"Model Suara"}</UiText></span>
              <strong className="spec-value">
                {elevenlabs ? elevenlabs.tts_model : <span className="kodmod-skeleton" style={{ display: "inline-block", width: "80px", height: "1rem" }} />}
              </strong>
            </div>
            <div className="spec-item">
              <span className="spec-label"><UiText>{"Speech to Text"}</UiText></span>
              <strong className="spec-value">
                {elevenlabs ? elevenlabs.stt_backend : <span className="kodmod-skeleton" style={{ display: "inline-block", width: "70px", height: "1rem" }} />}
              </strong>
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
            {openai ? (
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
            ) : (
              <div className="kodmod-skeleton" style={{ height: "24px", width: "100px", borderRadius: "999px" }} />
            )}
          </div>

          {/* Token Usage Summary with Ratio Bar */}
          <div className="ai-token-stats">
            <div className="token-total-box">
              <div className="token-total-top">
                <span><UiText>{"Token terukur"}</UiText></span>
                <span className="token-period-chip">
                  <Clock size={11} aria-hidden="true" />
                  <UiText>{"7 hari terakhir"}</UiText>
                </span>
              </div>
              <div className="token-total-val">
                {openai ? (
                  <strong>{metric(openai.total_tokens)}</strong>
                ) : (
                  <div className="kodmod-skeleton" style={{ height: "1.75rem", width: "50%", margin: "6px 0" }} />
                )}
                {actualCosts?.available && actualCosts.total_usd != null && (
                  <span className="token-cost-badge" title={t("Biaya aktual seluruh organisasi dari OpenAI Costs API")}>
                    <CircleDollarSign size={12} aria-hidden="true" />
                    {cost(actualCosts.total_usd)}
                  </span>
                )}
              </div>
              <small><UiText>{"Jumlah token dari respons penyedia selama 7 hari terakhir."}</UiText></small>
            </div>

            {/* Visual Token Ratio Bar */}
            <div className="token-ratio-visual" aria-hidden="true">
              <div className="token-ratio-track">
                <div
                  className="token-segment prompt"
                  style={{ width: `${openai && openai.total_tokens ? Math.max(8, Math.round(((openai.prompt_tokens || 0) / openai.total_tokens) * 100)) : 50}%` }}
                  title={`Prompt: ${openai?.prompt_tokens?.toLocaleString(locale) ?? 0}`}
                />
                <div
                  className="token-segment completion"
                  style={{ width: `${openai && openai.total_tokens ? Math.max(8, Math.round(((openai.completion_tokens || 0) / openai.total_tokens) * 100)) : 50}%` }}
                  title={`Completion: ${openai?.completion_tokens?.toLocaleString(locale) ?? 0}`}
                />
              </div>
            </div>

            <div className="token-breakdown-row">
              <div className="breakdown-sub prompt-sub">
                <div className="breakdown-label">
                  <span className="breakdown-dot prompt-dot" aria-hidden="true" />
                  <small><UiText>{"Input (Prompt)"}</UiText></small>
                </div>
                <strong>{openai ? metric(openai.prompt_tokens) : <span className="kodmod-skeleton" style={{ display: "inline-block", width: "50px", height: "1rem" }} />}</strong>
                {openai && openai.total_tokens ? (
                  <span className="breakdown-pct">
                    {Math.round(((openai.prompt_tokens || 0) / openai.total_tokens) * 100)}%
                  </span>
                ) : null}
              </div>
              <div className="breakdown-sub completion-sub">
                <div className="breakdown-label">
                  <span className="breakdown-dot completion-dot" aria-hidden="true" />
                  <small><UiText>{"Output (Jawaban)"}</UiText></small>
                </div>
                <strong>{openai ? metric(openai.completion_tokens) : <span className="kodmod-skeleton" style={{ display: "inline-block", width: "50px", height: "1rem" }} />}</strong>
                {openai && openai.total_tokens ? (
                  <span className="breakdown-pct">
                    {Math.round(((openai.completion_tokens || 0) / openai.total_tokens) * 100)}%
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {/* Model Mapping */}
          <div className="ai-specs-grid">
            <div className="spec-item">
              <span className="spec-label"><UiText>{"Model Tutor"}</UiText></span>
              <strong className="spec-value">{openai ? openai.models.tutor : <span className="kodmod-skeleton" style={{ display: "inline-block", width: "70px", height: "1rem" }} />}</strong>
            </div>
            <div className="spec-item">
              <span className="spec-label"><UiText>{"Model Kuis"}</UiText></span>
              <strong className="spec-value">{openai ? openai.models.quiz : <span className="kodmod-skeleton" style={{ display: "inline-block", width: "70px", height: "1rem" }} />}</strong>
            </div>
            <div className="spec-item">
              <span className="spec-label"><UiText>{"Embeddings"}</UiText></span>
              <strong className="spec-value">{openai ? openai.models.embedding : <span className="kodmod-skeleton" style={{ display: "inline-block", width: "70px", height: "1rem" }} />}</strong>
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
        {!data ? (
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
                  <TableHead className="text-right"><UiText>{"Diagnostik / Jejak"}</UiText></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...Array(6)].map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><div className="kodmod-skeleton" style={{ height: "1.1rem", width: "85px" }} /></TableCell>
                    <TableCell><div className="kodmod-skeleton" style={{ height: "1.1rem", width: "130px" }} /></TableCell>
                    <TableCell><div className="kodmod-skeleton" style={{ height: "1.1rem", width: "100px" }} /></TableCell>
                    <TableCell><div className="kodmod-skeleton" style={{ height: "1.1rem", width: "110px" }} /></TableCell>
                    <TableCell><div className="kodmod-skeleton" style={{ height: "1.1rem", width: "70px" }} /></TableCell>
                    <TableCell><div className="kodmod-skeleton" style={{ height: "1.1rem", width: "55px" }} /></TableCell>
                    <TableCell><div className="kodmod-skeleton" style={{ height: "1.1rem", width: "65px" }} /></TableCell>
                    <TableCell><div className="kodmod-skeleton" style={{ height: "1.1rem", width: "60px" }} /></TableCell>
                    <TableCell className="text-right"><div className="kodmod-skeleton" style={{ height: "1.1rem", width: "90px", marginLeft: "auto" }} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : filteredRequests.length > 0 ? (
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
                  <TableHead className="text-right"><UiText>{"Diagnostik / Jejak"}</UiText></TableHead>
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
                        <strong className="log-actor-name">{t(req.actor_name)}</strong>
                        {req.target && <span className="log-target-id">{req.target}</span>}
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
                    <TableCell className="text-right">
                      <div className="log-trace-actions">
                        <button
                          type="button"
                          className="trace-action-btn"
                          disabled={traceLoading && selectedRequest?.id === req.id}
                          onClick={() => handleOpenTrace(req)}
                          title={t("Lihat jejak")}
                        >
                          <Activity size={12} aria-hidden="true" />
                          <span>{t("Lihat jejak")}</span>
                        </button>
                        <Link
                          href={`/admin/pemantauan-ai/jejak?request_id=${encodeURIComponent(req.request_id)}`}
                          className="trace-action-btn secondary"
                          title={t("Buka halaman jejak lengkap")}
                          aria-label={t("Buka halaman jejak lengkap")}
                        >
                          <ArrowUpRight size={12} aria-hidden="true" />
                        </Link>
                      </div>
                    </TableCell>
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
      {data?.pagination && <nav className="ai-log-pagination" aria-label={t("Halaman riwayat AI")}>
        <button className="button secondary" disabled={loading || data.pagination.page <= 1} onClick={() => void handleRefresh((data.pagination?.page || 1) - 1)}>{t("Sebelumnya")}</button>
        <span>{t("Halaman {page}", { page: data.pagination.page })} · {metric(data.pagination.total)} {t("permintaan")}</span>
        <button className="button secondary" disabled={loading || !data.pagination.has_next} onClick={() => void handleRefresh((data.pagination?.page || 1) + 1)}>{t("Berikutnya")}</button>
      </nav>}


      {/* Detail & Jejak Permintaan Modal */}
      <Dialog
        ref={dialogRef}
        className="ai-trace-dialog"
        aria-labelledby="ai-trace-dialog-title"
        onClose={handleCloseTrace}
        onClick={(e) => {
          if (e.target === dialogRef.current) handleCloseTrace();
        }}
      >
        {selectedRequest && (
          <div className="ai-trace-content">
            <div className="ai-trace-header">
              <div className="ai-trace-header-titles">
                <span className="analytics-kicker">
                  <Activity size={13} aria-hidden="true" />
                  <UiText>{"Detail & Jejak Permintaan AI"}</UiText>
                </span>
                <h2 id="ai-trace-dialog-title">
                  {selectedRequest.provider.toUpperCase()} · {t(serviceLabels[selectedRequest.service] || selectedRequest.service)}
                </h2>
              </div>
              <button
                type="button"
                className="ai-trace-close-btn"
                onClick={handleCloseTrace}
                aria-label={t("Tutup")}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            {/* Badges bar */}
            <div className="ai-trace-badges-bar">
              <span className={`provider-badge ${selectedRequest.provider.toLowerCase()}`}>
                {selectedRequest.provider}
              </span>
              <span className={`log-status-tag ${selectedRequest.status}`}>
                {selectedRequest.status === "success" ? (
                  <UiText>{"Sukses"}</UiText>
                ) : selectedRequest.status === "cache_hit" ? (
                  <UiText>{"Audio dari cache"}</UiText>
                ) : selectedRequest.status === "cancelled" ? (
                  <UiText>{"Dibatalkan"}</UiText>
                ) : (
                  <UiText>{"Gagal"}</UiText>
                )}
              </span>
              <span className="log-latency">
                <Zap size={13} aria-hidden="true" />
                {metric(selectedRequest.latency_ms)} ms
              </span>
              <span className="log-time">
                <Clock size={13} aria-hidden="true" />
                <UiDate value={selectedRequest.timestamp} time empty="Baru saja" />
              </span>
            </div>

            {/* Execution Details Grid */}
            <div className="ai-trace-grid">
              <div className="ai-trace-item">
                <span className="ai-trace-item-label">{t("Siswa / Target")}</span>
                <strong>{t(selectedRequest.actor_name)}</strong>
                {selectedRequest.target && <small className="muted">{selectedRequest.target}</small>}
              </div>

              <div className="ai-trace-item">
                <span className="ai-trace-item-label">{t("Model / Voice")}</span>
                <code className="model-code">{selectedRequest.model}</code>
              </div>

              <div className="ai-trace-item">
                <span className="ai-trace-item-label">{t("Volume")}</span>
                <strong>
                  {selectedRequest.total_tokens != null
                    ? `${metric(selectedRequest.total_tokens)} ${t("token")}`
                    : selectedRequest.characters != null
                    ? `${metric(selectedRequest.characters)} ${t("karakter")}`
                    : selectedRequest.audio_bytes != null
                    ? `${metric(selectedRequest.audio_bytes)} ${t("byte audio")}`
                    : t("Belum tersedia")}
                </strong>
                {selectedRequest.input_tokens != null && selectedRequest.output_tokens != null && (
                  <small className="muted">
                    {metric(selectedRequest.input_tokens)} in / {metric(selectedRequest.output_tokens)} out
                  </small>
                )}
              </div>

              <div className="ai-trace-item">
                <span className="ai-trace-item-label">{t("Estimasi biaya")}</span>
                <strong>{cost(selectedRequest.estimated_cost_usd)}</strong>
                {actualCosts?.exchange_rate && selectedRequest.estimated_cost_usd != null && (
                  <small className="muted">
                    ≈ {rupiah(selectedRequest.estimated_cost_usd * actualCosts.exchange_rate)}
                  </small>
                )}
              </div>
            </div>

            {/* Request ID bar with Copy button */}
            <div className="ai-trace-reqid-box">
              <div className="ai-trace-reqid-text">
                <span className="ai-trace-reqid-label"><UiText>{"Request ID"}</UiText></span>
                <code>{selectedRequest.request_id}</code>
              </div>
              <button
                type="button"
                className="ai-trace-copy-btn"
                onClick={() => handleCopyId(selectedRequest.request_id)}
              >
                {copiedId ? (
                  <>
                    <Check size={14} aria-hidden="true" />
                    <span><UiText>{"Tersalin!"}</UiText></span>
                  </>
                ) : (
                  <>
                    <Copy size={14} aria-hidden="true" />
                    <span><UiText>{"Salin"}</UiText></span>
                  </>
                )}
              </button>
            </div>

            {selectedRequest.error_code && (
              <div className="alert error-message ai-trace-error">
                <CircleAlert size={16} aria-hidden="true" />
                <span><UiText>{"Kode error:"}</UiText>{" "}<strong>{selectedRequest.error_code}</strong></span>
              </div>
            )}

            {/* Learning Flow Diagnostic Trace section */}
            <div className="ai-trace-stages-section">
              <div className="ai-trace-stages-header">
                <h3><UiText>{"Tahapan Alur Belajar (Diagnostics)"}</UiText></h3>
                {traceLoading && <span className="ai-trace-loading-pill"><RefreshCw size={12} className="spin" /> <UiText>{"Memuat tahapan jejak alur belajar…"}</UiText></span>}
              </div>

              {traceLoading ? (
                <div className="ai-trace-loading-state">
                  <div className="ai-trace-skeleton-box" />
                  <div className="ai-trace-skeleton-box" />
                </div>
              ) : traceData && traceData.items.length > 0 ? (
                <div className="ai-trace-stages-list">
                  {traceData.items.map((trace) => (
                    <div key={trace.id} className="ai-trace-stage-card">
                      <div className="ai-trace-stage-top">
                        <span className="ai-trace-stage-badge">{t(trace.stage)}</span>
                        <code className="ai-trace-node-code">{trace.node}</code>
                        {trace.occurred_at && (
                          <span className="ai-trace-stage-time">
                            <Clock size={12} aria-hidden="true" />
                            <UiDate value={trace.occurred_at} time empty="Waktu tidak tersedia" />
                          </span>
                        )}
                      </div>
                      <div className="ai-trace-stage-details">
                        {trace.source_ids.length > 0 && (
                          <div>
                            <span className="muted">{t("ID sumber")}: </span>
                            <strong>{trace.source_ids.join(", ")}</strong>
                          </div>
                        )}
                        {trace.prompt_version && (
                          <div>
                            <span className="muted">{t("Prompt")}: </span>
                            <code>{trace.prompt_version}</code>
                          </div>
                        )}
                        {trace.candidate_count != null && (
                          <div>
                            <span className="muted">{t("Kandidat / diterima / hasil")}: </span>
                            <span>{trace.candidate_count} / {trace.accepted_count ?? "—"} / {trace.returned_count ?? "—"}</span>
                          </div>
                        )}
                        {trace.quality_reasons.length > 0 && (
                          <div>
                            <span className="muted">{t("Alasan kualitas")}: </span>
                            <span className="ai-trace-reasons">{trace.quality_reasons.join(", ")}</span>
                          </div>
                        )}
                        {trace.fallback_reason && (
                          <div>
                            <span className="muted">{t("Fallback")}: </span>
                            <span className="ai-trace-fallback">{trace.fallback_reason}</span>
                          </div>
                        )}
                        {trace.latency_ms != null && (
                          <div>
                            <span className="muted">{t("Latensi")}: </span>
                            <span>{trace.latency_ms} ms</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="ai-trace-direct-call-card">
                  <div className="ai-trace-direct-icon">
                    {selectedRequest.provider.toLowerCase() === "elevenlabs" ? (
                      <Volume2 size={24} aria-hidden="true" />
                    ) : (
                      <Sparkles size={24} aria-hidden="true" />
                    )}
                  </div>
                  <div>
                    <h4><UiText>{"Panggilan Langsung ke Provider"}</UiText></h4>
                    <p>
                      <UiText>
                        {"Panggilan pembacaan suara (Text-to-Speech) dijalankan langsung ke API penyedia tanpa melalui tahapan orkestrasi inferensi multi-langkah LangGraph. Metrik latensi, volume suara, dan biaya telah tercatat lengkap pada rincian di atas."}
                      </UiText>
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="ai-trace-footer">
              <Link
                href={`/admin/pemantauan-ai/jejak?request_id=${encodeURIComponent(selectedRequest.request_id)}`}
                className="button secondary"
              >
                <ArrowUpRight size={14} aria-hidden="true" />
                <UiText>{"Buka halaman jejak lengkap"}</UiText>
              </Link>
              <button
                type="button"
                className="button primary"
                onClick={handleCloseTrace}
              >
                <UiText>{"Tutup"}</UiText>
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

"use client";

import { useI18n } from "./language-provider";
import { Skeleton } from "./ui/skeleton";
import { Spinner } from "./ui/spinner";

// Keep the live region mounted so changes are announced once, without moving focus.
export function LoadingStatus({ active = true, label = "Memuat…", description, compact = false }: {
  active?: boolean; label?: string; description?: string; compact?: boolean;
}) {
  const { t } = useI18n();
  return <div className={`loading-feedback${compact ? " loading-feedback-compact" : ""}`}
    role="status" aria-live="polite" aria-atomic="true" data-active={active}>
    {active && <><Spinner /><div><strong>{t(label)}</strong>{description && <p>{t(description)}</p>}</div></>}
  </div>;
}

export function PageLoading({ label = "Memuat halaman…", layout = "dashboard" }: {
  label?: string; layout?: "dashboard" | "list" | "form" | "tutor";
}) {
  return <div className={`page-loading page-loading-${layout}`}>
    <LoadingStatus label={label} />
    <div className="page-loading-heading" aria-hidden="true"><Skeleton /><Skeleton /></div>
    {layout === "dashboard" && <div className="page-loading-stats" aria-hidden="true">
      {Array.from({ length: 4 }, (_, i) => <div key={i}><Skeleton /><Skeleton /></div>)}
    </div>}
    <div className="page-loading-body" aria-hidden="true">
      <div className="page-loading-panel">
        <Skeleton className="page-loading-line-title" />
        {Array.from({ length: layout === "form" ? 4 : 5 }, (_, i) => <Skeleton key={i} className={layout === "form" ? "page-loading-field" : "page-loading-line"} />)}
      </div>
    </div>
  </div>;
}

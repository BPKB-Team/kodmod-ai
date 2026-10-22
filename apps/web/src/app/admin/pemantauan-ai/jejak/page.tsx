import { requireSession } from "@/lib/session";
import { backend } from "@/lib/server-api";
import type { AdminLearningTraces } from "@/lib/admin-insights-types";
import { AdminLearningTraceExplorer } from "@/components/admin-learning-trace-explorer";

export default async function AdminLearningTracePage({
  searchParams,
}: {
  searchParams: Promise<{ request_id?: string; page?: string }>;
}) {
  const { token } = await requireSession("admin");
  const params = await searchParams;
  const requestId = typeof params.request_id === "string" ? params.request_id.trim() : "";
  const page = typeof params.page === "string" ? params.page : "1";

  const query = new URLSearchParams();
  if (requestId) query.set("request_id", requestId);
  query.set("page", page);
  query.set("limit", "15");

  let data: AdminLearningTraces;
  try {
    data = await backend<AdminLearningTraces>(`/admin/insights/learning-traces?${query}`, token);
  } catch {
    data = {
      items: [],
      request_id: requestId || null,
      page: 1,
      limit: 15,
      total: 0,
      has_next: false,
      generated_at: new Date().toISOString(),
    };
  }

  return <AdminLearningTraceExplorer initialData={data} initialRequestId={requestId} />;
}

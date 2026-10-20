import { forwardAdmin } from "@/lib/admin-proxy";
import type { AdminLearningTraces } from "@/lib/admin-insights-types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const incoming = new URL(request.url).searchParams;
  const query = new URLSearchParams();
  for (const name of ["request_id", "page", "limit"]) {
    const value = incoming.get(name);
    if (value !== null) query.set(name, value.slice(0, 40));
  }
  return forwardAdmin<AdminLearningTraces>(`/admin/insights/learning-traces?${query}`);
}

import { requireSession } from "@/lib/session";
import { AdminAiMonitor } from "@/components/admin-ai-monitor";

export default async function AdminAiMonitorPage() {
  await requireSession("admin");

  return <AdminAiMonitor />;
}

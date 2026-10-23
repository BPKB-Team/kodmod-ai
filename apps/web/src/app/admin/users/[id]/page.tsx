import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { backend } from "@/lib/server-api";
import type { User } from "@/lib/types";
import { AdminUserDetail } from "@/components/admin-user-detail";

export default async function UserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { token, user: admin } = await requireSession("admin");
  const { id } = await params;
  const users = await backend<User[]>("/admin/users", token);
  const user = users.find((u) => u.id === id);
  if (!user) notFound();

  return <AdminUserDetail user={user} self={user.id === admin.id} />;
}

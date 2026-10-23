
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";

import { UiText, UiDate } from "@/components/language-provider";
import Link from "next/link";
import {
  ArrowUpRight,
  Users,
  UserCheck,
  Plus,
  BookOpen,
  LayoutDashboard,
  GraduationCap,
} from "lucide-react";
import { requireSession } from "@/lib/session";
import { backend } from "@/lib/server-api";
import {
  roleLabel,
  type User,
} from "@/lib/types";
import { Badge, Heading, Empty } from "@/components/ui";
import { AdminInsights } from "@/components/admin-insights";
import { AdminOverviewCharts } from "@/components/admin-overview-charts";
import type { AdminActivity, AdminOverview } from "@/lib/admin-insights-types";
export default async function AdminPage() {
  const { token, user } = await requireSession("admin");
  const [users, overview, activity] = await Promise.all([
    backend<User[]>("/admin/users", token),
    backend<AdminOverview>("/admin/insights/overview", token),
    backend<AdminActivity>("/admin/activity?limit=8", token),
  ]);
  const active = users.filter((u) => u.is_active).length;
  return (
    <>
      <Heading
        icon={<LayoutDashboard size={24} aria-hidden="true" />}
        title={`Selamat datang, ${user.full_name.split(" ")[0]}.`}
        description={<UiText>{"Kelola akses, siapkan ruang belajar, dan dampingi sekolah Anda."}</UiText>}
      >
        <Link className="button primary" href="/admin/users/new">
          <Plus size={18} aria-hidden="true" />
          <UiText>{"Tambah pengguna"}</UiText>
        </Link>
      </Heading>
      <section className="dashboard-welcome">
        <div>
          <span className="welcome-label">
            <BookOpen size={16} aria-hidden="true" /><UiText>{"Mulai dari akses yang tepat"}</UiText></span>
          <h2><UiText>{"Ruang belajar yang baik,"}</UiText><br /><UiText>{"dimulai bersama Anda."}</UiText></h2>
          <p><UiText>{"Pastikan guru dan siswa memiliki akses untuk melangkah ke perjalanan belajar berikutnya."}</UiText></p>
          <Link href="/admin/users" className="button white"><UiText>{"Kelola pengguna"}</UiText><ArrowUpRight size={18} aria-hidden="true" />
          </Link>
        </div>
        <div className="welcome-art" aria-hidden="true">
          <BookOpen strokeWidth={0.8} />
        </div>
      </section>
      <div className="metrics admin-metrics-grid">
        {[
          {
            label: "Total pengguna",
            value: users.length,
            detail: "Akun terdaftar",
            Icon: Users,
            colorScheme: "blue",
          },
          {
            label: "Pengguna aktif",
            value: active,
            detail: `${users.length - active} akun nonaktif`,
            Icon: UserCheck,
            colorScheme: "green",
          },
          {
            label: "Guru terdaftar",
            value: users.filter((u) => u.role === "teacher").length,
            detail: "Akun pengajar",
            Icon: BookOpen,
            colorScheme: "purple",
          },
          {
            label: "Siswa terdaftar",
            value: users.filter((u) => u.role === "student").length,
            detail: "Akun pembelajar",
            Icon: GraduationCap,
            colorScheme: "amber",
          },
        ].map(({ label, value, detail, Icon, colorScheme }) => (
          <section className={`metric metric-${colorScheme}`} key={label}>
            <div>
              <span><UiText>{label}</UiText></span>
              <span className={`metric-icon-wrap ${colorScheme}`} aria-hidden="true">
                <Icon size={18} />
              </span>
            </div>
            <strong>{value}</strong>
            <small>{detail}</small>
          </section>
        ))}
      </div>
      <AdminOverviewCharts overview={overview} />
      <section className="panel table-panel admin-recent-users-panel">
        <div className="panel-heading">
          <div>
            <h2><UiText>{"Pengguna terbaru"}</UiText></h2>
            <p><UiText>{"Akun yang baru bergabung di KODMOD."}</UiText></p>
          </div>
          <Link href="/admin/users" className="text-link"><UiText>{"Lihat semua"}</UiText><ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </div>
        {users.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead><UiText>{"Pengguna"}</UiText></TableHead>
                <TableHead><UiText>{"Peran"}</UiText></TableHead>
                <TableHead><UiText>{"Bergabung"}</UiText></TableHead>
                <TableHead><UiText>{"Status"}</UiText></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.slice(0, 5).map((u) => (
                <TableRow key={u.id} className="admin-user-row">
                  <TableCell>
                    <Link
                      className="user-link"
                      href={`/admin/users/${u.id}`}
                    >
                      <span className={`avatar avatar-${u.role}`} aria-hidden="true">
                        {u.full_name.slice(0, 1)}
                      </span>
                      <span>
                        <strong>{u.full_name}</strong>
                        <small>@{u.username}</small>
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell data-label="Peran">
                    <span className={`role-badge-pill role-${u.role}`}>
                      <UiText>{roleLabel[u.role]}</UiText>
                    </span>
                  </TableCell>
                  <TableCell data-label="Bergabung">{<UiDate value={u.created_at} />}</TableCell>
                  <TableCell>
                    <Badge active={u.is_active}>
                      {u.is_active ? <UiText>{"Aktif"}</UiText> : <UiText>{"Nonaktif"}</UiText>}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Empty title={<UiText>{"Belum ada pengguna"}</UiText>}><UiText>{"Tambahkan akun untuk mulai menyiapkan akses sekolah."}</UiText></Empty>
        )}
      </section>
      <AdminInsights initialOverview={overview} initialActivity={activity} />
    </>
  );
}

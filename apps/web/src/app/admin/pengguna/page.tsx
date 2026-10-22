import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { UiText } from "@/components/language-provider";
import Link from "next/link";
import { Plus, Search, ArrowUpRight, ArrowLeft, ArrowRight, RotateCcw, Users } from "lucide-react";
import { backend } from "@/lib/server-api";
import { requireSession } from "@/lib/session";
import { roleLabel, type User } from "@/lib/types";
import { Heading, Badge, Empty } from "@/components/ui";

function getInitials(name: string) {
  const cleaned = name.replace(/^\[[^\]]+\]\s*/, "").trim();
  return (cleaned.slice(0, 1) || name.slice(0, 1) || "?").toUpperCase();
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await requireSession("admin");
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.slice(0, 100) : "";
  const role =
    typeof params.role === "string" &&
    ["student", "teacher", "admin"].includes(params.role)
      ? params.role
      : "";
  const status =
    typeof params.status === "string" &&
    ["active", "inactive"].includes(params.status)
      ? params.status
      : "";

  const rawPage = Number(params.page ?? 1);
  const page = Number.isSafeInteger(rawPage) && rawPage >= 1 ? Math.min(rawPage, 10000) : 1;
  const pageSize = 10;

  const query = new URLSearchParams();
  if (q) query.set("q", q);
  if (role) query.set("role", role);

  let users = await backend<User[]>(`/admin/users?${query}`, token);

  // Client-side status filter
  if (status === "active") {
    users = users.filter((u) => u.is_active);
  } else if (status === "inactive") {
    users = users.filter((u) => !u.is_active);
  }

  const totalUsers = users.length;
  const totalPages = Math.max(1, Math.ceil(totalUsers / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedUsers = users.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const buildPageHref = (p: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (role) sp.set("role", role);
    if (status) sp.set("status", status);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return `/admin/pengguna${qs ? `?${qs}` : ""}`;
  };

  const hasActiveFilters = Boolean(q || role || status);

  return (
    <>
      <Heading
        kicker={
          <span className="analytics-kicker">
            <Users size={14} aria-hidden="true" />
            <UiText>{"MANAJEMEN PENGGUNA"}</UiText>
          </span>
        }
        title={<UiText>{"Pengguna"}</UiText>}
        description={<UiText>{"Orang-orang di balik setiap perjalanan belajar."}</UiText>}
      >
        <Link className="button primary" href="/admin/pengguna/baru">
          <Plus size={18} aria-hidden="true" />
          <UiText>{"Tambah pengguna"}</UiText>
        </Link>
      </Heading>
      {params.success === "saved" && (
        <p className="alert success-message" role="status">
          <UiText>{"Data pengguna berhasil disimpan."}</UiText>
        </p>
      )}
      {params.success === "deleted" && (
        <p className="alert success-message" role="status">
          <UiText>{"Akun pengguna berhasil dihapus."}</UiText>
        </p>
      )}
      <form className="filters" action="/admin/pengguna">
        <div className="field search-field">
          <label htmlFor="q" className="sr-only"><UiText>{"Cari pengguna"}</UiText></label>
          <div className="search-input-wrapper">
            <Search size={18} className="search-input-icon" aria-hidden="true" />
            <Input
              name="q"
              id="q"
              defaultValue={q}
              placeholder="Cari berdasarkan nama atau username…"
              maxLength={100}
              className="search-input-field"
            />
          </div>
        </div>
        <div className="field filter-select-field">
          <label htmlFor="role" className="filter-label"><UiText>{"Peran:"}</UiText></label>
          <NativeSelect id="role" name="role" defaultValue={role}>
            <option value=""><UiText>{"Semua peran"}</UiText></option>
            {Object.entries(roleLabel).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="field filter-select-field">
          <label htmlFor="status" className="filter-label"><UiText>{"Status:"}</UiText></label>
          <NativeSelect id="status" name="status" defaultValue={status}>
            <option value=""><UiText>{"Semua status"}</UiText></option>
            <option value="active"><UiText>{"Aktif"}</UiText></option>
            <option value="inactive"><UiText>{"Nonaktif"}</UiText></option>
          </NativeSelect>
        </div>
        <button className="button primary search-submit-btn" type="submit">
          <Search size={15} aria-hidden="true" />
          <UiText>{"Cari"}</UiText>
        </button>
        {hasActiveFilters && (
          <Link href="/admin/pengguna" className="filter-reset-btn">
            <RotateCcw size={14} aria-hidden="true" />
            <UiText>{"Reset filter"}</UiText>
          </Link>
        )}
      </form>
      <section className="panel table-panel">
        <div className="panel-heading">
          <h2>
            <UiText>{"Daftar pengguna"}</UiText>
            <span className="count">{totalUsers}</span>
          </h2>
        </div>
        {pagedUsers.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead><UiText>{"Nama pengguna"}</UiText></TableHead>
                <TableHead><UiText>{"Peran"}</UiText></TableHead>
                <TableHead><UiText>{"Status"}</UiText></TableHead>
                <TableHead><UiText>{"Aksi"}</UiText></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedUsers.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="user-link">
                      <span className="avatar" aria-hidden="true">
                        {getInitials(u.full_name)}
                      </span>
                      <span>
                        <strong>{u.full_name}</strong>
                        <small>@{u.username}</small>
                      </span>
                    </div>
                  </TableCell>
                  <TableCell data-label="Peran">
                    <UiText>{roleLabel[u.role]}</UiText>
                  </TableCell>
                  <TableCell>
                    <Badge active={u.is_active}>
                      {u.is_active ? <UiText>{"Aktif"}</UiText> : <UiText>{"Nonaktif"}</UiText>}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Link
                      className="text-link"
                      href={`/admin/pengguna/${u.id}`}
                      aria-label={`Kelola ${u.full_name}`}
                    >
                      <UiText>{"Kelola"}</UiText>
                      <ArrowUpRight size={16} aria-hidden="true" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Empty
            title={
              hasActiveFilters
                ? "Belum ada hasil yang cocok"
                : "Ruang ini menunggu pengguna pertama"
            }
          >
            {hasActiveFilters ? (
              <UiText>{"Coba nama lain atau reset filter untuk melihat seluruh pengguna."}</UiText>
            ) : (
              <UiText>{"Tambahkan akun siswa, guru, atau administrator melalui tombol di atas."}</UiText>
            )}
          </Empty>
        )}
        <div className="admin-pagination">
          <span>
            <UiText>{"Halaman"}</UiText> {currentPage} <UiText>{"dari"}</UiText> {totalPages} · {totalUsers} <UiText>{"pengguna"}</UiText>
          </span>
          <div className="pagination-actions">
            {currentPage > 1 ? (
              <Link className="pagination-btn" href={buildPageHref(currentPage - 1)}>
                <ArrowLeft size={16} aria-hidden="true" />
                <UiText>{"Sebelumnya"}</UiText>
              </Link>
            ) : (
              <span className="pagination-btn disabled" aria-disabled="true">
                <ArrowLeft size={16} aria-hidden="true" />
                <UiText>{"Sebelumnya"}</UiText>
              </span>
            )}
            {currentPage < totalPages ? (
              <Link className="pagination-btn" href={buildPageHref(currentPage + 1)}>
                <UiText>{"Berikutnya"}</UiText>
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            ) : (
              <span className="pagination-btn disabled" aria-disabled="true">
                <UiText>{"Berikutnya"}</UiText>
                <ArrowRight size={16} aria-hidden="true" />
              </span>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

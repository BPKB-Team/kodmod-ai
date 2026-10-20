import "server-only";
import { NextResponse } from "next/server";
import { session } from "@/lib/session";

export async function teacherMaterialSession() {
  const current = await session();
  if (!current) return NextResponse.json({ message: "Sesi berakhir. Silakan masuk kembali." }, { status: 401 });
  if (current.user.role !== "teacher") return NextResponse.json({ message: "Pengelolaan materi hanya tersedia untuk guru." }, { status: 403 });
  return current;
}

export async function forwardMaterial(current: Exclude<Awaited<ReturnType<typeof teacherMaterialSession>>, NextResponse>, path: string, body?: FormData | string, options: { method?: "GET" | "POST"; download?: boolean } = {}) {
  try {
    const origin = (process.env.API_ORIGIN || "http://127.0.0.1:8109").replace(/\/$/, "");
    const response = await fetch(`${origin}${path}`, {
      method: options.method ?? "POST", body, cache: "no-store", redirect: "error",
      headers: { Authorization: `Bearer ${current.token}`, Accept: "application/json", ...(typeof body === "string" ? { "Content-Type": "application/json" } : {}) },
      signal: AbortSignal.timeout(60_000),
    });
    if (options.download && response.ok) return new Response(response.body, { headers: {
      "Content-Type": response.headers.get("Content-Type") === "application/pdf" ? "application/pdf" : "application/octet-stream", "Content-Disposition": response.headers.get("Content-Disposition") ?? "attachment",
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const messages: Record<number, string> = {
        401: "Sesi berakhir. Silakan masuk kembali.",
        403: "Anda tidak dapat mengubah materi ini.",
        404: "Kelas atau materi tidak ditemukan.",
        409: "Materi sedang disiapkan atau kelas sedang diarsipkan. Perbarui status untuk melanjutkan.",
        413: "Ukuran berkas maksimal 25 MB.",
      };
      const detail = [400, 422].includes(response.status) && typeof data?.detail === "string" ? data.detail : null;
      return NextResponse.json({ message: detail || messages[response.status] || "Materi belum dapat diproses. Coba lagi beberapa saat." }, { status: response.status });
    }
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json({ message: "Layanan materi belum dapat dihubungi. Coba lagi beberapa saat." }, { status: 503 });
  }
}

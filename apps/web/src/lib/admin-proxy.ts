import "server-only";

import { NextResponse } from "next/server";
import { session } from "@/lib/session";
import { backend, BackendError } from "@/lib/server-api";

export async function forwardAdmin<T>(path: string, init: RequestInit = {}) {
  const current = await session();
  if (!current) {
    return NextResponse.json({ message: "Sesi berakhir. Silakan masuk kembali." }, { status: 401 });
  }
  if (current.user.role !== "admin") {
    return NextResponse.json({ message: "Insight operasional hanya tersedia untuk admin." }, { status: 403 });
  }
  try {
    return NextResponse.json(await backend<T>(path, current.token, init));
  } catch (error) {
    const status = error instanceof BackendError ? error.status : 503;
    const message =
      error instanceof BackendError
        ? error.message
        : "Insight operasional belum dapat dimuat. Coba lagi beberapa saat.";
    return NextResponse.json({ message }, { status });
  }
}

export async function forwardAdminDownload(path: string, preview = false) {
  const current = await session();
  if (!current) return NextResponse.json({ message: "Silakan masuk kembali." }, { status: 401 });
  if (current.user.role !== "admin") return NextResponse.json({ message: "Akses hanya untuk admin." }, { status: 403 });
  try {
    const origin = (process.env.API_ORIGIN || "http://127.0.0.1:8109").replace(/\/$/, "");
    const response = await fetch(`${origin}${path}${preview ? "?preview=true" : ""}`, { headers: { Authorization: `Bearer ${current.token}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(60_000) });
    if (!response.ok) return NextResponse.json({ message: "Berkas asli belum dapat dibuka." }, { status: response.status });
    return new Response(response.body, { headers: { "Content-Type": response.headers.get("Content-Type") === "application/pdf" ? "application/pdf" : "application/octet-stream",
      "Content-Disposition": response.headers.get("Content-Disposition") ?? "attachment", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch { return NextResponse.json({ message: "Berkas asli belum dapat dibuka." }, { status: 503 }); }
}

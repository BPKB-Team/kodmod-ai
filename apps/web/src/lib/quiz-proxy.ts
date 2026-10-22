import "server-only";

import { NextResponse } from "next/server";
import { session } from "@/lib/session";

function apiOrigin() {
  return (process.env.API_ORIGIN ?? "http://127.0.0.1:8109").replace(/\/$/, "");
}

function messageFor(status: number, code?: unknown, path?: string) {
  if (status === 409 && code === "source_index_outdated") {
    return "Indeks materi ini perlu diproses ulang oleh guru. Setelah pemrosesan selesai, coba mulai latihan kembali.";
  }
  if (status === 409 && (code === "insufficient_learning_content" || code === "source_quality_failed")) {
    return "Soal belum lolos pemeriksaan sumber. Lanjutkan ke bagian lain, kurangi jumlah soal, atau minta guru meninjau isi materi.";
  }
  if (status === 401 || status === 403) return "Sesi berakhir. Silakan masuk kembali.";
  if (status === 404) return "Latihan tidak ditemukan. Mulai sesi baru.";
  if (status === 409) return path === "/quiz/start" || path === "/learning/start"
    ? "Materi belum dapat digunakan untuk memulai sesi. Minta guru memeriksa kesiapan dan indeks materi, lalu coba lagi."
    : "Sesi telah berubah atau tindakan belum tersedia. Muat ulang sesi untuk melanjutkan.";
  if (status === 422) return "Isian latihan belum sesuai. Periksa jawabanmu.";
  if (status === 429) return "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.";
  if (status === 503) return "Layanan latihan belum dapat dihubungi. Coba lagi beberapa saat.";
  return "Latihan sedang mengalami kendala. Coba lagi beberapa saat.";
}

export async function forwardQuiz(path: string, init: RequestInit = {}) {
  const current = await session();
  if (!current) {
    return NextResponse.json(
      { message: "Sesi berakhir. Silakan masuk kembali." },
      { status: 401 },
    );
  }
  if (current.user.role !== "student") {
    return NextResponse.json({ message: "Latihan hanya tersedia untuk siswa." }, { status: 403 });
  }

  if (typeof init.body === "string" && (path === "/quiz/start" || path.startsWith("/learning/"))) {
    try {
      const body = JSON.parse(init.body);
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
      init = { ...init, body: JSON.stringify({ ...body, language: body.language === "id" || body.language === "en" ? body.language : current.user.preferred_language === "en" ? "en" : "id" }) };
    } catch {
      return NextResponse.json({ message: "Pengaturan belajar belum sesuai." }, { status: 400 });
    }
  }

  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("Authorization", `Bearer ${current.token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  let upstream: Response;
  try {
    upstream = await fetch(`${apiOrigin()}${path}`, {
      ...init,
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(
        path === "/quiz/start" || (path.startsWith("/learning/") && init.method === "POST")
          ? 180_000
          : 45_000,
      ),
    });
  } catch {
    return NextResponse.json({ message: messageFor(503) }, { status: 503 });
  }

  if (!upstream.ok) {
    const error = await upstream.json().catch(() => null);
    return NextResponse.json(
      { message: messageFor(upstream.status, error?.detail?.code, path) },
      { status: upstream.status },
    );
  }
  let raw: string;
  try {
    raw = await upstream.text();
  } catch {
    return NextResponse.json({ message: messageFor(503) }, { status: 503 });
  }
  try {
    return NextResponse.json(JSON.parse(raw), { status: upstream.status });
  } catch {
    return NextResponse.json({ message: "Respons latihan tidak valid." }, { status: 502 });
  }
}

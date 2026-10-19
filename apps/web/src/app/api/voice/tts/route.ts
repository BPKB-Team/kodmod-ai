import { NextResponse } from "next/server";
import { session } from "@/lib/session";
import { validLanguage } from "@/lib/i18n.mjs";
import { normalizeSpeechText } from "@/lib/speech-text-normalizer";

export const runtime = "nodejs";

function apiOrigin() {
  return (process.env.API_ORIGIN ?? "http://127.0.0.1:8109").replace(/\/$/, "");
}

export async function POST(request: Request) {
  const current = await session();
  if (!current) {
    return NextResponse.json({ message: "Sesi berakhir. Silakan masuk kembali." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Permintaan audio tidak valid." }, { status: 400 });
  }
  const text =
    typeof body === "object" && body !== null && "text" in body
      ? String(body.text ?? "").trim()
      : "";
  if (!text || text.length > 5_000) {
    return NextResponse.json(
      { message: "Teks yang akan dibacakan harus berisi 1 sampai 5.000 karakter." },
      { status: 400 },
    );
  }
  const language = typeof body === "object" && body !== null && "language" in body ? body.language : undefined;
  if (language !== undefined && !validLanguage(language)) return new Response(null, { status: 400 });

  const spokenText = normalizeSpeechText(text, language);

  let upstream: Response;
  try {
    upstream = await fetch(`${apiOrigin()}/voice/tts`, {
      method: "POST",
      headers: {
        Accept: "audio/mpeg, audio/wav",
        "Content-Type": "application/json",
        Authorization: `Bearer ${current.token}`,
      },
      body: JSON.stringify({ text: spokenText, language }),
      cache: "no-store",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(75_000)]),
    });
  } catch {
    return NextResponse.json(
      { message: "Layanan suara belum dapat dihubungi. Coba lagi." },
      { status: 503 },
    );
  }

  if (!upstream.ok) {
    const message =
      upstream.status === 503
        ? "Fitur suara belum diaktifkan oleh pengelola."
        : upstream.status === 403 ? "Akun ini tidak memiliki akses suara."
        : upstream.status === 401
          ? "Sesi berakhir. Silakan masuk kembali."
          : "Audio belum dapat dibuat. Coba lagi.";
    return NextResponse.json({ message }, { status: upstream.status });
  }

  return new Response(await upstream.arrayBuffer(), {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": upstream.headers.get("content-type") ?? "audio/mpeg",
    },
  });
}

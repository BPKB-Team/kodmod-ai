import "server-only";

import { NextResponse } from "next/server";
import { session } from "@/lib/session";
import { backend, BackendError } from "@/lib/server-api";

function queryFor(request: Request) {
  const raw = new URL(request.url).searchParams.get("window") || "week";
  return ["today", "week", "month", "all"].includes(raw) ? raw : "week";
}

export async function forwardStudentAnalytics(request: Request, spoken = false) {
  const current = await session();
  if (!current) {
    return NextResponse.json({ message: "Sesi berakhir. Silakan masuk kembali." }, { status: 401 });
  }
  if (current.user.role !== "student") {
    return NextResponse.json({ message: "Analitik progres hanya tersedia untuk siswa." }, { status: 403 });
  }

  try {
    const suffix = spoken ? "/me/spoken" : "/me";
    const timezone = new URL(request.url).searchParams.get("timezone");
    if (timezone) {
      try { if (timezone.length > 80) throw new Error(); new Intl.DateTimeFormat("en", {timeZone:timezone}); }
      catch { return NextResponse.json({message:"Zona waktu tidak valid."},{status:422}); }
    }
    const payload = await backend(
      `/analytics${suffix}?window=${queryFor(request)}${timezone ? `&timezone=${encodeURIComponent(timezone)}` : ""}`,
      current.token,
    );
    return NextResponse.json(payload);
  } catch (error) {
    const status = error instanceof BackendError ? error.status : 503;
    const message =
      error instanceof BackendError
        ? error.message
        : "Data progres belum dapat dimuat. Coba lagi beberapa saat.";
    return NextResponse.json({ message }, { status });
  }
}

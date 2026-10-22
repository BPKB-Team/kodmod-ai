import "server-only";
import { NextResponse } from "next/server";
import { notFound } from "next/navigation";
import { editorialRoute, sameEditorialOrigin } from "./editorial-contract.mjs";
import { session, requireSession } from "./session";
import { BackendError } from "./server-api";
import type { Role } from "./types";

async function editorialFetch<T>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<{ data: T; status: number }> {
  const origin = (process.env.API_ORIGIN || "http://127.0.0.1:8109").replace(
    /\/$/,
    "",
  );
  let response: Response;
  try {
    response = await fetch(origin + path, {
      ...init,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(path === "/teacher/quizzes/propose" ? 180_000 : 12000),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...init.headers,
      },
    });
  } catch {
    throw new BackendError(
      503,
      "Layanan belum dapat dihubungi. Muat ulang atau coba lagi.",
    );
  }
  if (!response.ok) {
    let message =
      response.status === 409
        ? "Data berubah atau penugasan belum tersedia. Muat ulang sebelum melanjutkan."
        : "Permintaan belum dapat diproses. Periksa data dan akses Anda.";
    const body = await response.json().catch(() => null);
    if (
      response.status < 500 &&
      typeof body?.detail === "string" &&
      body.detail.length <= 1000
    )
      message = body.detail;
    if (response.status === 422)
      message =
        "Periksa isian: semua soal membutuhkan pilihan dan kunci yang valid; jadwal harus sesuai.";
    throw new BackendError(response.status, message);
  }
  return { data: (await response.json()) as T, status: response.status };
}

export async function editorialBackend<T>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  return (await editorialFetch<T>(path, token, init)).data;
}

export async function editorialData<T>(path: string, role: Role): Promise<T> {
  const { token } = await requireSession(role);
  try {
    return await editorialBackend<T>(path, token);
  } catch (error) {
    if (error instanceof BackendError && error.status === 404) notFound();
    throw error;
  }
}

export async function forwardEditorial(request: Request, parts: string[]) {
  const route = editorialRoute(request.method, parts);
  if (!route)
    return NextResponse.json(
      { message: "Rute tidak tersedia." },
      { status: 404 },
    );
  try {
    const current = await session();
    if (!current)
      return NextResponse.json(
        { message: "Silakan masuk kembali." },
        { status: 401 },
      );
    if (!route.roles.includes(current.user.role))
      return NextResponse.json({ message: "Akses ditolak." }, { status: 403 });
    const url = new URL(request.url);
    const protocol =
      request.headers.get("x-forwarded-proto")?.split(",")[0].trim() ||
      url.protocol.slice(0, -1);
    if (
      request.method !== "GET" &&
      !sameEditorialOrigin(
        request.headers.get("origin"),
        request.headers.get("host"),
        protocol + ":",
      )
    )
      return NextResponse.json(
        { message: "Asal permintaan tidak sesuai." },
        { status: 403 },
      );
    const query = new URLSearchParams();
    if (request.method === "GET") {
      for (const key of ["limit", "offset"]) {
        const value = url.searchParams.get(key);
        if (value !== null) {
          if (
            !/^\d+$/.test(value) ||
            Number(value) > (key === "limit" ? 100 : 1000000) ||
            (key === "limit" && Number(value) < 1)
          )
            return NextResponse.json(
              { message: "Halaman tidak valid." },
              { status: 400 },
            );
          query.set(key, value);
        }
      }
    }
    let body: string | undefined;
    if (request.method !== "GET") {
      if (
        !request.headers
          .get("content-type")
          ?.toLowerCase()
          .startsWith("application/json")
      )
        return NextResponse.json(
          { message: "Format permintaan harus JSON." },
          { status: 415 },
        );
      body = await request.text();
      if (new TextEncoder().encode(body).byteLength > 2 * 1024 * 1024)
        return NextResponse.json(
          { message: "Isian terlalu besar." },
          { status: 413 },
        );
      try {
        JSON.parse(body);
      } catch {
        return NextResponse.json(
          { message: "JSON tidak valid." },
          { status: 400 },
        );
      }
    }
    const key = request.headers.get("Idempotency-Key");
    const result = await editorialFetch(
      route.path + (query.size ? `?${query}` : ""),
      current.token,
      {
        method: request.method,
        body,
        headers: key ? { "Idempotency-Key": key } : {},
      },
    );
    return NextResponse.json(result.data, {
      status: result.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof BackendError
            ? error.message
            : "Layanan belum tersedia.",
      },
      { status: error instanceof BackendError ? error.status : 503 },
    );
  }
}

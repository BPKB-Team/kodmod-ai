/**
 * Klien HTTP tipis ke ai-engine.
 * Saat dev, Vite mem-proxy /api dan /ws ke http://localhost:8000
 * (lihat vite.config.ts), jadi tidak perlu URL absolut.
 */
const BASE = import.meta.env.VITE_API_BASE ?? "/api";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Accept: "application/json", ...init?.headers },
  });
  if (!res.ok) throw new ApiError(`GET ${path} gagal`, res.status);
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    ...init,
    headers: { "Content-Type": "application/json", Accept: "application/json", ...init?.headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(`POST ${path} gagal`, res.status);
  return res.json() as Promise<T>;
}

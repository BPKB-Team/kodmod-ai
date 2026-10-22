import "server-only";

export class BackendError extends Error {
  constructor(
    public status: number,
    message: string,
    public detail?: unknown,
  ) {
    super(message);
  }
}
export async function backend<T>(
  path: string,
  token?: string,
  init: RequestInit = {},
): Promise<T> {
  const origin = (process.env.API_ORIGIN || "http://127.0.0.1:8109").replace(
    /\/$/,
    "",
  );
  let response: Response;
  try {
    response = await fetch(`${origin}${path}`, {
      ...init,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(12000),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new BackendError(
      503,
      "Layanan belum dapat dihubungi. Coba lagi beberapa saat.",
    );
  }
  if (!response.ok) {
    let detail: unknown;
    try {
      detail = (await response.json())?.detail;
    } catch {
      // Keep the stable, user-safe message below when the response has no JSON.
    }
    const messages: Record<number, string> = {
      400: "Permintaan belum dapat diproses. Periksa kembali data yang diisi.",
      401: "Sesi berakhir. Silakan masuk kembali.",
      403: "Akses ditolak atau akun tidak aktif. Hubungi administrator.",
      404: "Data tidak ditemukan. Muat ulang daftar.",
      409: "Username sudah digunakan. Pilih username lain.",
      422: "Data belum sesuai. Periksa format dan panjang isian.",
      429: "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.",
    };
    throw new BackendError(
      response.status,
      messages[response.status] ||
        "Layanan mengalami kendala. Coba lagi beberapa saat.",
      detail,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

"use server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { parseReadingPreferences } from "@/lib/reading-preferences";
import { requireSession } from "@/lib/session";
import { sessionCookieSecure } from "@/lib/cookie-security";
import { backend, BackendError } from "@/lib/server-api";
import type { ActionState } from "@/lib/types";

export async function saveReadingSettings(
  _: ActionState,
  data: FormData,
): Promise<ActionState> {
  const { user } = await requireSession("student");
  const size = String(data.get("size"));
  const spacing = String(data.get("spacing"));
  const contrast = data.get("contrast") === "on";
  if (
    !["18", "20", "24", "28"].includes(size) ||
    !["1.65", "1.95", "2.3"].includes(spacing)
  )
    return {
      error: "Pilihan tampilan tidak valid. Pilih kembali pengaturan bacaan.",
    };
  (await cookies()).set(
    `kodmod_reading_${user.id}`,
    JSON.stringify(
      parseReadingPreferences(JSON.stringify({ size, spacing, contrast })),
    ),
    {
      httpOnly: true,
      secure: sessionCookieSecure(),
      sameSite: "lax",
      path: "/student",
      maxAge: 60 * 60 * 24 * 365,
    },
  );
  revalidatePath("/student", "layout");
  return {
    success: "Preferensi bacaan disimpan untuk akun Anda di browser ini.",
  };
}

export async function saveReadingProgress(
  classId: string,
  materialId: string,
  _: ActionState,
  data: FormData,
): Promise<ActionState> {
  const { token } = await requireSession("student");
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const field = data.get("field");
  const value = data.get("value");
  if (
    !uuid.test(classId) ||
    !uuid.test(materialId) ||
    (field !== "completed" && field !== "bookmarked") ||
    (value !== "true" && value !== "false")
  )
    return { error: "Perubahan tidak valid. Muat ulang materi." };
  try {
    await backend(
      `/classes/${classId}/materials/${materialId}/progress`,
      token,
      { method: "PATCH", body: JSON.stringify({ [field]: value === "true" }) },
    );
  } catch (error) {
    return {
      error:
        error instanceof BackendError
          ? error.status === 404
            ? "Materi tidak lagi tersedia untuk akun Anda. Kembali ke pustaka untuk melihat materi yang dapat diakses."
            : error.message
          : "Progres belum tersimpan. Silakan coba lagi.",
    };
  }
  revalidatePath("/student", "layout");
  return {
    success:
      field === "completed"
        ? value === "true"
          ? "Materi ditandai sudah dipelajari."
          : "Materi dikembalikan ke daftar belum selesai."
        : value === "true"
          ? "Materi ditambahkan ke bookmark."
          : "Bookmark materi dihapus.",
  };
}

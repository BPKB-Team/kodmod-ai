"use server";

import { revalidatePath } from "next/cache";
import { backend, BackendError } from "@/lib/server-api";
import { requireSession } from "@/lib/session";
import type { ActionState } from "@/lib/types";

const text = (data: FormData, key: string) => String(data.get(key) ?? "").trim();

function problem(error: unknown): ActionState {
  if (error instanceof BackendError) {
    return { error: error.message };
  }
  return { error: "Terjadi kesalahan sistem saat memproses data." };
}

export async function saveAdminClass(
  _state: ActionState,
  data: FormData
): Promise<ActionState> {
  const { token } = await requireSession("admin");
  const id = text(data, "id");
  const name = text(data, "name");
  const subjectId = text(data, "subject_id");
  const teacherId = text(data, "teacher_id");
  const description = text(data, "description");
  const isArchived = data.get("is_archived") === "true";

  if (!name || name.length > 120) {
    return { error: "Nama kelas harus diisi (maksimal 120 karakter)." };
  }
  if (!id && !teacherId) {
    return { error: "Pilih guru pengampu kelas." };
  }
  if (!id && !subjectId) {
    return { error: "Pilih mata pelajaran untuk kelas." };
  }

  const payload: Record<string, unknown> = {
    name,
    description,
    is_archived: isArchived,
  };
  if (subjectId) payload.subject_id = subjectId;
  if (teacherId) payload.teacher_id = teacherId;

  try {
    if (id) {
      await backend(`/admin/classes/${encodeURIComponent(id)}`, token, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    } else {
      await backend("/admin/classes", token, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    }
  } catch (error) {
    return problem(error);
  }

  revalidatePath("/admin/akademik");
  return { success: id ? "Data kelas berhasil diperbarui." : "Kelas baru berhasil ditambahkan." };
}

export async function deleteAdminClass(
  _state: ActionState,
  data: FormData
): Promise<ActionState> {
  const { token } = await requireSession("admin");
  const id = text(data, "id");
  if (!id) return { error: "ID kelas tidak valid." };

  try {
    await backend(`/admin/classes/${encodeURIComponent(id)}`, token, {
      method: "DELETE",
    });
  } catch (error) {
    return problem(error);
  }

  revalidatePath("/admin/akademik");
  return { success: "Kelas beserta seluruh data turunannya berhasil dihapus permanen." };
}

export async function saveAdminSubject(
  _state: ActionState,
  data: FormData
): Promise<ActionState> {
  const { token } = await requireSession("admin");
  const id = text(data, "id");
  const name = text(data, "name");
  const description = text(data, "description");

  if (!name || name.length > 120) {
    return { error: "Nama mata pelajaran harus diisi (maksimal 120 karakter)." };
  }

  const payload = {
    name,
    description,
  };

  try {
    if (id) {
      await backend(`/admin/subjects/${encodeURIComponent(id)}`, token, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    } else {
      await backend("/admin/subjects", token, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    }
  } catch (error) {
    return problem(error);
  }

  revalidatePath("/admin/akademik");
  return {
    success: id
      ? "Mata pelajaran berhasil diperbarui."
      : "Mata pelajaran baru berhasil ditambahkan.",
  };
}

export async function deleteAdminSubject(
  _state: ActionState,
  data: FormData
): Promise<ActionState> {
  const { token } = await requireSession("admin");
  const id = text(data, "id");
  if (!id) return { error: "ID mata pelajaran tidak valid." };

  try {
    await backend(`/admin/subjects/${encodeURIComponent(id)}`, token, {
      method: "DELETE",
    });
  } catch (error) {
    return problem(error);
  }

  revalidatePath("/admin/akademik");
  return {
    success:
      "Mata pelajaran beserta seluruh kelas dan data turunannya berhasil dihapus permanen.",
  };
}

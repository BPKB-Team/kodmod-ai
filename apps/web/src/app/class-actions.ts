"use server";

import { revalidatePath } from "next/cache";
import { backend, BackendError } from "@/lib/server-api";
import { requireSession } from "@/lib/session";
import type { ActionState } from "@/lib/types";
import type { Classroom, Material } from "@/lib/class-types";

const value = (data: FormData, key: string) =>
  String(data.get(key) ?? "").trim();
const uuid = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
function failure(error: unknown): ActionState {
  return {
    error:
      error instanceof BackendError
        ? error.status === 409
          ? "Perubahan belum bisa disimpan. Anggota mungkin sudah terdaftar atau kelas sudah diarsipkan. Muat ulang kelas untuk memeriksa."
          : error.status === 404
            ? "Kelas, materi, atau username siswa tidak ditemukan. Periksa kembali akses dan isian Anda."
            : error.message
        : "Perubahan belum tersimpan. Silakan coba lagi.",
  };
}
function refresh() {
  revalidatePath("/guru", "layout");
  revalidatePath("/siswa", "layout");
}

export async function createClass(
  _: ActionState,
  data: FormData,
): Promise<ActionState> {
  const { token } = await requireSession("teacher");
  let row: Classroom;
  try {
    row = await backend<Classroom>("/classes", token, {
      method: "POST",
      body: JSON.stringify({
        name: value(data, "name"),
        subject: value(data, "subject_id") === "__new__" ? value(data, "new_subject") : "",
        subject_id: uuid(value(data, "subject_id")) ? value(data, "subject_id") : null,
        description: value(data, "description"),
      }),
    });
  } catch (error) {
    return failure(error);
  }
  refresh();
  return {
    success: "Kelas berhasil dibuat. Tambahkan siswa dan materi untuk mulai belajar.",
    redirectUrl: `/guru/kelas/${row.id}?success=class-created`,
  };
}

export async function changeClass(
  classId: string,
  _: ActionState,
  data: FormData,
): Promise<ActionState> {
  const { token } = await requireSession("teacher");
  if (!uuid(classId)) return { error: "Kelas tidak valid." };
  const mode = value(data, "mode");
  try {
    if (mode === "archive" || mode === "restore") {
      await backend(`/classes/${classId}`, token, {
        method: "PATCH",
        body: JSON.stringify({ is_archived: mode === "archive" }),
      });
    } else if (mode === "add-member") {
      await backend(`/classes/${classId}/members`, token, {
        method: "POST",
        body: JSON.stringify({ username: value(data, "username") }),
      });
    } else if (mode === "remove-member" && uuid(value(data, "studentId"))) {
      await backend(
        `/classes/${classId}/members/${value(data, "studentId")}`,
        token,
        { method: "DELETE" },
      );
    } else return { error: "Tindakan tidak valid." };
  } catch (error) {
    return failure(error);
  }
  refresh();
  return {
    success:
      mode === "add-member"
        ? "Siswa berhasil ditambahkan."
        : mode === "remove-member"
          ? "Akses siswa ke kelas telah dicabut."
          : mode === "archive"
            ? "Kelas diarsipkan. Siswa tidak lagi dapat mengaksesnya."
            : "Kelas aktif kembali.",
  };
}

export async function addMembers(
  classId: string,
  _: ActionState,
  data: FormData,
): Promise<ActionState> {
  const { token } = await requireSession("teacher");
  const ids = data.getAll("student_ids").map(String).filter(uuid);
  if (!uuid(classId) || !ids.length) return { error: "Pilih minimal satu siswa." };
  let added = 0;
  try {
    ({ added } = await backend<{ added: number }>(`/classes/${classId}/members/batch`, token, {
      method: "POST",
      body: JSON.stringify({ student_ids: ids.slice(0, 50) }),
    }));
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { success: `${added} siswa berhasil ditambahkan.` };
}

export async function saveMaterial(
  classId: string,
  materialId: string | null,
  _: ActionState,
  data: FormData,
): Promise<ActionState> {
  const { token } = await requireSession("teacher");
  const effectiveClassId = classId || value(data, "class_id");
  if (!uuid(effectiveClassId) || (materialId && !uuid(materialId)))
    return { error: "Kelas atau materi tidak valid." };
  let row: Material;
  try {
    row = await backend<Material>(
      `/classes/${effectiveClassId}/materials${materialId ? `/${materialId}` : ""}`,
      token,
      {
        method: materialId ? "PUT" : "POST",
        body: JSON.stringify({
          title: value(data, "title"),
          content: value(data, "content"),
          published: value(data, "published") === "yes",
          source_filename: value(data, "source_filename") || null,
          source_import_id: value(data, "source_import_id") || null,
        }),
      },
    );
  } catch (error) {
    return failure(error);
  }
  refresh();
  if (!materialId) {
    return {
      success: "Materi berhasil disimpan dan siap dipelajari.",
      redirectUrl: `/guru/kelas/${effectiveClassId}/materi/${row.id}?success=material-saved`,
    };
  }
  return { success: "Materi disimpan sesuai status publikasinya." };
}

"use server";

import { revalidatePath } from "next/cache";
import { backend, BackendError } from "@/lib/server-api";
import { requireSession } from "@/lib/session";
import type { ActionState } from "@/lib/types";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const value = (data: FormData, key: string) => String(data.get(key) ?? "").trim();
function failure(error: unknown): ActionState {
  return { error: error instanceof BackendError ? error.message : "Perubahan belum tersimpan. Silakan coba lagi." };
}
function refresh() {
  revalidatePath("/teacher", "layout");
  revalidatePath("/student", "layout");
  revalidatePath("/admin", "layout");
}

export async function chooseClassSubject(classId: string, _: ActionState, data: FormData): Promise<ActionState> {
  const { token } = await requireSession("teacher");
  const id = value(data, "subject_id");
  if (!uuid.test(classId) || (id && !uuid.test(id))) return { error: "Mata pelajaran tidak valid." };
  try {
    await backend(`/classes/${classId}`, token, { method: "PATCH", body: JSON.stringify({ subject_id: id || null }) });
    refresh();
    return { success: "Mata pelajaran kelas berhasil disimpan." };
  } catch (error) { return failure(error); }
}

export async function approveMaterialConcepts(classId: string, materialId: string, _: ActionState, data: FormData): Promise<ActionState> {
  const { token } = await requireSession("teacher");
  const ids = data.getAll("concept_ids").map(String);
  const content = Number(value(data, "content_version"));
  const mapping = Number(value(data, "mapping_version"));
  const primary = value(data, "primary_concept_id");
  if (![classId, materialId].every(id => uuid.test(id)) || ids.length > 30 ||
      ids.some(id => !uuid.test(id)) || new Set(ids).size !== ids.length ||
      !Number.isSafeInteger(content) || content < 1 || !Number.isSafeInteger(mapping) || mapping < 0 ||
      (primary && !ids.includes(primary))) return { error: "Pilihan konsep tidak valid. Muat ulang materi." };
  try {
    await backend(`/classes/${classId}/materials/${materialId}/concepts`, token, {
      method: "PUT", body: JSON.stringify({
        expected_content_version: content, expected_mapping_version: mapping,
        concept_ids: ids, primary_concept_id: primary || null,
      }),
    });
    refresh();
    return { success: "Konsep materi berhasil disetujui." };
  } catch (error) { return failure(error); }
}

export async function createCurriculumSubject(_: ActionState, data: FormData): Promise<ActionState> {
  const { token } = await requireSession("teacher");
  const name = value(data, "name");
  if (!name || name.length > 120) return { error: "Isi nama mata pelajaran, maksimal 120 karakter." };
  try {
    await backend("/subjects", token, { method: "POST", body: JSON.stringify({ name, description: "" }) });
    refresh();
    return { success: "Mata pelajaran berhasil ditambahkan. Pilih dari daftar untuk menggunakannya." };
  } catch (error) { return failure(error); }
}

export async function createCurriculumConcept(subjectId: string, _: ActionState, data: FormData): Promise<ActionState> {
  const { token } = await requireSession("teacher");
  const name = value(data, "name"), slug = value(data, "slug");
  if (!uuid.test(subjectId) || !name || name.length > 200 || !/^[a-z0-9][a-z0-9-]{0,199}$/.test(slug))
    return { error: "Isi nama konsep dan kode berupa huruf kecil, angka, atau tanda hubung." };
  try {
    await backend(`/subjects/${subjectId}/concepts`, token, { method: "POST", body: JSON.stringify({ subject_id: subjectId, name, slug, description: "", difficulty_level: "medium" }) });
    refresh();
    return { success: "Konsep berhasil ditambahkan. Pilih dan tinjau sebelum menyetujui materi." };
  } catch (error) { return failure(error); }
}

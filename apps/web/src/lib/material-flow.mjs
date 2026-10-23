const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MATERIAL_UPLOAD_LIMIT = 25 * 1024 * 1024;

export function canChangeMaterialTarget({ importing, hasBook, sourceImportId, pending = false }) {
  return !importing && !hasBook && !sourceImportId && !pending;
}

export function materialTutorStatus(material) {
  if (!material.published) return { heading: "Materi masih berupa draf", description: "Terbitkan materi setelah meninjau isinya. Setelah itu, materi akan disiapkan untuk Tutor.", actionLabel: null };
  const current = material.indexed_version === material.content_version && (material.indexed_mapping_version ?? 0) === (material.mapping_version ?? 0) && material.n_chunks > 0;
  if (material.rag_status === "ready" && current) return { heading: "Materi siap digunakan Tutor", description: "Tutor dapat menjawab berdasarkan isi materi yang terakhir disimpan.", actionLabel: null };
  if (material.rag_status === "processing") return { heading: "Menyiapkan materi untuk Tutor", description: "Materi tetap dapat dibaca. Perbarui status setelah proses selesai. Jika proses terhenti, Anda dapat menyiapkan ulang.", actionLabel: "Siapkan ulang jika terhenti" };
  if (material.rag_status === "failed") return { heading: "Materi belum siap untuk Tutor", description: "Isi materi tetap tersimpan. Coba siapkan ulang atau periksa pengaturan layanan AI.", actionLabel: "Coba lagi" };
  return { heading: "Materi belum disiapkan untuk Tutor", description: "Materi sudah dapat dibaca siswa. Siapkan materi agar Tutor dapat memakai isinya.", actionLabel: "Siapkan untuk Tutor" };
}

export function validateMaterialFile(file) {
  if (!file || !/\.(pdf|docx|md|txt)$/i.test(file.name)) return "Gunakan PDF, DOCX, Markdown, atau TXT.";
  if (!file.size) return "Berkas kosong. Pilih dokumen yang berisi materi.";
  if (file.size > MATERIAL_UPLOAD_LIMIT) return "Ukuran berkas maksimal 25 MB.";
  return null;
}

export function parseMaterialPageRange(first, last) {
  if (first == null && last == null) return null;
  if (!/^\d{1,3}$/.test(String(first ?? "")) || !/^\d{1,3}$/.test(String(last ?? "")))
    throw new Error("Pilih halaman awal dan akhir yang valid.");
  const start = Number(first), end = Number(last);
  if (start < 1 || end < start || end > 500 || end - start + 1 > 150)
    throw new Error("Pilih halaman awal dan akhir yang valid, maksimal 150 halaman per materi.");
  return { first: start, last: end };
}

export function chatMessagePayload(incoming) {
  const text = typeof incoming?.text === "string" ? incoming.text.trim() : "";
  if (!text || text.length > 4000) throw new Error("Pertanyaan harus berisi 1 sampai 4.000 karakter.");
  const payload = { text };
  for (const key of ["session_id", "subject_id", "class_id", "material_id"]) {
    if (incoming[key] === undefined || incoming[key] === null || incoming[key] === "") continue;
    if (typeof incoming[key] !== "string" || !uuid.test(incoming[key].trim())) throw new Error("Pilihan sesi atau materi tidak valid.");
    payload[key] = incoming[key].trim();
  }
  if (Boolean(payload.class_id) !== Boolean(payload.material_id)) throw new Error("Pilih kelas dan materi secara bersamaan.");
  return payload;
}

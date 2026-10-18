# Integrasi Qdrant

Qdrant adalah indeks kandidat opsional untuk retrieval KODMOD. PostgreSQL
tetap menyimpan teks dan embedding kanonis, memeriksa izin dan versi materi,
serta menjadi fallback jika Qdrant bermasalah. Qdrant hanya mengembalikan ID
kandidat; backend mengambil teks yang boleh dipakai dari PostgreSQL.

Panduan ini menjelaskan alur integrasi untuk pengembang. Untuk langkah Docker
Centre, konfigurasi, reindex, pemeriksaan runtime, backup, pemulihan, keamanan,
dan rollback, ikuti [panduan operasional](QDRANT_OPERATIONS.md).

## Batas data dan keamanan

- PostgreSQL adalah sumber kebenaran untuk materi, enrollment, publikasi,
  status pemrosesan, versi isi, dan pemetaan konsep.
- Qdrant menyimpan vektor dan metadata filter allowlist. Payload tidak boleh
  berisi teks potongan, path berkas, provenance dokumen, atau metadata
  aksesibilitas.
- Hasil pencarian Qdrant bukan bukti izin. Setiap ID kandidat divalidasi lagi
  oleh query PostgreSQL sebelum teks dikirim ke tutor.
- Di Docker Centre, Qdrant berada pada jaringan privat Compose. Port REST
  `6333` dan gRPC `6334` tidak dipublikasikan ke host.
- Snapshot dan vektor tetap diperlakukan sebagai data privat.

## Alur retrieval

1. API memilih backend lewat `VECTOR_BACKEND`. Default tetap `pgvector`.
2. Jika backend `qdrant`, adapter Qdrant mencari ID point dengan filter scope
   dan metadata yang sesuai.
3. Adapter mengirim ID tersebut ke query PostgreSQL yang sama dengan pencarian
   pgvector. PostgreSQL memeriksa pasangan siswa/kelas, enrollment, publikasi,
   status materi, versi isi, dan versi pemetaan konsep sebelum mengembalikan
   teks.
4. Jika Qdrant timeout, koleksi tidak ada, hasil stale, atau hasil tervalidasi
   kurang dari kebutuhan, retrieval menjalankan pencarian penuh pgvector.

Dengan begitu, gangguan atau indeks Qdrant yang belum lengkap tidak
menonaktifkan materi yang masih tersedia di PostgreSQL.

## Sinkronisasi indeks

Transaksi PostgreSQL tetap didahulukan. Setelah commit, proses mencoba
memirror ID, vektor, dan payload allowlist ke Qdrant. Kegagalan sinkronisasi
dicatat sebagai indeks terdegradasi; PostgreSQL tidak dibatalkan dan
retrieval tetap dapat memakai pgvector. Proses impor, penggantian materi,
dan penghapusan mengikuti batas yang sama.

Untuk mengisi indeks yang kosong atau tertinggal, jalankan
`python -m scripts.reindex_qdrant --batch-size 256` dari container `ai-engine`
di Docker Centre. Perintah ini membaca vektor yang sudah tersimpan di
PostgreSQL dan tidak memanggil penyedia embedding. Upsert berulang untuk ID
yang sama aman. Reindex tidak menghapus point lama; untuk indeks bersih,
gunakan nama koleksi baru dan verifikasi sebelum beralih.

## Peta implementasi

| Area | Tanggung jawab |
|---|---|
| `apps/ai-engine/config/settings.py` | Memilih backend, URL, nama koleksi, dan timeout. |
| `apps/ai-engine/rag/stores/qdrant_store.py` | Membuat koleksi, mencari ID kandidat, mengirim upsert/hapus, dan mengelola client Qdrant. |
| `apps/ai-engine/rag/stores/pgvector_store.py` | Query otoritatif untuk izin, freshness, teks materi, dan fallback pgvector. |
| `apps/ai-engine/rag/retriever.py` | Retrieval untuk alur tutor LangGraph. |
| `apps/ai-engine/tools/rag_tool.py` | Retrieval saat RAG dipanggil sebagai tool. |
| `apps/ai-engine/api/material_service.py` | Sinkronisasi best-effort setelah materi ditambah, diganti, atau dihapus. |
| `apps/ai-engine/scripts/reindex_qdrant.py` | Backfill bertahap dari embedding kanonis PostgreSQL. |

Test adapter dan fallback berada di `apps/ai-engine/tests/unit/test_qdrant_store.py`
serta `apps/ai-engine/tests/integration/test_rag_retriever.py`.

## Dokumen terkait

- [Operasional Qdrant](QDRANT_OPERATIONS.md): aktivasi Docker Centre, verifikasi,
  backup/restore, keamanan, dan rollback.
- [Arsitektur aplikasi](ARCHITECTURE.md): batas PostgreSQL dan Qdrant di
  keseluruhan KODMOD.
- [Deployment Docker dan VPS](DEPLOYMENT.md): lokasi konfigurasi lokal serta
  status bahwa Qdrant belum diaktifkan di Compose produksi VPS.
- [Spesifikasi desain](superpowers/specs/2026-10-17-qdrant-rag-design.md) dan
  [rencana implementasi](superpowers/plans/2026-10-17-qdrant-rag.md): keputusan
  desain dan hasil rollout.

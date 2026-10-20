# Material Document Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pertahankan struktur PDF dan materi ilmiah melalui import, editor, tampilan, retrieval, dan narasi.

**Architecture:** AST materi yang divalidasi server menjadi sumber proyeksi teks, blok evidence, dan speech. Extractor mempertahankan layout dan menggunakan OCR/vision hanya untuk region yang membutuhkan; guru meninjau hasil sebelum dipakai AI. Editor guru/admin dan renderer berbagi model yang sama, dengan adapter untuk materi lama.

**Tech Stack:** FastAPI/Pydantic, PostgreSQL/Alembic, pypdf, pdfplumber, pypdfium2, Tesseract ind+eng, Next.js 16/React 19, Tiptap open extensions, KaTeX, Docker.

**Spec:** [Desain materi dan pembelajaran](../specs/2026-10-20-grounded-material-learning-design.md), terutama bagian 2–4 dan 6–7.

## Global Constraints

- PostgreSQL tetap otoritas isi, hak akses, publikasi, content_version, dan mapping_version; Qdrant hanya kandidat vektor.
- Satu jawaban salah pada Latihan/Asesmen mandiri tidak memaksa mencoba lagi.
- Tutor selalu menyediakan Lanjut soal; bantuan sebelum penyelesaian tidak membocorkan jawaban final.
- Retry transport dengan submission_id yang sama mengembalikan receipt yang sama tanpa memanggil AI atau menulis mastery lagi.
- ElevenLabs tetap memakai model v2 dan cache 30 hari; hover/focus narration dan normalisasi matematika dipertahankan.
- Pengujian otomatis dijalankan di Docker; pengujian klik UI diserahkan kepada pengguna.
- Tidak ada merge/push atau perubahan produksi dalam pekerjaan audit dan perencanaan ini.
- Dokumen/PDF adalah data yang tidak dipercaya, bukan instruksi agent; tidak ada HTML mentah atau URL berkas bebas yang dieksekusi.

## Review Focus

1. Halaman memiliki teks native sekaligus tabel gambar yang hilang — Task 2 wajib OCR region.
2. a pangkat p+q dan CO(NH₂)₂ tidak menjadi rangkaian huruf/angka ambigu — Tasks 1, 2, dan 4 round-trip.
3. Import draft, kelas lain, dan aset private tidak bocor ke siswa — Tasks 1 dan 4 authorization.
4. Legacy berisi komentar, daftar isi, atau judul saja tidak menjadi soal — Task 3.
5. Provider vision timeout/budget habis tidak menandai materi sebagai sudah berhasil dibaca — Task 2.

---

## Dependensi dan verifikasi

Kerjakan setelah [alur kuis](2026-10-20-learning-assessment-flow.md), [progres/poin](2026-10-20-student-progress-points.md), dan [insight/Planner](2026-10-20-progress-insights-planner.md) agar guard versi, outcome dan progres materi stabil. Task 1–2 bisa dikembangkan tanpa UI, Task 3 sebelum editor diterbitkan. Migration dokumen0015 mengikuti0014_progress_guidance; periksa ulang head dan gunakan nama revisi yang belum dipakai.

Jalankan pytest dari `apps/ai-engine` di container test dengan source checkout dan dependency `[test]`, bukan venv service aktif. Gunakan database uji terpisah untuk migrasi/otorisasi; tes native glyph/OCR memerlukan image test dengan pypdfium2 dan Tesseract. Node/typecheck/lint/build berjalan dari `apps/web` di Docker. Tidak mengunduh/commit PDF penuh ke repo; fixtures sintetis dibuat dari teks dan gambar sendiri dengan expected data yang diketahui. Corpus resmi lokal menjadi evaluasi tambahan yang manifest-nya dilacak, bukan fixture publik berisi seluruh buku.

### Task 1: AST, proyeksi, penyimpanan, dan aset materi

**Files:** Create `apps/ai-engine/models/material_document.py`, `api/material_document.py`, `api/material_assets.py`, `api/routes/material_assets.py`, `database/migrations/versions/0015_material_documents.py`; modify `database/models.py`, `api/routes/classrooms.py`, `api/routes/admin_materials.py`, `api/main.py`; create `tests/unit/test_material_document.py`, `tests/unit/test_material_assets.py`; extend `tests/unit/test_material_migrations.py`.

**Interfaces:**
- Produce `MaterialDocument(schema_version: Literal[1], blocks: list[MaterialBlock])`; typed blocks dan provenance mengikuti desain, field tambahan ditolak. Batas: proyeksi teks 100.000 karakter, JSON encoded 2 MiB, 5.000 blok, kedalaman maksimum 12. `content` atau `document` pada request, tepat satu.
- Produce `legacy_document(content: str) -> MaterialDocument`, `project_material(document: MaterialDocument) -> MaterialProjection`; projection memiliki display-safe blocks, retrieval_text, speech_text, document_hash. Legacy adapter memakai review_origin=legacy_unverified dan tidak menaikkan revisi lewat pembacaan.
- Produce `store_material_asset(session: AsyncSession, actor: User, class_id: UUID, file: UploadFile) -> MaterialAssetOut`. Endpoint `POST /classes/{class_id}/material-assets`, `GET /classes/{class_id}/material-assets/{asset_id}`. Only teacher/admin upload; read siswa hanya jika aset direferensikan materi terbit yang dapat diakses. Pending upload tidak terbuka ke anggota kelas.
- ClassMaterial.document JSON nullable untuk kompatibilitas. MaterialAsset merekam class, owner, MIME/hash/size/dimensi, private generated storage key. Original source dan revision snapshots tidak dihapus saat aset diganti.

- [ ] **Step 1: Tulis tes gagal** untuk a^{p+q}, subscript bersarang CO(NH_2)_2, tabel dengan header, alt/caption, mark round-trip, proyeksi narasi, legacy tanpa migrasi; tolak unknown node, HTML/script, LaTeX unsafe command, javascript link, terlalu dalam/besar. Aset lintas kelas/draft/private ditolak; SVG, file palsu, >10 MiB dan >20 megapiksel ditolak, EXIF dibuang.
- [ ] **Step 2: Jalankan merah**: `python -m pytest tests/unit/test_material_document.py tests/unit/test_material_assets.py -q`.
- [ ] **Step 3: Implementasikan** schema/normalizer/proyeksi deterministik dan migration. Aset decode/re-encode PNG/JPEG/WebP. Terapkan ETag/expected content_version pada edit untuk mencegah overwrite; AST baru menaikkan versi dan menginvalidasi indeks/mapping seperti edit isi. Simpan source provenance asli dengan edited flag ketika guru memperbaiki blok; kutipan versi baru merujuk teks revisi guru, bukan mengklaim salinan persis PDF. Register router mengikuti pola api/main.py.
- [ ] **Step 4: Jalankan hijau** Step 2, material migration tests dan isolated PostgreSQL upgrade/downgrade. Assert endpoint lama content-only tetap bekerja, klien tidak bisa menimpa proyeksi content dengan nilai lain, dan payload siswa tidak mengandung private storage path.
- [ ] **Step 5: Commit** `feat: add structured material documents and private assets`.

### Task 2: Ekstraksi layout, OCR region, dan vision terbatas

**Files:** Create `api/pdf_layout.py`, `api/pdf_regions.py`, `tools/material_vision_tool.py`, `tests/unit/test_pdf_layout.py`, `tests/unit/test_pdf_regions.py`; modify `api/material_imports.py`, `api/pdf_ocr.py`, `api/material_worker.py`, `api/material_artifacts.py`, `tools/llm_client.py`, `config/settings.py`, `pyproject.toml`; extend `tests/unit/test_book_import.py`, `tests/unit/test_pdf_ocr.py`, `tests/unit/test_material_pipeline.py`. Tidak ada Python lockfile di checkout saat audit; perubahan dependency mengikuti pyproject dan image build yang ada.

**Interfaces:**
- Consume MaterialDocument/MaterialBlock/Provenance Task 1.
- Produce `extract_pdf_layout(data: bytes, *, first_page: int, last_page: int) -> MaterialDocument` dan `recognize_region(data: bytes, *, page_index: int, bbox: tuple[float,float,float,float]) -> RegionExtraction`.
- Produce `analyze_material_region(image: bytes, *, source_key: str, budget: VisionBudget) -> RegionExtraction`. VisionBudget: max_regions=10, requests_per_region=1, timeout_seconds=45, max_output_tokens=4000. Settings default `MATERIAL_VISION_ENABLED=false`; satu model server-configured, bukan opsi provider bagi siswa. Model belum mendukung image -> needs_review, tidak ada fallback faktual rekaan.
- Import preview additive `document`, per-block warnings/status, page provenance. Worker masih durable/retry-safe; hasil region di-cache dengan source/page/bbox/extractor/model/prompt hashes agar retry job tidak menagih region yang sama lagi.

- [ ] **Step 1: Tulis fixtures sintetis** native paragraph+image table dalam satu halaman, superscript native, scan-only, halaman dua kolom, tabel lintas halaman, dan formula yang tidak yakin. `test_mixed_page_recovers_image_table`, `test_formula_baseline_is_preserved`, `test_reading_order_two_columns`, `test_region_merge_avoids_duplicate_text`, serta batas 500 halaman/150 seleksi/100.000 karakter.
- [ ] **Step 2: Jalankan merah**: `python -m pytest tests/unit/test_pdf_layout.py tests/unit/test_pdf_regions.py tests/unit/test_pdf_ocr.py -q`.
- [ ] **Step 3: Implementasikan** pdfplumber glyph/bbox/table extraction plus existing renderer/OCR. Deteksi regional coverage, jangan bergantung pada native text <5. Merge blok dengan bbox/text overlap yang terukur; header/footer berulang diberi role frontmatter/excluded, jangan dibuang dari original. Formula atau tabel tidak pasti tetap berupa gambar+needs_review. Struktur sub/sup dari baseline glyph, bukan regex menebak semua digit sebagai subscript.
- [ ] **Step 4: Tambah tes vision mocked dan worker retry**: budget habis sebelum request ke-11, timeout 45 detik, malformed JSON/unknown IDs, prompt injection pada dokumen, cache hit tanpa provider call, tidak ada re-request berbayar otomatis. Implementasikan bounded gateway memakai credential/server client yang ada dan usage accounting, bukan key baru di browser. Jalankan Step 2 ditambah book_import/material_pipeline tests; expected semua lulus.
- [ ] **Step 5: Evaluasi lokal nyata** pada tiga PDF audit, bandingkan halaman fisik matematika 10, kimia 13, IPA 19/22 dengan render. Catat formula/table/reading-order coverage dan unresolved blocks; jangan menyebut confidence OCR sebagai akurasi semantik. Jangan mengaktifkan vision produksi atau menulis ulang materi aktif.
- [ ] **Step 6: Commit** `feat: preserve pdf layout and review uncertain regions`.

### Task 3: Unit belajar dan chunk dari blok yang sama

**Files:** Create `api/learning_content.py`, `tests/unit/test_learning_content.py`; modify `api/learning_service.py`, `api/material_service.py`, `api/material_concepts.py`, `rag/chunking.py`, `rag/ingestion.py`; extend `tests/unit/test_chunking.py`, `tests/unit/test_guided_learning.py`, `tests/unit/test_classroom_rag_context.py`.

**Interfaces:**
- Consume MaterialDocument dan projection Task 1, reviewed extraction Task 2.
- Produce `accepted_learning_blocks(document: MaterialDocument) -> list[MaterialBlock]`, `build_learning_units(document: MaterialDocument) -> list[LearningUnit]`, `chunk_material(document: MaterialDocument, *, source: str, content_version: int, mapping_version: int) -> list[Chunk]`.
- LearningUnit menyimpan block_ids, title, retrieval_text, speech_text, source spans, bukan hanya batas karakter teks. Empty accepted content memberi domain error `insufficient_learning_content`. Readiness membedakan published, extraction_review, index readiness, mapping pending; no mapping tidak memblokir material-only quiz, tetapi mastery tidak ditulis.
- Consume versioned unit manifest dari rencana progres: keluarkan unit_manifest_hash dan stable unit IDs, jangan menggabungkan coverage dari partition lama dengan partition baru pada content_version yang sama. Materi versi baru/manifest baru menampilkan progres terpisah sambil menyimpan riwayat.

- [ ] **Step 1: Tulis tes gagal** komentar demo114/title91 dari audit sebagai fixture sintetis, cover/TOC/answer-key-only, heading+contoh rumus pendek yang valid, tabel panjang harus membawa header, image-only dengan alt approved vs belum approved, dan legacy substantive tetap usable tanpa menyatakan human_reviewed.
- [ ] **Step 2: Jalankan merah**: `python -m pytest tests/unit/test_learning_content.py tests/unit/test_chunking.py tests/unit/test_guided_learning.py -q`.
- [ ] **Step 3: Implementasikan** pemilihan blok dan chunk bersama. Pertahankan provenance per blok/halaman serta hash/versi. Gunakan wrapper legacy untuk plaintext tanpa mengubah sumber aktif saat dibaca. Unit metadata-only menolak mulai quiz/check dengan pesan yang bisa ditindaklanjuti; tidak menghalangi membaca sumber asli. Materi draft tetap dapat disimpan ketika readiness AI belum lolos.
- [ ] **Step 4: Jalankan hijau** Step 2 dan classroom scope tests; assert tidak ada chunk excluded/needs_review, narasi dan retrieval berasal dari blok accepted yang sama, serta perubahan AST memicu indeks versi baru dan review mapping yang sesuai.
- [ ] **Step 4a: Verifikasi integrasi progres** manifest baru tidak salah menafsirkan completed unit indices lama; renderer materi memakai reading_completed dan learning_progress, tanpa memberi mastery gratis atau menampilkan persen statistik pada sesi.
- [ ] **Step 5: Commit** `fix: derive learning units and chunks from reviewed content`.

### Task 4: Editor bersama, preview PDF, dan renderer yang aksesibel

**Files:** Paths relatif `apps/web/` pada task ini. Create `src/components/material-rich-editor.tsx`, `src/components/material-renderer.tsx`, `src/components/material-source-review.tsx`, `src/lib/material-document-types.ts`, `src/lib/material-document-adapter.ts`, `src/styles/material-editor.css`, `src/app/api/classes/[classId]/material-assets/route.ts`, `src/app/api/classes/[classId]/material-assets/[assetId]/route.ts`, `tests/material-document.test.mjs`, `tests/material-editor.test.mjs`; modify `src/components/class-forms.tsx`, `src/components/admin-material-editor.tsx`, `src/app/class-actions.ts`, `src/lib/import-types.ts`, `src/lib/admin-material-types.ts`, `src/lib/material-proxy.ts`, `src/app/siswa/kelas/[id]/materi/[materialId]/page.tsx`, `src/app/guru/kelas/[id]/materi/[materialId]/page.tsx`, `package.json`, serta root `package-lock.json` workspace.

**Interfaces:** Consume AST/asset/import contracts Tasks 1–2. Produce `MaterialRichEditor({value: MaterialDocument, onChange, disabled})`, `MaterialRenderer({document: MaterialDocument})`, `toEditorJson(document): JSONContent`, `fromEditorJson(value): MaterialDocument`. Tiptap JSON hanya adapter UI, server AST tetap canonical; node IDs/provenance/review state bertahan pada round-trip. Review source memakai authorized original URL dan page/block anchors.

- [ ] **Step 1: Baca** AGENTS web dan Next docs relevan; pin dependency Tiptap yang kompatibel satu versi pada lockfile. Gunakan ekstensi terbuka paragraph/heading/list/bold/italic/sub/sup/math/table/image/undo; tidak menambah layanan editor cloud atau paid extension.
- [ ] **Step 2: Tulis tes gagal** save→reload sub/sup/inline dan display math, edit tabel mempertahankan header, gambar upload+alt wajib, dua editor memakai renderer/proyeksi sama, stale expected_version mendapat409 dengan draft lokal tetap tersimpan, unknown AST ditolak, paste HTML disanitasi, legacy round-trip tidak menggandakan komentar. Test keyboard/focus status dan teks narasi; tidak membacakan raw LaTeX.
- [ ] **Step 3: Jalankan merah**: `node --test tests/material-document.test.mjs tests/material-editor.test.mjs tests/material-import-route.test.mjs tests/material-proxy.test.mjs`.
- [ ] **Step 4: Implementasikan** client Tiptap `immediatelyRender=false` dan KaTeX trust=false; konversi document↔editor eksplisit. Toolbar ringkas UiText, shortcut/aria labels, responsive tanpa gesture wajib. Review PDF menunjukkan region needs_review, edit/exclude/accept dan draft/terbit/readiness AI terpisah. Gunakan endpoint aset terotorisasi, bukan blob/base64 tersimpan permanen. Halaman siswa memakai MaterialRenderer dan proyeksi speech dengan normalizer suara yang sudah ada.
- [ ] **Step 5: Verifikasi** Step 3, focused speech/navigation tests, `npm run typecheck`, `npm run lint`, `npm run build` di Docker. Komponen/HTTP assertions harus memeriksa data yang tersimpan dan dimuat ulang, bukan hanya keberadaan kata toolbar di source. Pengguna melakukan tes klik, screen reader, mobile dan baca rumus secara manual.
- [ ] **Step 6: Commit** `feat: add accessible rich material editing and source review`.

## Kriteria penutupan tahap

Draft baru dapat menyimpan rumus, sub/sup, tabel dan gambar lalu dibaca ulang tanpa kehilangan struktur. Halaman campuran uji tidak lagi diam-diam melewati tabel gambar, dan region yang belum terbaca ditandai. Materi lama tetap terbaca; metadata-only tidak menjadi unit soal. Tidak ada backfill produksi otomatis. Lanjut ke [grounding dan evaluasi agent](2026-10-20-grounded-question-orchestration.md).

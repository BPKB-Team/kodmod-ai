# Grounded Question Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Semua jalur soal menggunakan evidence materi kanonik, validasi semantik, dan trace yang membedakan masalah sumber, retrieval, generasi, serta alur interaksi.

**Architecture:** Satu façade retrieval menghasilkan source bundle terotorisasi dengan provenance dan versi. Generator privat menghasilkan soal beserta evidence dan verifier menolak ketidakcocokan; guided/conversational Tutor dan asesmen memakai generator serta kebijakan sesi yang sama. Evaluasi corpus dan canary mendahului backfill produksi.

**Tech Stack:** FastAPI, LangGraph, existing LLM gateway/provider usage, PostgreSQL/pgvector, optional Qdrant, pytest, Node, Docker, versioned prompt fixtures.

**Spec:** [Desain materi dan pembelajaran](../specs/2026-10-20-grounded-material-learning-design.md), terutama bagian 4–7.

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

1. Evidence berasal dari kelas lain, materi sudah ditarik, atau mapping kedaluwarsa — Tasks 1–2 menolak sebelum generasi/persist.
2. Soal valid JSON tetapi hanya mengulang judul atau mengandung salah kategori entitas — Task 2 negative fixtures.
3. Kegagalan provider/repair loop membuka soal generik tanpa sumber — Task 2 batas tiga generasi.
4. Satu giliran Tutor menciptakan dua kuis atau memakai penjelasan AI sebagai fakta tunggal — Task 3.
5. Trace/replay/backfill membocorkan answer key atau menggandakan mastery/versi — Tasks 3–4.

---

## Dependensi dan lingkungan

Implementasikan setelah [alur kuis](2026-10-20-learning-assessment-flow.md), [StudentModel/progres/poin](2026-10-20-student-progress-points.md), dan [dokumen materi](2026-10-20-material-document-pipeline.md). Source bundle mengonsumsi accepted blocks, policy v2 dan ScoreSummary; jangan membuat adapter sementara yang kembali mengizinkan metadata-only.

Seluruh commands pytest dari `apps/ai-engine` dalam container test; Node dari `apps/web` dalam Node Docker. Integration database/Qdrant memakai stack uji terpisah, bukan data 157 chunk aplikasi. Live local evaluation terpisah, bounded dan dilaporkan sebagai sampel. Corpus lengkap dan report berisi jawaban tetap ignored. Tidak ada tes klik UI oleh agent.

### Task 1: Façade retrieval, provenance, dan trace fallback yang benar

**Files:** Create `apps/ai-engine/rag/source_bundle.py`, `rag/retrieval_service.py`, `tests/unit/test_retrieval_service.py`; modify `rag/retriever.py`, `tools/rag_tool.py`, `rag/stores/qdrant_store.py`, `rag/stores/pgvector_store.py`, `graphs/state.py`; extend `tests/unit/test_qdrant_store.py`, `tests/unit/test_classroom_rag_context.py`.

**Interfaces:**
- Consume Task B3 accepted chunks with block IDs/spans/hash/versions.
- Produce `MaterialScope(student_id: UUID, class_id: UUID|None, material_id: UUID|None, concept_id: UUID|None, content_version: int|None, mapping_version: int|None)` di rag/source_bundle.py; `RetrievalRequest(query: str, scope: MaterialScope, candidate_k: int, final_k: int)` dan `retrieve_sources(request: RetrievalRequest) -> RetrievalResult`.
- RetrievalResult berisi QuestionSourceBundle dan RetrievalTrace. Bundle memuat SourceEvidence(id, material_id, chunk_id, block_ids, spans, text, content_version, mapping_version, document_hash, approved_concept_ids). Trace: candidate_count, hydrated_count, returned_count, fallback_reason, backend, latency.
- Candidate defaults sama untuk kedua façade: settings.RAG_TOP_K/settings.RAG_RERANK_TOP_K; generator dapat meminta final_k=6 tanpa mengganti otorisasi. Unit langsung menggunakan `bundle_from_unit(unit: LearningUnit, scope: MaterialScope) -> QuestionSourceBundle` dengan guard yang sama.

- [x] **Step 1: Tulis tes gagal** RAGTool dan retriever memakai filter/budget sama; 7 authorized chunks dengan request20 tidak berarti data hilang; hydration tidak dicatat fallback; stale/unavailable dan insufficient_authorized mencatat alasan benar; enrollment dicabut/published false/material version lama tidak terhidrasi; block/page provenance tidak hilang di RetrievedDoc.
- [x] **Step 2: Jalankan merah**: `python -m pytest tests/unit/test_retrieval_service.py tests/unit/test_qdrant_store.py tests/unit/test_classroom_rag_context.py -q`.
- [x] **Step 3: Implementasikan** retrieval_service sebagai satu orchestration layer. Qdrant tetap tidak menyimpan teks kanonik; SQL melakukan hydration+permission+freshness. Bandingkan ketersediaan terotorisasi dengan budget efektif untuk menghindari fallback hanya karena corpus kecil. Untuk scope konsep tanpa material, pertahankan filter subject/concept yang ada; text topic bukan UUID tidak boleh diam-diam menjadi pencarian semua materi kelas.
- [x] **Step 4: Verifikasi** Step 2 serta integration scope dengan PG/Qdrant test stack. Assert expected source blocks ditemukan pada query fixture, bukan hanya returned_count>0. Docker memakai `RAG_RERANK_ENABLED=false` dan tidak memiliki `sentence-transformers`/cache model; tidak mengunduh model 2 GB demi tes. Keputusan rerank tetap off dan pembandingan kualitas nyata ditunda ke golden corpus Task 4.
- [x] **Step 5: Commit** `refactor: unify authorized retrieval and source provenance` (`1ac0035`).

### Task 2: Generator dengan evidence dan pemeriksaan semantik

**Files:** Create `agents/question_quality.py`, `models/grounded_question.py`, `tests/unit/test_question_evidence.py`; modify `agents/problem_generator.py`, `tools/quiz_generator_tool.py`, `prompts/quiz_generator.md`, `api/routes/editorial_quizzes.py`; extend `tests/unit/test_quiz_quality.py`, `tests/contract/test_editorial_quiz_schemas.py`.

**Interfaces:**
- Consume QuestionSourceBundle Task 1.
- Produce `generate_grounded_questions(bundle: QuestionSourceBundle, *, count: int, difficulty: str, language: str, only_mcq: bool=False) -> GroundedQuestionBatch` dan `verify_question(question: GroundedQuestion, bundle: QuestionSourceBundle) -> QuestionQualityDecision`.
- Private GroundedQuestion: text/type/options/expected_answer/rubric/explanation/evidence_refs/objective/cognitive_level. Evidence refs hanya ID dalam bundle, menunjuk excerpt yang mendukung answer; tidak menerima ID buatan model.
- QualityDecision: accept/reject dengan reasons no_learning_content|generic_title|unsupported_answer|entity_mismatch|unreadable_formula|duplicate|insufficient_depth. Domain errors insufficient_learning_content/source_quality_failed di-mapping ke409 dengan teacher action; endpoint tidak mengirim raw model response atau answer key pada error.

- [x] **Step 1: Tulis tes gagal** screenshot “Jelaskan topik yang ditunjukkan oleh judul modul tersebut”, judul+metadata sebagai semua evidence, Ceres disebut sebagai salah satu delapan planet, kutipan dari sumber tak dikenal, rumus yang kehilangan pangkat, dan gambar tanpa alt approved. Positif: soal menerapkan a^p*a^q=a^{p+q} dan penamaan ion berdasarkan evidence yang benar. Batch tiga soal berisi minimal satu penerapan/penalaran bila sumber memadai, tanpa memaksa sumber tipis membuat soal lebih banyak.
- [x] **Step 2: Jalankan merah**: `python -m pytest tests/unit/test_question_evidence.py tests/unit/test_quiz_quality.py tests/contract/test_editorial_quiz_schemas.py -q`.
- [x] **Step 3: Implementasikan** deterministic validation dahulu, semantic verifier melalui existing quiz/scoring gateway dengan JSON schema dan source-only instruction berikutnya. Gunakan satu prompt generator yang benar-benar dimuat, tambahkan prompt_version/hash dan tes bahwa perubahan file dipakai aktif. Maksimum tiga generation calls total, masing-masing satu bounded verification; alasan reject menjadi masukan repair. Setelah gagal, abstain dengan error kualitas; jangan mengembalikan template generik. Semantik verifier bukan sumber fakta eksternal dan tidak menganggap nilai confidence sebagai bukti.
- [x] **Step 4: Verifikasi** Step 2 dan provider-mocked tests untuk timeout/malformed output, generated prompt injection, biaya/usage terhitung, dan call limit. Legacy editorial generation menggunakan validator baru tetapi aturan rilis pembahasannya tetap; payload siswa tidak berisi answer/rubric/explanation sebelum waktunya. Docker: 163 unit/contract passed (`-m 'not known_bug'`), 11 PostgreSQL progress-plan integration passed, Ruff check/format clean pada 22 file Python berubah.
- [x] **Step 5: Commit** `fix: require source evidence and semantic checks for quiz generation` (commit setelah ledger dan working tree diperiksa).

### Task 3: Satu jalur mini kuis dan instrumentasi main flow

**Files:** Create `api/quiz_session_factory.py`, `tools/learning_trace.py`, `tests/unit/test_learning_trace.py`, `tests/unit/test_quiz_orchestration.py`; modify `agents/quiz_agent.py`, `graphs/main_graph.py`, `graphs/guided_learning.py`, `graphs/state.py`, `api/learning_service.py`, `api/assessment_service.py`, `api/routes/admin_insights.py`, `tools/provider_usage.py`; extend `tests/unit/test_mini_quiz_scope.py`, `tests/unit/test_guided_learning.py`; modify `apps/web/src/lib/admin-insights-types.ts` and `apps/web/src/components/admin-ai-monitor.tsx` untuk menampilkan detail diagnostik memakai desain yang sudah ada.

**Interfaces:**
- Consume Task 2 generator, rencana alur kuis policy/outcome services, serta ScoreSummary dan presentation_context dari rencana progres/poin. Conversational mini kuis yang mapped harus memiliki durable evidence sama seperti REST; unmapped/assisted tetap tanpa mastery palsu.
- Produce `create_quiz_session_from_questions(db: AsyncSession, student: User, batch: GroundedQuestionBatch, *, scope: MaterialScope, mode: Literal['tutor','assessment']) -> QuizStartResponse`. Shared persistence factory tidak memanggil graph/generator kembali; semua pemanggil membuat bundle/batch sebelum factory, menghindari graph→service→graph recursion.
- Produce `async record_learning_trace(event: LearningTraceEvent) -> None` dengan correlation IDs, node, policy/prompt/extractor version, source IDs, quality reasons, fallback reason, model call count/latency/cost bila tersedia. Simpan metadata allowlisted melalui api/audit_service.record_audit, category=learning, di short-lived session terpisah mengikuti pola provider_usage agar kegagalan transaksi kuis tetap bisa ditelusuri. Maksimum payload 16 KiB dan 12 stage events per request; kegagalan pencatatan best-effort memiliki counter, tidak mengubah nilai/transisi sesi. Default tidak mencatat full prompt, jawaban siswa, atau kunci. Admin membaca AuditEvent dan ProviderUsage lewat request ID dengan pagination/hak akses yang ada.

- [ ] **Step 1: Tulis tes gagal** conversational mini quiz tetap grounded ketika last_explanation berisi fakta yang tak ada pada accepted sources; explicit quiz action dan teach prompt tidak menghasilkan dua pertanyaan; Tutor guided/percakapan dan mandiri memakai policy yang sesuai. Restart/recovery mini kuis memakai QuizSession UUID kanonik, bukan ID sementara yang tidak tersimpan. Source berubah sebelum persist ->409.
- [ ] **Step 2: Jalankan merah**: `python -m pytest tests/unit/test_quiz_orchestration.py tests/unit/test_mini_quiz_scope.py tests/unit/test_guided_learning.py tests/unit/test_learning_trace.py -q`.
- [ ] **Step 3: Implementasikan** shared factory dan sambungkan kedua mini-quiz paths. Last explanation hanya konteks pedagogis. Planner hanya memilih penjelasan/strategi; aksi eksplisit dan state machine menentukan kuis, hint, skip, dan lanjut. Cegah duplicate scheduling memakai session turn/action IDs yang sudah diterima. Hapus/ubah instruksi teach yang selalu membuat comprehension question saat quiz node telah dipilih.
- [ ] **Step 4: Implementasikan dan uji trace** untuk import/unit/retrieval/generation/verification/scoring/hint/advance. Admin dapat membedakan metadata-only, source unavailable, semantic reject dan provider failure. Snapshot response siswa, exported logs, dan non-admin request harus bebas kunci/API key/raw private prompt. Ringkasan sesi conversational memakai poin/count, tanpa persen statistik, dan mapped evidence memperbarui Progres satu kali. Jalankan Step 2, admin contract tests, dan web typecheck bila types/monitor berubah.
- [ ] **Step 5: Commit** `refactor: share grounded quiz flow and learning diagnostics`.

### Task 4: Golden corpus, backfill preview, dan canary lokal

**Files:** Create `apps/ai-engine/tests/fixtures/material_grounding/manifest.json`, `tests/integration/test_material_grounding.py`, `scripts/evaluate_material_grounding.py`, `scripts/preview_material_backfill.py`, `docs/testplan/material-grounding.md`; extend `tests/unit/test_material_pipeline.py`. Private downloaded files/reports tetap di `.runtime/` atau persistent uploads.

**Interfaces:**
- Manifest mencatat URL/hash/physical ranges audit, synthetic fixture keys, expected block/evidence IDs, table/math expectations dan known source factual issues; tidak menyimpan seluruh buku atau credential.
- `python -m scripts.evaluate_material_grounding --manifest <path> --mode fixture|live-local --output <ignored-report>` menghasilkan extraction/recall/question-quality/flow/privacy metrics terpisah. live-local dibatasi tiga batch × tiga soal, lalu berhenti; jangan membuat load test berbayar.
- `python -m scripts.preview_material_backfill --class-id <uuid> --material-id <uuid> --output <ignored-report>` hanya membuat draft candidate+diff berdasarkan original, tidak mengganti published revision. Apply produksi memerlukan tahap rilis terpisah dengan backup+review, di luar audit ini.

- [ ] **Step 1: Tetapkan golden expectations manusia** pada tiga dokumen lokal: matematika fisik10, kimia13, IPA19/22 serta query substantif. Tandai kesalahan fakta orbit Merkurius sebagai issue sumber yang harus direview, bukan jawaban yang dibenarkan hanya karena ada pada PDF. Buat fixtures sintetis ekuivalen untuk CI tanpa hak distribusi buku.
- [ ] **Step 2: Jalankan fixture evaluation merah** sebelum perbaikan; assert metadata-only rejected, exact sub/sup and table preservation, expected evidence present, no cross-class leak, dan retry/next outcomes sesuai policy. `python -m pytest tests/integration/test_material_grounding.py -q`; jangan menandai skip sebagai lulus.
- [ ] **Step 3: Implementasikan** evaluator dan preview backfill yang idempoten, versioned dan read-preserving. Simpan draft baru tanpa menyentuh sesi aktif. Dokumen lama tanpa original melaporkan source_unavailable, tidak menebak struktur dari plaintext. Materi unmapped memberi skor tanpa mastery. Review manusia harus membedakan extraction fidelity dari factual correctness.
- [ ] **Step 4: Jalankan seluruh suite terdampak di Docker**: policy/transaction/recovery, import/OCR/document/chunk/scope/Qdrant, question/evidence/orchestration/trace, web contract/editor/quiz/voice/navigation serta lint/typecheck/build. Kemudian evaluasi live-local terbatas pada kelas [UJI PDF] yang sudah ada; laporkan model/prompt/source versions dan hasil nyata, bukan sekadar container healthy.
- [ ] **Step 5: Susun laporan canary dan rollback**: seluruh expected fixture evidence ditemukan; nol unauthorized/answer leak; tidak ada forced retry mandiri; satu outcome/mastery maksimum; unresolved region/fakta tetap review-required. Backup dan migrasi diuji hanya pada dedicated DB; tidak ada reindex/drop volume/publish produksi otomatis. Catat daftar klik/screen reader/mobile yang akan diuji pengguna.
- [ ] **Step 6: Commit** `test: add material grounding corpus and rollout evaluation` setelah hasil di-review; push/merge/deploy mengikuti instruksi pengguna saat eksekusi.

## Kriteria penutupan keseluruhan

Ketiga rencana memenuhi desain jika sumber substantif tersimpan dan bisa ditelusuri, soal benar-benar bergantung pada sumber accepted, dan alur beda mode terbukti di transaksi/HTTP serta UI contracts. “Vector healthy”, “JSON valid”, dan baseline tests lulus tidak dipakai sendiri sebagai bukti kualitas soal atau kesiapan produksi.

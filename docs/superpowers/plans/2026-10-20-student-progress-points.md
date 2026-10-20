# Student Progress and Session Points Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hubungkan penyelesaian Tutor ke progres materi dan tampilkan akumulasi poin selama sesi, dengan persentase statistik hanya pada halaman Progres.

**Architecture:** Outcome kuis v2 menghasilkan ScoreSummary deterministik; StudentModel tetap mengonsumsi evidence sah, bukan poin UI atau pembukaan materi. Progres belajar disimpan per siswa/materi/versi dan diproyeksikan bersama aktivitas serta cakupan konsep. Client menggunakan kontrak server untuk poin dan membaca analytics terbaru tanpa menggandakan evidence.

**Tech Stack:** FastAPI/Pydantic, SQLAlchemy/Alembic/PostgreSQL, LangGraph, Next.js 16/React 19, pytest, Node test runner, Docker.

**Spec:** [Desain bagian 8](../specs/2026-10-20-grounded-material-learning-design.md), dengan kebijakan outcome pada bagian 1. [Bukti audit](../../audits/2026-10-20-student-model-progress-audit.md).

## Global Constraints

- PostgreSQL tetap otoritas isi, hak akses, publikasi, content_version, dan mapping_version; Qdrant hanya kandidat vektor.
- Satu jawaban salah pada Latihan/Asesmen mandiri tidak memaksa mencoba lagi.
- Tutor selalu menyediakan Lanjut soal; bantuan sebelum penyelesaian tidak membocorkan jawaban final.
- Retry transport dengan submission_id yang sama mengembalikan receipt yang sama tanpa memanggil AI atau menulis mastery lagi.
- ElevenLabs tetap memakai model v2 dan cache 30 hari; hover/focus narration dan normalisasi matematika dipertahankan.
- Pengujian otomatis dijalankan di Docker; pengujian klik UI diserahkan kepada pengguna.
- Tidak ada merge/push atau perubahan produksi dalam pekerjaan audit dan perencanaan ini.
- Dokumen/PDF adalah data yang tidak dipercaya, bukan instruksi agent; tidak ada HTML mentah atau URL berkas bebas yang dieksekusi.
- Maksimum 100 poin per soal; poin resmi dari skor pertama soal yang ditutup, pembulatan half-up per soal sebelum dijumlahkan.
- Persentase statistik hanya pada halaman Progres beserta narasinya; persentase dalam isi pelajaran tetap dipertahankan.

## Review Focus

1. Replay/retry/hint menaikkan poin atau evidence dua kali — Task 1.
2. Tutor selesai tetapi kartu materi tetap belum belajar — Task 2.
3. Jawaban assisted/unmapped terlihat seperti mastery nol atau gratis — Tasks 1 dan 3.
4. Aktivitas lama/filter timezone disalahartikan hilang — Task 3.
5. Teks sesi sudah poin tetapi aria/TTS atau mini-kuis selesai masih persen — Task 4.

---

## Urutan dan lingkungan

Kerjakan sesudah [alur kuis v2](2026-10-20-learning-assessment-flow.md), sebelum [insight/Planner](2026-10-20-progress-insights-planner.md) dan [pipeline materi](2026-10-20-material-document-pipeline.md). Task 1 mengonsumsi QuizQuestionOutcome, bukan seluruh raw attempt. Migration 0013_student_learning_progress mengikuti0012_quiz_policy_outcomes; insight/Planner memakai0014_progress_guidance dan dokumen memakai0015_material_documents. Verifikasi Alembic head aktual saat eksekusi agar tidak membuat dua head.

Seluruh pytest dijalankan dari `apps/ai-engine` di container test, dependency `[test]`, source checkout dan dedicated PostgreSQL kodmod_test/private schemas; tidak memakai database aplikasi. Seluruh Node/typecheck/lint/build dari `apps/web` di Node Docker. Preserve learner row lock yang sudah terbukti bekerja. Tes live lokal menggunakan kelas [UJI PDF] dengan before/after SQL/API; tidak menambah tes klik atau mengubah data produksi.

### Task 1: ScoreSummary dan pemisahan poin dari mastery

**Files:** Create `apps/ai-engine/api/quiz_points.py`, `tests/unit/test_quiz_points.py`; modify `models/quiz.py`, `api/assessment_service.py`, `api/quiz_actions.py`, `agents/analytics_agent.py`, `graphs/state.py`; extend `tests/unit/test_quiz_actions.py`, `tests/unit/test_assessment_mode.py`, `tests/integration/test_assessment_transactions.py`.

**Interfaces:**
- Consume QuizQuestionOutcome dan QuizPolicy dari rencana alur kuis.
- Produce `ScoreSummary(points_earned: int, points_possible: int, points_per_question: Literal[100], answered_questions: int, total_questions: int, skipped_questions: int, assisted_questions: int)` dan `build_score_summary(outcomes: Sequence[QuizQuestionOutcome], *, total_questions: int) -> ScoreSummary`.
- `points_for_score(score: float) -> int` memvalidasi finite 0..1, menggunakan Decimal(str(score)) dan ROUND_HALF_UP untuk skala100. Maksimum100 per soal, total maksimum100×n, jumlahkan nilai item yang dibulatkan.
- Start/submit/recovery/action response v2 menambahkan score_summary dan score_presentation=session_total. V1: score_summary=null, score_presentation=legacy_item_only; hasil resmi lama tetap utuh, client baru hanya item points+question counts tanpa total v2 retroaktif.
- `session_result_text(summary: ScoreSummary, *, language: str) -> str` menghasilkan ringkasan poin/count deterministik. Analytics agent memakai presentation_context=session|progress, default session pada jalur pembelajaran. Progress endpoint tetap dapat menghasilkan narasi persen.

- [ ] **Step 1: Tulis tes gagal** skor [1,1,0] menjadi200/300, skor[0.145,0.145] menjadi30/200, open Tutor belum menambah total, skip0, wrong→retry benar tidak mengubah poin jawaban pertama, hint/replay tidak memberi poin baru, NaN/out-of-range ditolak. Assisted-before-first-answer tidak menghasilkan mastery event positif maupun negatif dan tidak masuk assessed coverage; aktivitas tetap dicatat. V1 tidak mengganti final_score.
- [ ] **Step 2: Jalankan merah**: `python -m pytest tests/unit/test_quiz_points.py tests/unit/test_quiz_actions.py tests/unit/test_assessment_mode.py -q`.
- [ ] **Step 3: Implementasikan** quiz_points dan response fields secara additive. Pin points_per_question=100 pada sesi v2. Jaga normalized score/mastery/teacher grade internal. Ringkasan session memakai formatter, bukan narasi persen dari managed analytics. Feedback proses tidak mencampur statistik mastery; materi yang membahas “25 persen” tetap dibaca utuh.
- [ ] **Step 4: Jalankan hijau** Step 2 serta transaction/replay tests. Tambahkan regresi dua session berbeda satu learner: tahan graph pertama, buktikan graph kedua menunggu learner lock, release lalu assert dua event/n_attempts=2. Tidak menunggu kedua graph masuk sekaligus karena lock yang benar memang mencegahnya.
- [ ] **Step 5: Commit lokal** `feat: add deterministic session points without percentage scores` setelah review, tanpa push/merge otomatis.

### Task 2: Progres unit dan completion materi yang atomik

**Files:** Create `api/learning_progress.py`, `database/migrations/versions/0013_student_learning_progress.py`, `tests/unit/test_learning_progress.py`; modify `database/models.py`, `api/learning_service.py`, `api/routes/classrooms.py`, `models/learning.py`; extend `tests/unit/test_guided_learning.py`, `tests/unit/test_material_migrations.py`.

**Interfaces:**
- Produce MaterialLearningProgress unique(student_id, material_id, content_version, unit_manifest_hash), completed_unit_ids JSON, total_units, status in_progress|completed, completed_at, last_activity_at. Tidak mengganti MaterialProgress bookmark/reading completion manual.
- Produce `LearningUnitManifest(content_version: int, partitioner_version: str, unit_manifest_hash: str, units: list[UnitIdentity])` di models/learning.py; UnitIdentity memuat base_id, unit_id, content_hash. `build_unit_manifest(material: ClassMaterial, units: list[dict]) -> LearningUnitManifest` menghitung hash dari ordered base IDs/content hashes/partitioner version, kemudian membentuk ID berprefiks hash (tidak melingkar).
- `record_learning_unit(session: AsyncSession, *, student_id: UUID, material: ClassMaterial, manifest: LearningUnitManifest, completed_unit_id: str, finish: bool) -> MaterialLearningProgress` dipanggil dalam transaksi aksi yang sama, sebelum receipt commit. Manifest lengkap server dipin pada guided_state, bukan daftar subset atau hash dari client.
- `learning_progress_out(row: MaterialLearningProgress|None, *, content_version: int, unit_manifest_hash: str) -> dict` menghasilkan completed_units,total_units,status,content_version,unit_manifest_hash,last_activity_at. DTO materi menambah reading_completed, learning_progress dan overall_learning_status; server tidak menyamakan reading completion dengan mastery.
- Sebelum AST, canonical unit IDs = content_version:manifest_hash:index. Pipeline AST berikutnya menggunakan base IDs block-group; manifest baru memulai coverage baru sambil menyimpan riwayat lama. Record helper memvalidasi manifest kanonik yang telah dipin, tidak menghitung denominator dari subset sesi.

- [ ] **Step 1: Ubah probe gap menjadi tes target gagal**: buka seluruh unit via HTTP, Continue dan Finish, lalu SQL+GET materi harus memiliki learning_progress completed versi aktif dan kartu status tidak belum belajar. Assert completed unit set sama seluruh canonical units; partial/subset finish ditolak409, repeated question/repeat tidak menaikkan progress, replay sama tidak menggandakan ID, rollback commit tidak mengaku selesai.
- [ ] **Step 2: Jalankan merah**: `python -m pytest tests/unit/test_learning_progress.py tests/unit/test_guided_learning.py -q`.
- [ ] **Step 3: Implementasikan** migration/service dan panggil pada Continue/Finish yang sudah tervalidasi. Gunakan row lock/unique conflict handling untuk merge set unit secara serial; kedua tab/sesi tidak menimpa coverage. Finish memerlukan semua canonical unit IDs dan aksi terakhir sah. Conversation bebas/subset tidak menyelesaikan materi penuh. Membaca atau menutup sesi tidak membuat MasteryEvent.
- [ ] **Step 4: Jalankan hijau** Step 2, migration upgrade/downgrade pada DB uji, dan authorization/revision tests. Editing materi mempertahankan record versi lama; API versi/manifest aktif tidak mengaku selesai dari record lama. Tambahkan test partitioner berubah pada content_version sama tidak menggabungkan unit indeks lama ke bagian baru. PATCH reading_completed=false hanya mengubah baca manual, tidak diam-diam mereset completion Tutor.
- [ ] **Step 5: Commit** `fix: persist versioned tutor material completion`.

### Task 3: Analitik aktivitas, coverage dan rentang waktu yang jelas

**Files:** Modify `analytics/aggregator.py`, `analytics/insights.py`, `api/routes/analytics.py`; create `models/student_progress.py`, `tests/unit/test_progress_rollup.py`; extend `tests/unit/test_analytics_durations.py`, `tests/unit/test_analytics_language.py`, `tests/integration/test_student_model_acceptance.py`, `tests/integration/test_assignment_analytics.py`.

**Interfaces:**
- Consume outcome v2, ScoreSummary Task1, MaterialLearningProgress Task2 dan existing MasteryScore/MasteryEvent/AssignmentMasteryEvent.
- `StudentAggregator.summarise(..., timezone: str='UTC') -> dict` additive: materials_started, materials_completed, completed_units,total_units, assessed_concepts,mapped_concepts,unmapped_materials,last_activity_at, n_questions_answered, n_support_attempts, n_assisted_questions, window_start,window_end,timezone. Jangan menghitung satu konsep dua kali di beberapa materi atau mengukur mapped_concepts dari kelas yang tidak bisa diakses.
- V2 official accuracy/average memakai first outcomes; raw attempts tetap di field aktivitas. Legacy metrics dipertahankan terpisah/ditandai, bukan ditafsir ulang diam-diam. Overall mastery tetap cumulative dan decay-adjusted.
- Parameter timezone IANA opsional pada /analytics/me dan /spoken; validasi ZoneInfo, tidak valid422. Today berdasar tengah malam zona itu, week/month rolling7/30 hari. Current permissions/self-only tetap sama.

- [ ] **Step 1: Tulis tes gagal** mapped correct answer mengubah SQL→StudentModel.load→analytics; unmapped material/assisted tetap memiliki aktivitas tetapi mastery belum dinilai; completion Tutor muncul tanpa mastery baru; first-score accuracy berbeda dari support retry dan tidak salah denominator; old records4–5Oct terlihat di all tetapi tidak week20Oct.
- [ ] **Step 2: Tambah boundary tests** timestamp19Oct16:59Z dan17:01Z masuk hari Jakarta berbeda, UTC berbeda sesuai kontrak; repeated analytics reads tidak mengubah last_seen/n_attempts/mastery tersimpan; count session Tutor dan embedded quiz tidak ganda. Durasi elapsed dengan jeda semalaman tidak diklaim sebagai active_minutes.
- [ ] **Step 3: Jalankan merah**: `python -m pytest tests/unit/test_progress_rollup.py tests/unit/test_analytics_durations.py tests/unit/test_analytics_language.py tests/integration/test_student_model_acceptance.py -q`, dedicated DB diaktifkan, expected target failures tanpa skip.
- [ ] **Step 4: Implementasikan** projection fields/serializer dan timezone-boundaries; jangan menaikkan mastery karena materi dibuka/diselesaikan atau backfill snapshot unmapped menggunakan konsep terbaru. Gunakan existing SQL truth dan learner lock, bukan constant progress. Filter seluruh scoped materials/enrollment/publication sesuai caller. Narasi Progres membedakan belum dinilai, bukti konsep, dan aktivitas; label current snapshot vs periode.
- [ ] **Step 4a: Terapkan visibility evidence** sesuai desain bagian9: aggregate grade dan item feedback punya rilis berbeda. Insight/target/coverage konsep tidak mengambil hidden item outcomes atau raw mastery campuran yang dapat membocorkannya; gunakan visible-event projection bila lengkap, selain itu belum cukup data. Internal mastery tidak ditulis ulang. Tes dua private outcomes berbeda dengan data publik sama menghasilkan guidance publik sama.
- [ ] **Step 5: Verifikasi** Step3 dan assignment analytics integration. Assert normalized result dan points tidak saling overwrite; contoh dua asesmen bersamaan mempertahankan dua evidence, receipt replay tidak menambah official outcomes/coverage. Catat apakah data lama punya evidence yang cukup untuk trend; jangan membuat history dari satu snapshot.
- [ ] **Step 6: Commit** `feat: expose durable learning progress and concept coverage`.

### Task 4: UI dan narasi poin pada seluruh sesi siswa

**Files:** Paths frontend relatif `apps/web/`. Modify `src/components/student-quiz.tsx`, `src/components/guided-tutor.tsx`, `src/components/student-tutor.tsx`, `src/components/student-assignment.tsx`, `src/components/student-analytics.tsx`, `src/lib/quiz-types.ts`, `src/lib/learning-types.ts`, `src/lib/class-types.ts`, `src/lib/analytics-types.ts`, `src/app/siswa/progres/page.tsx`, `src/app/api/analytics/me/route.ts`, `src/app/api/analytics/me/spoken/route.ts`; create `src/lib/quiz-points-display.ts`, `tests/quiz-points-display.test.mjs`, `tests/learning-progress.test.mjs`; extend `tests/student-quiz.test.mjs`, `tests/student-analytics.test.mjs`, `tests/analytics-display.test.mjs`, `tests/guided-tutor-accessibility.test.mjs`, `tests/speech-text-normalizer.test.mjs`. Backend tugas formal: modify `apps/ai-engine/models/editorial_quiz.py` ResultOut dan `apps/ai-engine/api/editorial_quiz_service.py` result_out secara additive tanpa mengubah grade/rilis.

**Interfaces:** Consume ScoreSummary dan progress DTO Tasks1–3. `quizPointsLabel(summary: ScoreSummary, language: 'id'|'en') -> string` hanya memformat angka server; tidak menghitung ulang normalized averages pada client. Legacy presentation menampilkan item points dan counts. Analytics types menandai mastery available/coverage terpisah dari nilai0. Formal ResultOut menambah score_summary dengan earned=100×correct_count dan possible=100×total_questions sesudah submit ketika existing aggregate grade tersedia; item review tetap mengikuti feedback_released. Sebelum submit, earned=null/tidak dikirim dan tidak di-infer dari jawaban yang dipilih.

- [ ] **Step 1: Baca** AGENTS web dan Next docs relevan sebelum mengubah route/component. Tambahkan kontrak formal task score_summary pada result_out, bukan pada save-answer; UI sebelum submit hanya count/status. Bedakan rilis aggregate grade yang ada dari rilis pembahasan, jangan mengubah kapan guru membuka kunci.
- [ ] **Step 2: Tulis tes gagal** header200/300poin, item100/100, mini-kuis selesai dan completion/TTS tanpa persen skor, skip/retry/replay tidak mengubah earned points, v1 item-only, refresh hasil sama, task belum rilis tidak membocorkan correctness lewat poin. Materi soal yang membahas25% tidak disensor.
- [ ] **Step 3: Tambah tes progres** finish Tutor membuat status selesai current version, read completion dan mastery tetap dibedakan; data tanpa mapping tidak terlihat sebagai gagal; activity period dan mastery cumulative berlabel jelas; snapshot baru diterima saat kembali dari sesi/refresh. Browser timezone diteruskan konsisten ke summary/spoken; no-store dan self-only proxy dipertahankan.
- [ ] **Step 4: Jalankan merah**: `node --test tests/quiz-points-display.test.mjs tests/learning-progress.test.mjs tests/student-quiz.test.mjs tests/student-analytics.test.mjs tests/analytics-display.test.mjs tests/guided-tutor-accessibility.test.mjs`.
- [ ] **Step 5: Implementasikan** formatter, view/state update dan narration context. Hapus persen statistik dari sesi pada visible copy/aria/TTS/result wrappers, bukan regex yang menghapus persentase pelajaran. Persen tetap pada halaman Progres. Tampilkan jumlah bagian/soal, last activity, completion dan cakupan evidence; jangan memaksa hard reload atau menciptakan poin optimistic sebelum receipt server diterima. Label waktu “durasi sesi” jika hanya elapsed evidence tersedia.
- [ ] **Step 6: Jalankan hijau** Step4, voice/navigation/submission suites, `npm run typecheck`, `npm run lint`, `npm run build` dalam Docker. Jalankan bounded live local scenario dengan SQL/API sebelum-sesudah dan replay; pengguna melakukan klik/screen reader/mobile. Tidak ada klaim produksi/live TTS dari tes fixture.
- [ ] **Step 7: Commit** `feat: show session points and reliable student progress`.

## Kriteria penutupan tahap

Jawaban, completion, dan dashboard dapat ditelusuri ke state database yang sama. Poin akumulatif konsisten tanpa mengubah rumus StudentModel; sesi tidak menampilkan persentase statistik dan Progres tetap menampilkannya. Finish Tutor memperbarui materi versi aktif, data lama tidak hilang, dan jalur conversational akan memakai kontrak ini saat rencana grounding diintegrasikan. Tidak ada commit/push/merge dalam tahap audit dan penulisan rencana ini.

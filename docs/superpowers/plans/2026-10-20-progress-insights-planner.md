# Progress Insights and Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Halaman Progres memberikan insight yang dapat diperiksa, satu fokus belajar, dan rencana singkat yang langsung dapat dijalankan serta dievaluasi dari aktivitas nyata.

**Architecture:** Analytics menghasilkan fakta dan kandidat berizin; Planner memilih satu tujuan dan maksimum tiga langkah melalui satu panggilan model yang dibatasi; Recommendation merender alasan/aksi dari rencana tervalidasi. Rencana dan statusnya tersimpan, diperbarui melalui job sesudah transaksi belajar committed, dan menggunakan fallback deterministik jika AI tidak tersedia.

**Tech Stack:** FastAPI/Pydantic, SQLAlchemy/PostgreSQL/Alembic, LangGraph, existing recommendation LLM gateway, existing durable SQL jobs, Next.js 16/React 19, pytest, Node, Docker.

**Spec:** [Desain bagian 9](../specs/2026-10-20-grounded-material-learning-design.md), bersama kebijakan evidence/rilis pada bagian 1 dan progres/poin pada bagian 8.

## Global Constraints

- PostgreSQL tetap otoritas isi, hak akses, publikasi, content_version, dan mapping_version; Qdrant hanya kandidat vektor.
- Retry transport dengan submission_id yang sama mengembalikan receipt yang sama tanpa memanggil AI atau menulis mastery lagi.
- ElevenLabs tetap memakai model v2 dan cache 30 hari; hover/focus narration dan normalisasi matematika dipertahankan.
- Pengujian otomatis dijalankan di Docker; pengujian klik UI diserahkan kepada pengguna.
- Tidak ada merge/push atau perubahan produksi dalam pekerjaan audit dan perencanaan ini.
- Persentase statistik hanya pada halaman Progres beserta narasinya; persentase dalam isi pelajaran tetap dipertahankan.
- Planner menghasilkan satu fokus dan maksimum tiga langkah; tidak membuat target, angka, URL, prasyarat atau diagnosis baru di luar kandidat/fakta yang berizin.
- Satu panggilan get_recommendation_llm maksimum 10 detik per snapshot/cycle, tanpa retry berbayar otomatis; Recommendation pada jalur ini tidak memanggil AI kedua kali.

## Review Focus

1. Rencana terlihat personal tetapi berasal dari satu jawaban atau data tanpa mapping — Task 1.
2. Fokus/alasan mengungkap hasil item tugas yang pembahasannya belum dirilis — Tasks 1–3.
3. Dua tab/refresh berulang membuat banyak rencana/panggilan model — Tasks 2–3.
4. Materi diubah/ditarik setelah saran dibuat tetapi CTA masih dapat memulai — Task 3.
5. Tombol Mulai dianggap selesai atau rencana hilang setelah restart — Tasks 3–4.

---

## Dasar kode dan urutan

Di checkout saat audit, graph aktif memakai analytics → recommendation → accessibility; belum ditemukan node Planner tersendiri. recommendation_node menghasilkan structured_recommendations dalam state, sementara StudentAggregator membaca Recommendation SQL. Helper store_recommendation belum ditemukan dipanggil oleh jalur node produksi. Implementasi harus menghubungkan output tervalidasi dengan persistence dan target aksi, bukan hanya menambah kartu statis.

Kerjakan setelah [alur kuis](2026-10-20-learning-assessment-flow.md) dan [progres/poin](2026-10-20-student-progress-points.md). MVP dapat memakai unit manifest yang sudah ada sebelum PDF terstruktur; [pipeline materi](2026-10-20-material-document-pipeline.md) kemudian memberi block IDs/provenance lebih baik. Reserve migration 0014_progress_guidance setelah0013_student_learning_progress; dokumen materi menjadi0015_material_documents. Periksa ulang Alembic head saat eksekusi.

Semua pytest dijalankan dari apps/ai-engine pada Docker test dengan dedicated PostgreSQL/private schemas, provider dimock kecuali evaluasi live yang dinyatakan. Node/lint/typecheck/build dari apps/web pada Docker. Tidak membuat reminder, kalender, leaderboard, provider baru, atau mengubah rilis tugas guru.

### Task 1: Snapshot fakta, coverage, dan kandidat rencana yang sah

**Files:** Create `apps/ai-engine/models/progress_guidance.py`, `analytics/progress_guidance.py`, `tests/unit/test_progress_guidance.py`; modify `analytics/aggregator.py`; extend `tests/integration/test_assignment_analytics.py`, `tests/unit/test_progress_rollup.py` dari rencana progres.

**Interfaces:**
- `build_guidance_snapshot(session: AsyncSession, *, student: User, timezone: str) -> GuidanceSnapshot` membaca committed student-visible evidence. Planning window rolling30hari; pilihan filter grafik tidak mengganti active plan.
- GuidanceSnapshot: source_snapshot_hash, as_of, planning_window, visible fact IDs, current progress, assessment coverage, eligible PlanCandidates. Hash hanya data publik yang relevan/versinya, bukan generated_at setiap request atau private item outcomes.
- PlanCandidate: candidate_id, kind review_unit|practice|self_explain, class/material/concept/unit IDs, content/mapping/manifest versions, supported_question_count, estimated_minutes, allowed_reason_fact_ids. URL selalu dibentuk server dari IDs.
- `derive_progress_insights(snapshot: GuidanceSnapshot) -> list[ProgressInsight]` maksimum3, observasi→arti terbatas→aksi. Ambang awal versioned: min3 soal independen unassisted dari2 sesi untuk label kuat/lemah, mastery>=0.8 kuat, <0.6 perlu latihan. Tren memerlukan2 titik bertanggal; kurang evidence -> data awal/belum dinilai, bukan kemampuan nol.

- [ ] **Step 1: Tulis tes gagal** cold start, satu correct answer, unmapped, assisted, kualitas sumber gagal, duplicate retries, decline karena decay, improvement tanpa titik pembanding, dan konsep yang muncul sekaligus kuat/lemah. Assert setiap fact/evidence/target cocok scope siswa dan sumber yang siap; tidak ada insight menyalahkan siswa atas extraction failure.
- [ ] **Step 2: Tambah tes rilis tugas** dua kondisi dengan public aggregate sama tetapi item private berbeda menghasilkan fakta/candidate/hash publik sama. Aggregate grade yang boleh dibuka tidak memberi akses ke hidden item/concept. Raw MasteryScore dengan kontribusi belum rilis tidak diteruskan ke model; gunakan visible-event projection bila lengkap atau tandai data konsep belum cukup. Release feedback mengubah eligible snapshot tanpa menulis ulang internal mastery.
- [ ] **Step 3: Jalankan merah**: `python -m pytest tests/unit/test_progress_guidance.py tests/unit/test_progress_rollup.py tests/integration/test_assignment_analytics.py -q`, dedicated DB diaktifkan, tanpa skip.
- [ ] **Step 4: Implementasikan** derivasi fakta/kandidat deterministic dan privacy filtering sebelum ranking. Prioritas resume→cek awal jika coverage kurang→remediasi jika evidence cukup→bagian berikutnya. Prasyarat hanya dari relasi yang memang disetujui; tidak ada relational data -> jangan infer dengan AI. Data lama tanpa provenance tidak berubah menjadi mastery baru. Estimasi durasi diberi label perkiraan.
- [ ] **Step 5: Jalankan hijau** Step3 dan self-only/teacher permissions tests; assert membaca snapshot tidak mengubah mastery/progres atau memanggil AI.
- [ ] **Step 6: Commit lokal** `feat: derive evidence based progress insights and planning candidates` setelah review implementasi, tanpa push/merge otomatis.

### Task 2: Planner graph dengan output terbatas dan fallback

**Files:** Create `agents/planner_agent.py`, `graphs/progress_planning.py`, `tests/unit/test_progress_planner.py`; modify `agents/recommendation_agent.py`; extend `tests/unit/test_analytics_language.py`.

**Interfaces:**
- Consume GuidanceSnapshot/PlanCandidate Task1.
- `async planner_node(state: ProgressPlanningState) -> dict` menghasilkan PlanProposal(goal_candidate_id, step_candidate_ids maksimal3, reason_fact_ids) melalui get_recommendation_llm yang sudah ada; model tidak menghasilkan arbitrary URLs, angka observasi, atau SQL.
- `validate_plan_proposal(proposal: PlanProposal, snapshot: GuidanceSnapshot) -> ValidatedPlan` memastikan kandidat/versi/reason sah dan langkah berurutan tanpa duplikasi. `fallback_plan(snapshot: GuidanceSnapshot) -> ValidatedPlan` memberi maksimal3 langkah dari kandidat yang tersedia, atau no_available_material dengan tindakan pilih kelas/hubungi guru.
- `build_progress_planning_graph()` menghubungkan fakta/kandidat→planner→validasi→Recommendation presentation. `recommendations_from_plan(plan: ValidatedPlan, snapshot: GuidanceSnapshot, language: str) -> list[RecommendationView]` deterministic, tidak memanggil model lagi. Angka/observasi/CTA copy dari template terlokalisasi dan target tervalidasi.

- [ ] **Step 1: Tulis tes gagal** model memilih ID tak dikenal, materi kelas lain, count>3, langkah duplikat, reason yang tidak mendukung tujuan, output malformed, timeout10detik, URL palsu dan dokumen berisi instruksi. Output valid harus memakai1 tujuan dan maks3 langkah dengan evidence yang cocok. Tidak ada label kuat hanya dari satu jawaban.
- [ ] **Step 2: Jalankan merah**: `python -m pytest tests/unit/test_progress_planner.py tests/unit/test_analytics_language.py -q`.
- [ ] **Step 3: Implementasikan** graph dan satu gateway call dibatasi timeout; schema/referential validation dahulu, bukan menerima teks bebas lalu percaya. Proposal invalid/timeout memakai fallback tanpa paid repair/retry. Pada jalur Progress, Recommendation merender proposal tervalidasi; jalur chat lama kompatibel sampai integrasi rencana grounding selesai.
- [ ] **Step 4: Jalankan hijau** Step2; assert paling banyak1 model call/snapshot, kedua bahasa, no available source tidak membuat soal/link palsu, dan bukan sekadar menguji keberadaan kata planner di source.
- [ ] **Step 5: Commit** `feat: add constrained progress planner and recommendation rendering`.

### Task 3: Rencana tersimpan, durable jobs, dan hubungan dengan sesi

**Files:** Create `api/progress_guidance_service.py`, `api/routes/progress_guidance.py`, `api/progress_guidance_worker.py`, `database/migrations/versions/0014_progress_guidance.py`, `tests/integration/test_progress_plans.py`; modify `database/models.py`, `api/main.py`, `api/durable_jobs.py`, `api/material_worker.py`, `api/assessment_service.py`, `api/learning_service.py`, `api/editorial_quiz_service.py`, `api/routes/classrooms.py`, `memory/long_term.py`; extend `tests/unit/test_material_pipeline.py` untuk memastikan kind lama tidak rusak.

**Interfaces:**
- LearningPlan menyimpan student/cycle/revision/source_snapshot_hash/policy+prompt versions/goal/evidence/status active|completed|superseded/timestamps; paling banyak satu active plan per siswa. LearningPlanStep menyimpan target/version/status pending|in_progress|completed|skipped|invalidated dan session/evidence linkage. History revisi/target yang diganti disimpan, completed/in_progress steps tidak ditimpa oleh regenerasi.
- `ensure_plan_job(session, student_id: UUID, snapshot: GuidanceSnapshot, *, cycle_id: UUID) -> BackgroundJob` menulis outbox job kind progress_plan dalam transaksi yang sama dengan perubahan sumber; baru terlihat worker setelah commit. Key unik student+cycle+snapshot_hash+policy/prompt/language. Worker memakai lease/fencing, menolak hasil stale dan mem-publish plan+legacy Recommendation projection secara atomik.
- GET `/analytics/me/guidance` membaca insight/rencana tanpa AI/job; POST `/analytics/me/guidance/refresh` dengan request_id/timezone/expected_revision memastikan job idempoten dan mengembalikan ready atau202 updating. Data tanpa plan tetap memiliki fact/focus fallback yang sah.
- POST `/analytics/me/plans/{plan_id}/steps/{step_id}/start` dan `/skip` memakai request_id/expected_revision; actor dari session, bukan body. Start memvalidasi ulang lalu membuat/melanjutkan sesi, menghasilkan server-built destination. Review unit tertentu menggunakan planned-review context subset dengan canonical manifest penuh; tidak meloncat/mengubah sesi belajar lain atau menandai seluruh materi selesai.
- `apply_plan_learning_event(session, *, receipt_id: UUID, student_id: UUID) -> None` menyelesaikan step hanya dari receipt unit/quiz/self-explain yang cocok target+versi. Salah jawaban dapat menyelesaikan aktivitas, bukan mastery goal. Skip tidak memberi poin/mastery dan sesi yang sudah berjalan tetap bisa dipulihkan.

- [ ] **Step 1: Tulis integration tests gagal** refresh ganda/two tabs satu job/plan/call; restart menyimpan plan/status; start tidak complete; selesai kuis pada materi lain tidak menutup step; replay receipt tidak memajukan dua langkah; semua langkah selesai tidak menciptakan langkah tanpa akhir. Plan baru hanya cycle baru yang sah; chart filter tidak mereset rencana.
- [ ] **Step 2: Tambah tests authorization/staleness** enrollment dicabut, class archived, publication false, content/mapping/manifest berubah, student lain memalsukan plan/step IDs, target review subset tidak menyelesaikan materi penuh. Hidden assignment result tidak masuk reason/hash/model; released feedback mengantrekan refresh yang sesuai. Started step dipertahankan kecuali targetnya tidak lagi valid, pending saja boleh diganti.
- [ ] **Step 3: Jalankan merah**: `python -m pytest tests/integration/test_progress_plans.py tests/unit/test_material_pipeline.py -q`, dedicated PostgreSQL/private schemas tanpa skip.
- [ ] **Step 4: Implementasikan** migration/services/routes/worker dan outbox hooks pada full-session/grade/material completion atau release/revocation. GET tidak membuat panggilan provider. Dispatcher mengenali kind baru secara eksplisit; material worker tidak mencuri job unsupported. Tidak menahan learner lock saat model berjalan; satu model attempt maksimum10detik, gagal menghasilkan fallback, fencing menolak worker lama. Hasil yang belum committed/preview graph tidak mem-publish rekomendasi.
- [ ] **Step 5: Jalankan hijau** Step3 dan migration upgrade/downgrade; assert completion/refresh tidak menulis score/mastery tambahan. Recommendation aktif yang berplan mengikuti expiry/status/scope terkini; jangan hanya consumed=false selamanya. Core jobs import/index lama tetap lulus.
- [ ] **Step 6: Commit** `feat: persist actionable study plans and learning feedback`.

### Task 4: Halaman Progres yang mengutamakan tindakan

**Files:** Paths relatif apps/web/. Create `src/components/progress-focus.tsx`, `src/components/progress-insights.tsx`, `src/components/progress-learning-plan.tsx`, `src/lib/progress-guidance-types.ts`, `src/lib/progress-guidance-proxy.ts`, `src/app/api/analytics/me/guidance/route.ts`, `src/app/api/analytics/me/guidance/refresh/route.ts`, `src/app/api/analytics/me/plans/[...path]/route.ts`, `tests/progress-guidance.test.mjs`, `src/styles/progress-guidance.css`; modify `src/components/student-analytics.tsx`, `src/app/siswa/progres/page.tsx`, `src/lib/analytics-types.ts`, `src/styles/learning.css` untuk import gaya baru; extend `tests/student-analytics.test.mjs`, `tests/guided-tutor-accessibility.test.mjs`, `tests/menu-narration.test.mjs`.

**Interfaces:** Consume GuidanceResponse/PlanStep/RecommendationView Tasks1–3. Progres berurutan: satu Fokus sekarang+Mulai/Lanjutkan → maksimum3 insight → rencana maksimum3 langkah → detail statistik/riwayat. PlanStep start response mengarahkan ke route/sesi yang tervalidasi, bukan URL buatan model. Ada Dengarkan ringkasan dan Mengapa saran ini? yang membaca fakta/tujuan/aksi, bukan internal reasoning model.

- [ ] **Step 1: Baca** AGENTS web dan Next docs relevan; gunakan desain refined yang ada. Jangan mengubah halaman pengaturan, voice provider, cache suara, atau menambahkan menu provider AI.
- [ ] **Step 2: Tulis tests gagal** cold start dan unmapped punya langkah yang relevan tanpa statistik palsu, satu evidence diberi label data awal, focus/CTA memiliki target nyata, stale source menonaktifkan start dan memberi alternatif, refresh job berjalan tetap menampilkan data sah terakhir. Keyboard/focus/aria/hover TTS dan mobile punya aksi setara; progress summary boleh persen, sesi tetap poin/count.
- [ ] **Step 3: Jalankan merah**: `node --test tests/progress-guidance.test.mjs tests/student-analytics.test.mjs tests/guided-tutor-accessibility.test.mjs`.
- [ ] **Step 4: Implementasikan** components/proxy dengan self-only session, whitelist action dan no-store. GET cukup untuk membaca; refresh job hanya saat sumber baru/permintaan relevan dengan server dedupe. CTA single-primary, detail angka berada setelah fokus; jangan mengganti seluruh halaman menjadi chat atau daftar metrik. User boleh mengganti fokus/skip, dan UI tidak optimistically mengaku plan selesai sebelum receipt.
- [ ] **Step 5: Verifikasi** Step3, related narration/navigation/quiz tests, `npm run typecheck`, `npm run lint`, `npm run build` di Docker. Evaluasi live lokal terbatas pada cold start, siswa mapped, dan unmapped; nilai apakah alasan cocok facts dan semua CTA benar-benar membuka target/sesi yang dimaksud melalui HTTP. Pengguna tetap melakukan klik/screen-reader/mobile testing.
- [ ] **Step 6: Commit** `feat: add progress insights and guided next learning steps`.

## Batas rilis tahap ini

Tidak ada kalender/notifikasi otomatis, streak/leaderboard/XP, atau planner satu semester. Tahap ini berhasil jika setiap siswa mendapat satu langkah berikutnya yang didukung data, dapat menjalankannya, dan melihat hasilnya kembali ke Progres.

## Status audit 20 Oktober 2026

Implementasi Planner, guidance tersimpan, aksi langkah, dan halaman Progres sudah tersedia pada source tree saat ini. Pemeriksaan terarah meliputi 200 tes fitur pembelajaran (1 skip), 11 tes Planner dengan PostgreSQL, 105 tes progres/poin/TTS/kuis, 65 tes materi/guidance/rollup/profil/agregator, serta verifikasi typecheck dan web test sebelumnya (32 lulus). Empat PDF contoh lulus acceptance import dan retrieval dengan embedding simulasi; evaluator fixture lulus. Endpoint profil diri memakai proyeksi evidence publik yang sama, bukan `MasteryScore` campuran. Ruff check seluruh backend lulus dan 324 file sudah sesuai format.

Audit lanjutan pada branch yang telah diganti menjadi `goldenz/grounded-learning-progress` menemukan dan memperbaiki tiga bug: sesi Tutor penuh melanjutkan scope review Planner, upload subject document kehilangan keputusan review/provenance AST, dan penggantian PDF mewarisi atribusi sumber lama (termasuk dokumen tanpa tautan impor). Regresi Planner/guided/progres lulus 30 tes; materi/AST/PDF/pipeline lulus 50 tes dengan 1 skip Qdrant. Pemasangan mypy membuka 87 error pada kode inti yang kemudian diperbaiki. Gate typecheck kode inti dan tes, lint, format, serta ketersediaan tooling kini lulus.

Run penuh final menghasilkan **846 lulus, 127 skip, dan 2 gagal**. Kedua kegagalan adalah gate yang memerlukan executable Git yang tidak tersedia di image test (`FileNotFoundError: git`); pemeriksaan ekuivalen pada checkout asli lulus tanpa mencetak nilai secret. Redis test dipakai secara terisolasi dan sudah dihentikan. Tes API/WS yang memerlukan server lokal `:8000` dan tes Qdrant terisolasi masih dilewati. Ini belum merupakan persetujuan rilis. Tidak dilakukan klik UI, uji screen reader/perangkat mobile, pemanggilan provider LLM/ElevenLabs nyata, merge, commit, atau push. Lihat [laporan audit lanjutan](../../testplan/2026-10-20-followup-audit.md) untuk bukti, perintah, dan batas validasi. Checklist di atas tetap mencatat urutan rencana implementasi dan tidak ditandai selesai hanya berdasarkan audit ini.

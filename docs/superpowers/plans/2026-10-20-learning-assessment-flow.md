# Learning and Assessment Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pisahkan perilaku Tutor dan asesmen mandiri tanpa merusak receipt, pemulihan sesi, rilis tugas guru, atau mastery.

**Architecture:** Kebijakan sesi versioned menentukan transisi secara deterministik. Simpan outcome per soal dan receipt aksi di transaksi yang sama dengan state sesi; graph memberi penilaian/petunjuk, bukan menentukan sendiri hak untuk retry atau membuka jawaban. UI membaca available_actions server.

**Tech Stack:** FastAPI, Pydantic, SQLAlchemy/Alembic, PostgreSQL, LangGraph, Next.js 16, React 19, pytest, Node test runner, Docker.

**Spec:** [Desain materi dan pembelajaran](../specs/2026-10-20-grounded-material-learning-design.md), terutama bagian 1 dan 5–7.

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

1. Jawaban dan Lanjut bersamaan hanya menutup satu outcome dan memajukan satu soal — Task 2 PostgreSQL concurrency.
2. Hint/retry tidak menggandakan mastery atau meningkatkan nilai pertama — Tasks 1–2.
3. Jawaban benar soal terakhir tetap memiliki review yang bisa dipulihkan — Tasks 2–3.
4. Mapping berubah tanpa perubahan teks tidak menerima evidence baru — Task 2.
5. Jawaban/rubric tidak muncul pada payload siswa atau hint Tutor — Tasks 1–3.

---

## Urutan dan lingkungan

Ini rencana pertama; dapat dikirim sebelum pipeline PDF baru. Mulai dari checkout terisolasi setelah status/fetch/worktree diperiksa, tanpa mengambil perubahan agent lain. Jangan menjalankan tes DB pada database aplikasi. Gunakan database PostgreSQL uji `kodmod_test` dalam container terpisah; existing transaction tests membatasi target database tersebut. Container test memasang source read-only; dependensi test dipasang di image/container sekali pakai. Jangan memodifikasi venv API yang sedang berjalan.

Semua perintah pytest di bawah dijalankan dari `apps/ai-engine` **di container test** dengan `PYTHONDONTWRITEBYTECODE=1`, DEBUG=false, dependency `[test]`, dan provider stub. Perintah Node dijalankan dari `apps/web` di Node Docker. Tidak memakai sh -lc yang mengganti PATH venv. Gunakan `/opt/venv/bin/python` bila memakai image API lokal. Migration ID di bawah diasumsikan sesudah head saat audit `0011_provider_usage`; periksa ulang Alembic head sebelum membuat revisi.

### Task 1: Kontrak kebijakan dan feedback per mode

**Files:** Create `apps/ai-engine/api/quiz_policy.py`; modify `models/quiz.py`, `graphs/state.py`, `graphs/main_graph.py`, `agents/scoring_agent.py`, `agents/tutoring_agent.py`; test `tests/unit/test_quiz_policy.py` (new), `tests/unit/test_assessment_mode.py`.

**Interfaces:**
- Produce `QuizPolicy(version: Literal[1,2], mode: Literal['tutor','assessment'])` dan `decide_transition(policy: QuizPolicy, *, correct: bool, action: str, question_closed: bool) -> QuizDecision` di quiz_policy.py.
- QuizDecision menentukan keep_open/close/review dan allowed actions; v1 mempertahankan routing lama. State baru memakai `quiz_policy_version=2`.
- Produce `QuizActionRequest(action_id: UUID, question_id: UUID, action: Literal['hint','advance'])` dan `QuizInteractionView(policy_version, question_state, available_actions, current_question, last_review)` di models/quiz.py. Tambahkan fields tersebut pada response submit/recovery secara additive.
- Feedback internal terpisah `hint_text`, `review_explanation`, dan canonical answer. Renderer student hanya mendapat bagian yang boleh dirilis.

- [ ] **Step 1: Tulis tes gagal** `test_assessment_wrong_enters_review`, `test_tutor_wrong_keeps_advance_available`, `test_tutor_hint_omits_canonical_answer`, `test_v1_session_keeps_legacy_policy`; assert salah v2 mandiri close sekali, Tutor bisa hint/answer/advance, dan payload awal tidak memiliki answer/rubric. Tambahkan contoh answer frasa dan angka agar filter kebocoran bukan sekadar pemeriksaan substring huruf opsi.
- [ ] **Step 2: Verifikasi merah**: `python -m pytest tests/unit/test_quiz_policy.py tests/unit/test_assessment_mode.py -q`; expected kegagalan kontrak/transisi baru.
- [ ] **Step 3: Implementasikan** pure policy di quiz_policy.py, pin versi pada start state, dan routing graph berdasarkan mode+policy. Pisahkan instruksi feedback Tutor (satu langkah proses) dari review mandiri (jawaban benar+alasan); simpan jawaban/rubric hanya pada state server. Timeout hint memberi petunjuk konservatif tanpa answer key, tidak mengubah cursor.
- [ ] **Step 4: Verifikasi hijau** dengan perintah Step 2 ditambah `tests/unit/test_quiz_quality.py`; assert tidak ada perubahan kebijakan editorial.
- [ ] **Step 5: Commit lokal setelah review implementasi**, hanya file task ini: `fix: separate tutor and assessment quiz policies`. Jangan push/merge tanpa instruksi pada tahap eksekusi.

### Task 2: Outcome, aksi, idempotensi, dan mastery dalam satu transaksi

**Files:** Create `database/migrations/versions/0012_quiz_policy_outcomes.py`, `api/quiz_actions.py`; modify `database/models.py`, `api/assessment_service.py`, `api/routes/quiz.py`, `api/learning_service.py`; test `tests/assessment_test.py`, `tests/unit/test_quiz_recovery.py`, `tests/unit/test_guided_learning.py`, `tests/integration/test_assessment_transactions.py`, `tests/unit/test_quiz_actions.py` (new).

**Interfaces:**
- Consume Task 1 policy/view/request.
- Produce `apply_quiz_action(session: AsyncSession, student: User, sid: UUID, body: QuizActionRequest) -> QuizInteractionView` dan `finalize_question_outcome(session: AsyncSession, owned: QuizSession, question_id: UUID) -> QuizQuestionOutcome`.
- New QuizQuestionOutcome unique(session_id, question_id), first_submission_id nullable FK AssessmentSubmission, status answered|skipped, first_score, assisted, closed_at. New QuizActionReceipt keyed action_id dengan request fingerprint dan response_payload.
- Nilai pertama per soal menjadi nilai resmi. Existing MasteryEvent memakai first_submission_id; paling banyak satu event per soal+konsep. Assisted-before-first-answer dan skip tanpa jawaban tidak menulis mastery. Retry Tutor tetap disimpan sebagai riwayat, bukan denominator baru.
- `POST /quiz/{session_id}/actions`: hint/advance idempoten. `advance` Tutor terbuka menutup soal langsung ke soal berikutnya, dengan pembahasan opsional; `advance` saat review hanya mengakui review dan membuka cursor berikutnya, tanpa menutup dua soal. Assessment tidak menerima hint atau jawaban kedua; submit baru ditolak selama pending review belum diakui. Simpan pending review di committed state agar refresh tidak menghilangkan penjelasan.

- [ ] **Step 1: Tulis tes gagal**: wrong independent accepted once; Tutor skip kosong tanpa QuizAttempt palsu/mastery; wrong→retry benar tetap first_score=0 dan satu mastery; hint-before-answer tidak memberi positive mastery; replay sama tanpa graph call; ID sama payload berbeda 409; akses lintas siswa 404/403; mapping-only change 409; content change 409; no mapping tetap kuis/skor tanpa mastery.
- [ ] **Step 2: Jalankan merah**: `python -m pytest tests/unit/test_quiz_actions.py tests/assessment_test.py tests/unit/test_quiz_recovery.py -q`.
- [ ] **Step 3: Implementasikan** migration dan services dengan row lock sesi untuk submit/aksi. Urutan: authorization terkini → cek receipt cocok → guard versi untuk mutasi baru → jalankan penilaian/hint → outcome/score/mastery/receipt → commit. Replay receipt hanya setelah otorisasi dan tanpa mutasi baru. Recovery v2 memeriksa kedua versi dan menyimpan review terakhir terpisah dari final_summary. Jangan mengubah data v1 aktif; final_score v2 jumlah first_score / total_questions, skip kontribusi 0 tanpa negative mastery.
- [ ] **Step 4: Tambah dan jalankan tes konkurensi PostgreSQL** untuk submit vs advance, submit vs submit, dan replay setelah restart stub graph. `python -m pytest tests/integration/test_assessment_transactions.py -q`; target ASSESSMENT_TEST_DATABASE_URL hanya dedicated kodmod_test, expected tidak ada skip, satu outcome/cursor step/evidence. Jalankan juga Step 2 serta guided tests dan migrasi upgrade/downgrade pada DB uji.
- [ ] **Step 5: Commit** `fix: persist quiz outcomes and idempotent learning actions` dengan daftar file task eksplisit.

### Task 3: UI soal dengan aksi server dan review yang dapat dipulihkan

**Files:** Modify `apps/web/src/components/student-quiz.tsx`, `guided-tutor.tsx`, `lib/quiz-types.ts`, `lib/learning-types.ts`; create `apps/web/src/app/api/quiz/[sessionId]/actions/route.ts` mengikuti proxy kuis yang sudah ada; modify `apps/web/tests/student-quiz.test.mjs`, `guided-learning-proxy.test.mjs`; create `apps/web/tests/quiz-actions.test.mjs`.

**Interfaces:** Consume QuizInteractionView Task 1 dan action endpoint Task 2; web type memiliki union action yang sama. Guided-tutor meneruskan quiz completion ke sesi belajar yang benar. Legacy v1 memakai rendering kompatibel sampai sesi selesai.

- [ ] **Step 1: Baca** `apps/web/AGENTS.md` dan dokumentasi Next yang relevan di `apps/web/node_modules/next/dist/docs/` sebelum mengubah route/component.
- [ ] **Step 2: Tulis tes gagal** wrong Tutor memiliki “Lanjut soal”, optional “Coba lagi” dan “Petunjuk”; wrong assessment hanya pembahasan+Berikutnya; tidak ada retry; last-question review tampil sebelum summary; refresh mengembalikan review+next; pending request mencegah duplikasi; request gagal mempertahankan action/submission ID untuk retry transport; aria labels/focus/TTS membacakan teks matematika yang sudah dinormalisasi tanpa jawaban prematur.
- [ ] **Step 3: Jalankan merah**: `node --test tests/student-quiz.test.mjs tests/quiz-actions.test.mjs tests/guided-learning-proxy.test.mjs`.
- [ ] **Step 4: Implementasikan** rendering berdasarkan available_actions dan question_state; hapus inferensi retry dari kesamaan order_index untuk v2. Buat action ID sekali per interaksi, simpan saat retry jaringan, gunakan ID baru hanya aksi baru. Tampilkan review item dan ringkasan dalam area terpisah. Jaga fokus heading soal berikutnya dan tombol nyata untuk mobile/keyboard. Gunakan narasi/UiText yang ada.
- [ ] **Step 5: Verifikasi** perintah Step 3, focused voice/navigation tests, `npm run typecheck`, dan `npm run lint` di container source terbaru. API integration fixture harus menolak body/aksi tidak sah; jangan menyebut kelulusan stub sebagai bukti ElevenLabs live. Pengguna melakukan klik manual.
- [ ] **Step 6: Commit** `feat: add optional tutor retry and direct quiz progression`.

## Kriteria penutupan tahap

Demo Docker baru: Tutor bisa langsung lanjut, hint tidak berisi jawaban final, mandiri salah langsung review dan lanjut, dan replay tidak menaikkan jumlah evidence. Lampirkan hasil suite dan batas bukti. Kelas uji yang sudah dibuat tetap tersedia; tidak mereset data. Lanjut ke [StudentModel, progres dan poin sesi](2026-10-20-student-progress-points.md), kemudian pipeline dokumen. Batas UI akhir dari permintaan tambahan pengguna: sesi menggunakan poin/count dan persentase statistik hanya di halaman Progres; rincian format/kontrak ada pada rencana poin.

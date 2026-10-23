# Kontrak kuis adaptif tersimpan

Milestone 0, sebelum kuis penugasan guru. Autentikasi memakai akun siswa.

## Mulai: POST /quiz/start

Body: `concept_id` UUID opsional, `n_questions` 1–20, `difficulty` easy/medium/hard opsional, `language` id/en.
Respons 200 berisi `quiz_session_id`, `first_question` dengan `order_index` mulai 0, dan `total_questions`.
Sesi, soal, rubrik, dan state kanonis harus sudah committed sebelum respons sukses.
Konsep yang tidak ditemukan: 404. Database/provider gagal: 503.

## Jawab: POST /quiz/submit

Body wajib: `quiz_session_id`, `question_id`, dan `submission_id` UUID; `student_answer` string dipangkas, 1–4000 karakter.
`response_latency_ms` opsional, integer 0–3600000.

Frontend membuat satu `submission_id` untuk satu jawaban yang sengaja dikirim.
Saat jaringan/503 bermasalah, kirim ulang UUID dan seluruh payload yang sama.
Jawaban perbaikan yang sengaja dibuat memakai UUID baru. Respons 200 tetap memakai DTO kuis yang ada.
`next_question.order_index` boleh tetap sama ketika tutor memberi kesempatan menjawab lagi.

| Status | Arti |
| --- | --- |
| 200 | Jawaban, hasil, cursor, dan efek mastery berhasil committed, atau hasil committed diputar ulang |
| 404 | Sesi/soal tidak ditemukan atau tidak dimiliki siswa |
| 409 | Soal sudah berganti, sesi selesai/legacy, atau UUID dipakai dengan payload berbeda |
| 422 | Payload tidak valid, belum dinilai |
| 503 | Hasil belum dapat dipastikan; retry dengan payload identik |

Replay diperiksa sebelum guard sesi selesai. Hasil replay diambil dari PostgreSQL tanpa memanggil graph/provider lagi.
Transaksi mengunci sesi dan siswa untuk menserialkan perubahan mastery. Satu penerimaan menghasilkan satu `QuizAttempt` dan `AssessmentSubmission`.
`MasteryEvent` unik untuk pasangan submission/Concept yang sah. Semua perubahan berada dalam transaksi yang sama.

## Pemulihan dan batas scope

PostgreSQL menjadi sumber state kuis. Setiap giliran REST membangun graph dari snapshot committed dengan thread internal baru, sehingga checkpoint gagal atau Redis hilang tidak mengubah hasil.
Node graph dalam mode `assessment_managed` hanya menghitung preview; tidak menulis mastery, Redis, atau laporan analytics sendiri.
Sesi sebelum migrasi yang tidak mempunyai snapshot harus dimulai ulang (409), bukan direkonstruksi dari checkpoint yang belum terverifikasi.
Mini-kuis dalam percakapan tutor masih memakai alur percakapan; kontrak durable ini berlaku untuk `/quiz/start` dan `/quiz/submit`.
Materi kelas tanpa pemetaan Concept yang telah direview tidak mengubah Concept global.
Ini latihan adaptif, bukan nilai resmi penugasan guru.

## Validasi milestone 0

- Tes FastAPI/SQLite: pemilik sesi, soal aktif, replay, konflik payload, sesi legacy, rollback, provenance jawaban, dan guard Concept kelas.
- Tes PostgreSQL port 5434: request bersamaan untuk UUID sama/berbeda, replay setelah aplikasi diulang, dan mastery dua kuis siswa yang sama. Fixture membuat schema sementara sendiri.
- Alur LangGraph asli diuji dengan provider simulasi: remediasi, soal berikutnya, selesai, dan evidence SQL; tidak ada panggilan OpenAI/ElevenLabs nyata.
- Frontend: helper retry dan kontrak payload, lint, typecheck, build. Snapshot retry tersimpan selama komponen terpasang; resume setelah reload halaman belum tersedia.
- Uji browser dan perangkat/assistive technology nyata belum terverifikasi. Menjalankan server Next.js uji port 3211 ditolak automatic approval review dengan `blocked by policy`.

Untuk acceptance proxy, jalankan fixture dan Next.js di terminal terpisah dari root repo:

```powershell
$env:FIXTURE_PORT = '3219'
node apps/web/tests/api-fixture.mjs
```

```powershell
$env:API_ORIGIN = 'http://127.0.0.1:3219'
npm exec --workspace @kodmod/web -- next dev --port 3211 --hostname 127.0.0.1
```

```powershell
$env:WEB_TEST_ORIGIN = 'http://127.0.0.1:3211'
$env:API_FIXTURE_ORIGIN = 'http://127.0.0.1:3219'
node --test apps/web/tests/quiz-proxy.test.mjs apps/web/tests/access.test.mjs apps/web/tests/material-proxy.test.mjs
```

Browser acceptance di `/student/practice`, login fixture `siswa.test` / `fixture-only-123`:
1. Atur `POST http://127.0.0.1:3219/__fixture/quiz` dengan JSON `{"failures":[503]}`. Kirim jawaban, pastikan opsi/mikrofon input terkunci dan retry mengirim payload identik. `GET /__fixture/quiz` memuat request yang diterima fixture.
2. Ganti failures menjadi `[422]`: setelah penolakan, input dapat diedit dan kiriman berikutnya mendapat UUID baru.
3. Ganti failures menjadi `[409]`: kirim ulang diblokir, tersedia tindakan Latihan baru dengan konfirmasi.
4. Tanpa failures, jawab salah: remediasi tetap bernomor soal sama. Klik Coba jawab lagi; jawaban perbaikan mendapat UUID baru dan nomor bertambah setelah diterima.

Fixture ini disposable dan simulasi respons; keberhasilannya tidak membuktikan provider nyata atau pembaca layar perangkat.

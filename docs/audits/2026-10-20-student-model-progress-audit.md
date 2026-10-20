# Audit StudentModel, progres materi, dan poin sesi

Tanggal: 20 Oktober 2026. Checkout `refined-ui-ux` di `778c5bc`; fetch main/VPS/refined dilakukan kembali, tanpa merge/push. Audit memperluas [audit materi dan RAG](2026-10-20-material-rag-learning-audit.md). Produksi belum diperiksa. Kode produk belum diubah; perubahan lokal hanya dokumen dan satu sesi uji tambahan pada kelas PDF yang sudah diizinkan.

## Kesimpulan

StudentModel pada jalur REST asesmen dengan konsep yang disetujui bekerja dan terhubung ke API Progres. Namun, penyelesaian Tutor belum memperbarui progres materi; scope konsep kosong tidak menghasilkan mastery; filter tujuh hari dapat menyembunyikan aktivitas lama; dan tampilan sesi mencampur rata-rata persentase dengan poin per jawaban. Ini masalah yang berbeda, sehingga menaikkan angka mastery secara buatan tidak menyelesaikannya.

## Bukti lokal nyata: jawaban → database → API

Pada siswa.demo, satu soal baru dari `[UJI PDF] Eksponen - Sifat dan Fungsi` dibuat sesudah mapping dua konsep disetujui. Session menggunakan content_version=1 dan mapping_version=1. Pengujian mengirim jawaban kanonik tersimpan untuk mengisolasi jalur penilaian/persistensi dari kemampuan menjawab siswa.

| Ukuran | Sebelum | Sesudah |
| --- | --- | --- |
| Hasil jawaban | — | score 1, benar, sesi selesai |
| Mastery konsep Fungsi Eksponen | belum ada evidence | 0,625; n_attempts=1 |
| MasteryEvent | baseline | +1 |
| Jumlah sesi pada API hari ini | 3 | 4 |
| Jawaban latihan pada API hari ini | 1 | 2 |
| Overall mastery pada API | 0 | 0,625 |
| MaterialProgress | baseline | tidak berubah |

Replay submission_id identik mengembalikan respons sama tanpa menambah event. Jadi perubahan SQL terbaca oleh `/analytics/me`; ini lebih kuat daripada pemeriksaan container/model unit saja. Nilai 0,625 adalah estimasi penguasaan dari prior 0,5 dan satu evidence benar, bukan skor ujian 62,5 atau persentase materi selesai. Nilai jawaban tetap 1.

Hash StudentModel, aggregator, learning_service dan assessment_service pada runtime API cocok dengan checkout saat audit. UI browser/device tidak diuji dengan klik.

## Celah yang ditemukan

### P1 — Finish Tutor tidak terhubung ke progres materi

`apps/ai-engine/api/learning_service.py` cabang finish hanya menyimpan ended_at, phase completed, dan summary pada LearningSession. MaterialProgress dikelola terpisah oleh PATCH reading completion/bookmark pada `api/routes/classrooms.py`; aggregator belum memakai progres unit materi.

Probe terisolasi melalui HTTP nyata dengan LLM fixture menyelesaikan semua unit dan finish. Hasil SQL: phase completed, ended_at tersimpan, tetapi tidak ada MaterialProgress dan completed-baca tetap false. Ini membuktikan gap integrasi; tidak berarti sesi belajar hilang. Diperlukan progres belajar versi materi yang diproyeksikan ke kartu/halaman Progres, tanpa memberi mastery hanya karena halaman selesai dibuka.

### P1 — Jalur conversational mini kuis berbeda dari REST assessment

`analytics/student_model.py:272–299` melewati semua scoped_material pada node update, dan mini_quiz_node memakai concept_id kosong untuk scope kelas. Perlindungan ini mencegah evidence global palsu ketika materi belum dipetakan, tetapi tidak memanfaatkan mapping yang sudah disetujui seperti assessment_service. Dengan demikian, tidak semua jenis mini kuis memiliki jalur evidence identik. Rencana penyatuan generator/factory harus mencakup persistensi attempt, konsep yang sah, receipt, dan mastery, bukan sekadar prompt soal.

### P2 — Poin sesi sekarang adalah dua penyajian berbeda

- `student-quiz.tsx:254`: Skor sementara = round(cumulative_score × 100) + `%`.
- `student-quiz.tsx:316`: score item × 100 disebut poin, tanpa maksimum eksplisit.
- `guided-tutor.tsx:270`: hasil mini kuis selesai berupa `%`.
- `agents/analytics_agent.py:55–57`: ringkasan asesmen menyebut percent/persen; ringkasan umum juga menyebut penguasaan persen.

cumulative_score sekarang rata-rata seluruh attempt, sehingga nilainya bukan akumulasi poin. Retry dapat menambah denominator atau mengubah rata-rata; mengganti simbol `%` menjadi kata poin saja akan tetap menyesatkan. Belum ada ledger XP atau mata uang poin terpisah pada model kuis yang diperiksa; tidak perlu menambah leaderboard untuk memenuhi permintaan pengguna.

Aturan yang dimasukkan ke desain: maksimum 100 poin per soal, total sesi menjumlahkan poin jawaban pertama per soal yang ditutup. Contoh 3 soal: `200 dari 300 poin`, bukan rata-rata `67%`. Hint/retry/replay tidak menambah reward resmi. Perhitungan internal skor/mastery tetap ternormalisasi. Semua label, aria dan TTS skor sesi mengikuti poin; persentase statistik hanya ditampilkan di halaman Progres. Persentase yang merupakan isi materi matematika tetap boleh dibaca.

### P2 — Belum ada pemisahan denominator v2 pada dashboard

Aggregator saat ini menghitung seluruh QuizAttempt untuk n_quiz_attempts, rata-rata dan akurasi, kemudian menambahkan jawaban tugas formal. Rencana outcome v2 menggunakan jawaban pertama per soal, sehingga aggregator perlu memisahkan official outcomes, raw support attempts dan legacy data. Jika hanya UI sesi diubah, halaman Progres masih akan memakai denominator retry yang lama.

### P2 — Data lama dan cakupan konsep perlu terlihat, bukan dianggap macet

Pada akun lokal baysatriow ditemukan dua sesi kuis, enam jawaban pada 4–5 Oktober 2026, dan tidak ada soal ber-concept_id maupun approved concepts pada snapshot sesi itu. API Semua waktu mengembalikan enam jawaban; filter hari ini/tujuh hari mengembalikan nol karena aktivitasnya di luar rentang. Tidak ada MasteryEvent maupun MasteryScore untuk akun ini, sehingga mastery kosong sesuai data tersebut.

Temuan ini menjelaskan kondisi lokal akun yang diperiksa; tidak menyatakan masalah produksi pasti sama. Aktivitas lama tidak boleh diubah menjadi mastery baru dengan menempelkan mapping terbaru ke snapshot lama. UI perlu menampilkan aktivitas/penyelesaian dan status belum dinilai/mapping pending secara berbeda dari kemampuan nol.

### P3 — Batas hari dan label durasi

Filter today memakai tengah malam UTC, sedangkan pengguna berada di Asia/Jakarta. Halaman Progres sebaiknya mengirim timezone IANA dan menampilkan batas rentang yang dipakai; klien lama tetap mendapat default UTC. Week/month saat ini rolling 7/30 hari, sedangkan mastery snapshot bersifat cumulative dan tidak berubah hanya karena tab periode diganti.

Durasi sesi memakai start sampai end/last activity. Salah satu sesi lama memiliki jawaban awal 4 Oktober dan jawaban terakhir 5 Oktober, sehingga jeda semalaman masuk ke elapsed duration. Nilai Semua waktu sekitar 932 menit tidak membuktikan seluruhnya belajar aktif. Rencana menjaga label durasi jujur, tanpa mengarang active time dari data yang tidak tersedia.

## Bagian yang terbukti bekerja

- StudentModel.update mengubah mastery sesuai skor/confidence, clamp 0..1, mencatat attempts dan last_practiced. load/aggregator memproyeksikan decay; persentase tidak harus selalu naik.
- REST assessment mengunci User sebelum load/update mastery, selain lock sesi. Probe PostgreSQL dua sesi berbeda untuk siswa/konsep sama menerima dua jawaban, menghasilkan dua MasteryEvent dan n_attempts=2; stored mastery=0,6996875 pada fixture confidence 0,9. Tidak ditemukan lost update dalam jalur ini.
- Replay receipt, approved-concept guard, dan assignment mastery mengikuti jalur persistensi yang sudah ada. Guard tersebut wajib dipertahankan ketika menambah skip/poin dan menyatukan jalur conversational.
- Frontend/backend fetch analytics memakai no-store dan tersedia tombol Perbarui data. Audit tidak menemukan bukti yang cukup untuk menyebut cache sebagai akar masalah.

## Tambahan audit insight dan Planner

Permintaan berikutnya menghendaki saran, insight, dan perencanaan belajar pada Progres. Pemeriksaan source di checkout yang sama menemukan graph utama memakai analytics→recommendation→accessibility; belum ditemukan node Planner tersendiri pada jalur aktif. Guided graph memakai explicit teaching actions tanpa planner.

recommendation_node mengembalikan structured_recommendations dalam state, sedangkan StudentAggregator/halaman Progres mengambil active_recommendations dari tabel Recommendation. Helper store_recommendation tersedia, tetapi pemanggilan helper dari jalur produksi node tidak ditemukan pada pemeriksaan referensi Python; pemanggilan yang ditemukan ada pada tests. Temuan ini adalah bukti hubungan source yang belum lengkap, bukan hasil pengujian provider/production terbaru.

Rencana baru menghubungkan fakta terotorisasi→Planner satu fokus/maksimum tiga langkah→Recommendation beralasan dan CTA→receipt hasil sesi→pembaruan rencana. Saran disimpan, memiliki target materi/versi yang nyata, dan dapat dimulai dari halaman Progres. Data sedikit menghasilkan cek awal; insight kuat/lemah tidak disimpulkan dari satu jawaban. Filter rilis tugas berlaku sebelum pemilihan target dan input model agar alasan saran tidak membocorkan hasil item privat. Tidak ada kode Planner baru atau tes fitur baru dijalankan pada tahap penulisan rencana ini.

## Pengujian tahap tambahan

- **53 tes repo lulus** di Docker: student model unit, analytics duration/language, mini-quiz scope, assessment mode, guided learning, serta dua acceptance lifecycle dengan PostgreSQL privat untuk tugas formal dan latihan.
- **37 tes web terfokus lulus** di Node Docker: analytics display/proxy, submission/retry, quiz, guided navigation/accessibility, dan speech normalization/output.
- **Dua probe audit terisolasi selesai**: satu mengonfirmasi gap finish→material progress; satu mengonfirmasi learner lock lintas sesi. Probe pertama sengaja mengamati perilaku yang belum diperbaiki, bukan tes target fitur yang sudah hijau.
- **Satu sesi lokal nyata selesai** pada materi PDF dengan mapping disetujui; persistensi dan API sebelum/sesudah serta replay diperiksa. Ini bukan pengujian suara live atau produksi.

Artefak privat yang diabaikan Git: `.runtime/pdf-rag-audit-2026-10-19/student-progress-check.json`, `progress-record-metadata.json`, script audit dan probe. Database/container PostgreSQL uji sementara sudah dihentikan; data aplikasi lokal dipertahankan.

## Tindak lanjut yang direncanakan

[Rencana StudentModel, progres, dan poin](../superpowers/plans/2026-10-20-student-progress-points.md) dikerjakan setelah kontrak outcome/aksi kuis, dilanjutkan [insight dan Planner](../superpowers/plans/2026-10-20-progress-insights-planner.md), sebelum editor/PDF. Desain bagian8–9 menentukan 100 poin per soal, progres belajar per versi, pemisahan mastery/aktivitas, persentase hanya di halaman Progres, serta rencana belajar yang dapat dijalankan. Perbaikan conversational mengikuti rencana grounding bersama; tidak mengaktifkan mastery untuk materi unmapped.

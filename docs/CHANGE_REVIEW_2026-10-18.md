# Ringkasan perubahan 18 Oktober 2026

Perubahan diperiksa terhadap `main` pada commit awal `b2c8cc7`. Cakupan yang
disiapkan untuk GitHub terdiri dari implementasi, pengujian, dokumentasi,
materi demo, dan berkas diagram/presentasi arsitektur.

## Perubahan aplikasi

- Qdrant mencari ID kandidat vektor. PostgreSQL tetap memeriksa izin, status
  publikasi, versi materi, dan hash vektor, serta menyediakan teks dan fallback.
  Mirror mengikuti commit PostgreSQL; reindex memakai embedding yang tersimpan.
- Qdrant bersifat opsional dan portnya tetap privat di Compose lokal. Data
  menggunakan named volume Linux. Panduan memuat backup, pemulihan ke koleksi
  baru, reindex, dan rollback ke pgvector.
- Inisialisasi Qdrant dibatasi satu timeout keseluruhan. Cooldown setelah
  kegagalan mencegah request bersamaan mengantre probe jaringan berulang.
- Pembacaan UI mencakup label menu, dialog, pilihan kuis, dropdown, switch,
  tab, dan status kontrol. Hover pasif tidak menggantikan konfirmasi pilihan
  atau soal tutor. Suara perangkat hanya berjalan bila dipilih pengguna.
- Autoplay soal menangani cleanup React StrictMode dan berhenti saat dialog
  pengaturan suara terbuka. Fokus keyboard dipulihkan setelah navigasi serta
  perubahan dropdown async. Navigasi mobile siswa/guru dapat dibuka/ditutup.
- Anotasi tipe pada perhitungan durasi analytics diperbaiki tanpa mengubah
  aturan penghitungannya.

## Materi dan dokumentasi

- Paket demo berisi 20 materi umum orisinal, 20 tugas, 20 template kuis
  masing-masing tiga soal, serta roster rencana 50 siswa sintetis bertanda
  `[DEMO]`. Paket berstatus draf dan belum diimpor ke website.
- Diagram dan empat presentasi arsitektur berada di `deliverables/architecture`.
  Berkas tersebut merupakan dokumentasi desain. Pemeriksaan ini tidak mengubah
  atau merender ulang presentasi.
- Folder build presentasi sementara diabaikan Git. File `.env`, key, audio,
  log runtime, dan data Docker tidak disertakan.

## Pemeriksaan sebelum commit

| Pemeriksaan | Hasil |
|---|---|
| Regresi frontend | 169 tes: 167 lulus, 2 dilewati, 0 gagal. |
| Regresi backend terisolasi | 698 lulus, 29 dilewati, 449 tidak dipilih, 0 gagal. |
| Qdrant dan durasi analytics terfokus | 10 lulus, termasuk dua regresi baru yang sebelumnya gagal. |
| Typecheck frontend dan ESLint | Lulus. |
| Mypy backend | Lulus untuk 90 berkas sumber. |
| Ruff untuk Python yang berubah | Pemeriksaan lint dan format lulus. |
| Bandit tingkat HIGH | Tidak ada temuan HIGH. |
| Build image web Docker | Berhasil; layer build yang tidak berubah memakai cache. |
| Compose lokal dengan profile Qdrant | Konfigurasi valid. |
| Parser PowerShell untuk wrapper Docker | Tidak ada kesalahan sintaks. |
| Pola kredensial pada kandidat berkas Git | Tidak ditemukan kecocokan pola yang diperiksa. |
| Pemeriksaan whitespace Git | Lulus. |

Regresi backend memakai PostgreSQL `kodmod_test` pada port 5434, Redis test
pada 16380, dan stub provider pada 18199. Port Redis berbeda dari default
6380 karena port default ditolak oleh reservasi Windows. API test native
berada pada 8000; frontend fixture berada pada 3110 dan 18109. Database
aplikasi tidak digunakan oleh rangkaian pengujian ini.

Selector backend adalah
`not static and not slow and not perf and not system and not real_llm`.
Tes yang dilewati mencakup fixture PostgreSQL khusus yang belum diaktifkan,
kasus psycopg yang membutuhkan loop berbeda pada Windows, dan PDF referensi
yang tidak diberikan melalui variabel fixture. Dua tes frontend yang dilewati
memerlukan environment editorial PostgreSQL terpisah. Tes tersebut tidak
dinyatakan lulus.

## Batas hasil pemeriksaan

Sintesis ElevenLabs terakhir ditolak dengan HTTP 401. Penyebab pembayaran,
kuota, atau kredensial belum dipastikan dari detail respons. Pemeriksaan ini
tidak mengklaim sintesis langsung berhasil, dan tidak mengganti provider ke
suara perangkat secara otomatis.

Penerapan Qdrant di VPS, acceptance fisik pembaca layar/mikrofon, kualitas
recall ANN, benchmark/soak, cakupan tes, dan Alembic-at-head belum dinyatakan
lulus oleh pemeriksaan ini. Status data demo dan bukti UI fixture dipisahkan
dari penggunaan siswa yang benar-benar tercatat pada aplikasi.

Rincian: [integrasi Qdrant](QDRANT_INTEGRATION.md),
[operasional Qdrant](QDRANT_OPERATIONS.md),
[pembacaan UI](VOICE_UI_OPERATIONS.md), dan
[paket demo](demo-data/general-learning/README.md).

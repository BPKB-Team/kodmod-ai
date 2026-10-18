# Pembaruan dan pemeriksaan VPS, 18 Oktober 2026

Rilis aplikasi terbaru telah diterapkan dan fungsi inti berhasil diuji melalui
kode serta HTTP. Pembuatan audio baru dan transkripsi ElevenLabs belum normal:
kedua endpoint aplikasi mengembalikan HTTP 502, dengan penolakan HTTP 401 dari
provider pada pemeriksaan sintesis. Pemilik akun provider perlu menindaklanjuti
diagnosis privat sebelum fungsi suara dapat dinyatakan pulih.

## Kode dan rilis

- Checkout `/home/kodmod-admin/kodmod-ai`, branch `codex/vps-setup`.
- Checkout diselaraskan secara fast-forward dari `72f356e` ke `origin/main`
  pada `c521bbe`. Lima commit baru mencakup suara/navigasi, progres assessment,
  adapter Qdrant, serta dokumentasi dan paket materi demo.
- `package-lock.json` diperbarui untuk `sharp` 0.35.4 → 0.35.5 beserta binary
  pendampingnya, dan `source-map-js` 1.2.1 → 1.2.2. Kedua versi memperbaiki
  advisory [sharp](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) dan
  [source-map-js](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).
- Web, API, worker, dan migrator memakai tag `vps-20261018-c521bbe-sec1`.
  Sepuluh service runtime aktif; migrator selesai dengan exit 0. Tag tersimpan
  pada root `.env` untuk startup berikutnya.
- VPS menggunakan `VECTOR_BACKEND=pgvector`. Adapter Qdrant tersedia dalam
  kode; Compose produksi mengikuti konfigurasi backend yang sudah dipilih.
- Paket 20 materi dan roster rencana 50 siswa dalam dokumentasi masih berupa
  bahan persiapan demo. Pemeriksaan ini tidak mengimpor roster atau menjalankan
  ulang seeder akun produksi.

## Hasil pengujian

| Pemeriksaan | Hasil |
| --- | --- |
| Backend, gabungan hasil terakhir per ID tes | **938 lulus, 0 gagal, 4 skip** |
| Run backend utama | 820 lulus; satu kegagalan setup migrasi dan lima skip ditindaklanjuti di bawah |
| Fuzzing OpenAPI terpisah | 116 tes berparameter lulus; maksimal 10 contoh per operasi |
| Migrasi database kosong dan pemeriksaan tambahan | 4 lulus |
| Higiene log memakai file API test yang aktif | 3 lulus |
| Frontend setelah patch dependency | **169 lulus, 0 gagal**: 167 utama dan 2 editorial PostgreSQL |
| Lint/typecheck frontend | Lulus |
| Ruff, format, mypy sumber/tes, dan gate dependency Python | Lulus dalam suite backend |
| Build image produksi web dan backend | Lulus |
| Audit npm runtime setelah patch | **0 advisory** |
| Decoder SVG sharp dan parser source-map-js | Lulus memakai paket hasil patch |
| Qdrant nyata + PostgreSQL sementara | **6/6 lulus** |
| Smoke HTTPS sesudah deploy | **14/14 lulus** |
| Monitoring sesudah deploy | **26/26 lulus** |
| Login API dan server action Next, halaman sesuai peran | Siswa, guru, dan admin lulus; cookie Secure/HttpOnly/SameSite=Lax |
| Otorisasi dan route baca siswa | Pembatasan admin lulus; enam route baca siswa berhasil |
| Materi produksi dan retrieval | 30 chunk siap; tiga hasil sesuai scope siswa; bukan anggota kelas ditolak |
| WebSocket melalui HTTPS publik | `/ws/chat` dan `/ws/voice` menolak koneksi tanpa autentikasi dengan 403 |
| OpenAI nyata | **8/8 lulus**, memakai keenam peran model aplikasi dan embedding |
| Chat HTTPS nyata dan riwayat | Berhasil; dua giliran tersimpan dan sesi uji ditutup |
| Readiness HTTPS | 30/30 berhasil, 5 koneksi paralel, p95 sekitar 240 ms dari VPS |
| Migrasi produksi | `0011_provider_usage`; `alembic check` melaporkan tidak ada operasi upgrade baru |
| ElevenLabs TTS dan STT nyata | Gagal; perlu tindak lanjut akun provider |

Angka backend merupakan gabungan hasil terakhir per ID tes, dengan JUnit
sebagai sumber. Kegagalan awal `test_alembic_consistent` terjadi karena runner
membentuk tabel melalui ORM tanpa riwayat Alembic. Pemeriksaan diulang pada
database kosong yang dibuat melalui seluruh migrasi sampai head dan lulus.
Pemeriksaan produksi terpisah juga lulus. Skip higiene log digantikan oleh
pengujian pada file log API test yang aktif.

Empat skip tersisa: satu fixture PDF opsional yang tidak tersedia dan tiga
kasus Compose yang tidak memiliki Docker daemon di dalam runner. Konfigurasi
Compose default, profile load, dan profile qdrant telah divalidasi terpisah
dengan CLI host. Dua tes build image legacy bertanda `slow` tidak dipilih;
image produksi untuk rilis ini dibangun secara langsung.

Seluruh database, cache, worker, stub provider, dan Qdrant untuk regresi
menggunakan project Docker sementara. Tes frontend mencakup dialog, narasi,
dropdown, autoplay, navigasi, alur belajar, dan editorial. Login produksi
diperiksa lewat protokol server action React dan HTTPS. Pengujian dilakukan
melalui kode tanpa klik browser.

## Provider dan pencarian materi

OpenAI diuji melalui factory/agent aplikasi: router intent, tutor Indonesia
dan Inggris, dua MCQ bersumber, penilaian rubrik, rekomendasi, refleksi, dan
embedding. Model peran aktif adalah `gpt-6-luna`; embedding
`text-embedding-3-small` menghasilkan dua vektor finite/nonzero berdimensi
1536. Sembilan receipt pemakaian untuk run tersebut berstatus sukses, dengan
counter event yang gagal disimpan bernilai nol.

Chat publik menggunakan akun demo siswa dan berhasil sekitar 20 detik pada
sampel ini. Angka tersebut bukan benchmark kapasitas. Request provider lain
berjalan bersamaan selama pemeriksaan.

Tes Qdrant menggunakan satu vektor fixture kanonis pada PostgreSQL sementara.
Enam pemeriksaan meliputi reindex/koleksi green, pembatasan payload, pembacaan
kandidat melalui PostgreSQL, fallback hash stale, penolakan scope kelas tanpa
siswa, dan fallback ketika Qdrant tidak dapat dihubungi. Gangguan jaringan
pada bagian terakhir sengaja dibuat. Hasil ini belum mengukur recall ANN atau
kualitas tutor terhadap dokumen kelas pengguna.

Sintesis ElevenLabs memakai teks baru agar cache lama tidak menutupi keadaan
provider. TTS dan STT publik gagal; TTS Inggris dan pengulangan cache tidak
dijalankan setelah sintesis pertama gagal. Diagnosis akun tersimpan privat
pada `.runtime/update-20261018/results/elevenlabs-diagnosis.json`.

## Data, HTTPS, dan pemulihan

Jumlah data yang diperiksa sebelum dan sesudah deploy sama: **6 akun, 1 kelas,
1 materi, dan 30 chunk**. Kredensial demo tetap memakai file privat yang ada.
Chat uji dan metadata pemakaian provider merupakan aktivitas demo tambahan.

Snapshot penuh sebelum rilis:
`/srv/kodmod/backups/kodmod-20261018T043457Z-10315`. Dump database, audio,
unggahan, dan konfigurasi memiliki checksum valid; snapshot bertanda
`COMPLETE`. Tool deploy juga membuat dump database sebelum migrasi.

Snapshot harian
`/srv/kodmod/backups/kodmod-20261017T201909Z-18266` telah direstore ke database
PostgreSQL sementara. Keenam akun, kelas, materi, 30 chunk, dan migrasi
`0011_provider_usage` ditemukan; database restore kemudian dihapus.

Rantai TLS dan hostname domain diverifikasi. Sertifikat berlaku sampai
3 Januari 2027. HTTP beralih ke HTTPS dan alias `www` beralih ke domain utama,
dengan path/query dipertahankan. Grafana tetap tersedia pada loopback port
3001. Port database/cache/metrik tetap privat.

## Tindak lanjut

- Pulihkan akses provider ElevenLabs melalui akun pemilik, lalu ulangi TTS,
  STT, TTS Inggris, dan cache audio.
- Audit termasuk paket pengembangan masih mencatat lima paket pada jalur
  `eslint-config-next` → `braces`, terkait satu
  [advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). Saran otomatis
  npm mengganti versi mayor konfigurasi ESLint ke 14.2.35; penyelesaian
  kompatibilitas tooling memerlukan pekerjaan tersendiri.
- Grafana memiliki nol contact point. Notifikasi operator dan backup offsite
  masih memerlukan tujuan yang dipilih; backup saat ini berada pada VPS.
- Daftar hardening dalam [review sebelumnya](VPS_REVIEW_2026-10-06.md),
  termasuk limiter biaya, pencabutan sesi, dan privilege database, masih
  memerlukan implementasi lanjutan.
- Uji perangkat siswa, screen reader, mikrofon, pemutaran audio, beban pengguna,
  serta pemulihan seluruh VPS baru memerlukan acceptance tersendiri.

JUnit, audit, hasil provider, log deploy, dan probe tersimpan privat pada
`.runtime/update-20261018/results/`. Folder tersebut diabaikan Git.
Container, jaringan, dan volume database khusus pengujian telah dihapus.

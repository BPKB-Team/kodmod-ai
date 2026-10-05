# Pemeriksaan ulang KODMOD dan VPS, 5–6 Oktober 2026

Fondasi VPS sudah berjalan dengan baik. Kekurangan utama sebelum pemakaian
publik lebih luas ada pada pembatasan biaya/pemakaian API, pencabutan sesi,
hak akses database, isi pembelajaran, dan pemulihan serta notifikasi operasional.
Temuan keamanan di bawah tetap terbuka meskipun tes regresi yang dijalankan lulus.

Checkout: `/home/kodmod-admin/kodmod-ai`, branch `codex/vps-setup`.
Source aplikasi berasal dari `main` pada `d4a983f`; baseline awal pemeriksaan
adalah commit lokal `26310ae`. Pengujian menggunakan terminal, kode, HTTP,
WebSocket, dan database sementara. Tidak ada pengujian dengan klik browser.

## Kondisi server dan aplikasi

| Bagian | Hasil |
| --- | --- |
| VPS | Ubuntu 24.04.5, 8 vCPU, RAM 7,8 GiB, swap 2 GiB, tanpa GPU |
| Resource setelah lab dibersihkan | RAM sekitar 1,8 GiB terpakai, 5,9 GiB tersedia; root filesystem 58 GiB, 28% terpakai, sekitar 42 GiB tersedia |
| Runtime | Sepuluh service produksi berjalan; container yang memiliki healthcheck sehat; tidak ditemukan OOM pada API, worker, web, PostgreSQL, atau Redis |
| Akses | TCP publik yang terpasang: 22, 80, 443. Grafana pada `127.0.0.1:3001`; database, cache, dan metrik tidak memiliki port publik |
| HTTPS | Domain utama aktif, alias `www` mengarah ke domain utama; sertifikat produksi dan cookie Secure/HttpOnly/SameSite=Lax sudah diverifikasi |
| Host | UFW aktif, Fail2ban SSH aktif, login SSH root/password dinonaktifkan, update keamanan dan rotasi log terpasang |
| Docker | Aturan DOCKER-USER membatasi ingress WAN; API/worker/web non-root dan memakai filesystem read-only serta batas resource |
| Database | Migrasi `0011_provider_usage`; empat akun: admin utama dan tiga akun demo |
| Rahasia | Kedua env dan kedua file kredensial berizin `600`; key aktif/JWT secret tidak ditemukan pada file Git yang dilacak atau 62 file bundle frontend |

Penggunaan RAM/CPU tersebut merupakan sampel saat pemeriksaan, bukan ukuran
kapasitas pengguna. cAdvisor tetap privileged untuk membaca metrik host dan
container; aksesnya dibatasi ke jaringan metrik internal.

## Yang masih perlu dikerjakan

Prioritas di sini adalah urutan pengerjaan untuk VPS ini, bukan penilaian CVSS.

| Urutan | Prioritas | Kekurangan | Bukti dan tindakan berikutnya |
| --- | --- | --- | --- |
| 1 | Tinggi | Pembatasan login, registrasi, dan biaya AI belum memadai | Dua belas login salah di lab tetap 401 tanpa throttling. Tidak ditemukan limiter login/registrasi pada middleware/route. Registrasi siswa/guru terbuka; budget TTS sudah ada, tetapi batas biaya global LLM/STT belum ditemukan. Tambahkan limiter per IP/akun, batas konkurensi dan penggunaan harian, serta penghentian pemakaian saat anggaran global habis. |
| 2 | Menengah | Mengganti password tidak mencabut JWT lama | Sesudah change-password 204, password lama ditolak 401, tetapi JWT lama masih berhasil mengakses identitas dengan 200. Tambahkan versi sesi atau timestamp pencabutan, termasuk saat reset admin. |
| 3 | Menengah | WebSocket tidak memvalidasi ulang akun/token pada setiap giliran | Socket yang sudah dibuka masih menghasilkan jawaban `final` sesudah akun dinonaktifkan atau JWT kedaluwarsa. Periksa status/peran/expiry setiap giliran dan tutup koneksi ketika sesi dicabut. |
| 4 | Menengah | Token query WebSocket dan potongan transkrip dapat masuk log | JWT dummy ditemukan pada query URL dalam log Uvicorn lab. Voice WS mencatat 80 karakter awal transkrip pada INFO. Redaksi query sensitif, kurangi isi percakapan dalam log, dan gunakan tiket WS singkat atau transport autentikasi yang sesuai. |
| 5 | Menengah | Role database aplikasi masih superuser | Query role produksi menunjukkan `kodmod` memiliki `rolsuper=true` dan `rolcreatedb=true`; role yang sama dipakai aplikasi dan migrasi. Pisahkan role migrasi/bootstrap dari API/worker dan batasi privilege runtime. |
| 6 | Tinggi operasional | Backup masih berada pada VPS yang sama, tanpa retensi otomatis | Snapshot lengkap dan restore database sudah lulus, tetapi kehilangan VPS juga menghilangkan backup lokal. Sediakan salinan privat offsite, retensi, dan prosedur pemulihan server baru. |
| 7 | Tinggi operasional | Alert belum mengirim notifikasi dan ambang RAM salah untuk batas container sekarang | API Grafana mengembalikan nol contact point; Prometheus tidak memiliki tujuan Alertmanager. Alert RAM container menunggu lebih dari 6 GiB, sedangkan container dibatasi 128 MiB–1,5 GiB. Tambahkan tujuan notifikasi dan alert terhadap persentase limit/OOM/restart. |
| 8 | Menengah produk | Akun demo ada, tetapi paket pembelajarannya kosong | Database produksi memiliki nol mata pelajaran, konsep, kelas, enrollment, materi, chunk kurikulum, dan draft kuis. Siapkan kelas, materi, dan skenario demo guru–siswa yang sesuai kurikulum. |
| 9 | Menengah delivery | Otomatisasi dan reproduksi rilis belum lengkap | Checkout tidak memiliki workflow GitHub Actions. Backend memakai rentang dependency tanpa lockfile; beberapa image memakai tag yang dapat berubah. Perubahan deployment masih lokal. Tambahkan pipeline, dependency lock/hash, image pinning, dan simpan perubahan server di repository yang dipakai untuk pemulihan. |
| 10 | Sebelum perluasan pengguna | Kapasitas dan penerimaan pengguna belum dibuktikan | Belum ada benchmark chat/suara serentak dengan provider nyata, evaluasi mutu tutor terhadap materi kelas nyata, atau pengujian screen reader/audio pada perangkat siswa. Tentukan skenario dan batas penerimaan sebelum menaikkan jumlah pengguna. |

### Batas biaya dan audio

Konfigurasi aktif memiliki batas TTS harian 120.000 karakter untuk akses privat
dan 10.000 untuk akses publik. Ini tidak membatasi seluruh biaya AI. Pendaftaran
akun baru juga memungkinkan seseorang memperoleh budget akun lain. Catatan
provider usage sudah tersedia, tetapi pencatatan bukan mekanisme penghentian
pemakaian global.

REST STT membatasi upload menjadi 25 MB. Pengaturan `MAX_AUDIO_SECONDS=120`
tidak diperiksa sebagai durasi audio pada route REST sebelum request ke
ElevenLabs. Voice streaming memiliki perkiraan batas byte. Periksa durasi
sebenarnya dan terapkan quota STT agar audio terkompresi yang panjang tidak
melewati batas waktu yang dimaksud.

Rujukan: [middleware API](/home/kodmod-admin/kodmod-ai/apps/ai-engine/api/main.py:117),
[login/registrasi](/home/kodmod-admin/kodmod-ai/apps/ai-engine/api/routes/auth.py:52),
dan [upload STT](/home/kodmod-admin/kodmod-ai/apps/ai-engine/api/routes/voice.py:133).
Komentar pada voice WebSocket menyebut token bucket di
`api/middleware/rate_limit.py`, tetapi file dan implementasinya tidak ditemukan.

### Pencabutan sesi dan WebSocket

JWT aktif berlaku 1.440 menit. Validasi REST memeriksa expiry, keberadaan akun,
status aktif, dan kesesuaian role, tetapi tidak memeriksa apakah password
berubah setelah token diterbitkan. Akun yang dinonaktifkan ditolak oleh REST;
masalah WebSocket terjadi pada koneksi yang telah lolos autentikasi sebelumnya.

Empat probe dilakukan hanya pada database dan API sementara dengan key
provider stub. Tidak ada akun produksi yang dinonaktifkan, password produksi
yang diganti, atau serangan login massal terhadap domain publik.

| Probe | Hasil teramati |
| --- | --- |
| Login salah berulang | 12 request, seluruhnya 401, tanpa 429 |
| Password berubah | Password lama 401; token lama `/auth/me` 200 |
| Akun dinonaktifkan sesudah WS dibuka | REST 403; WS masih menyelesaikan satu giliran |
| Token kedaluwarsa sesudah WS dibuka | REST 401; WS masih menyelesaikan satu giliran |

Rujukan: [validasi akun](/home/kodmod-admin/kodmod-ai/apps/ai-engine/api/dependencies.py:64),
[change-password](/home/kodmod-admin/kodmod-ai/apps/ai-engine/api/routes/auth.py:159),
[chat WS](/home/kodmod-admin/kodmod-ai/apps/ai-engine/api/websockets/chat_stream.py:83),
dan [voice WS](/home/kodmod-admin/kodmod-ai/apps/ai-engine/api/websockets/voice_stream.py:47).
Reset password admin memiliki pola penyimpanan yang sama menurut pembacaan
source; probe runtime terpisah untuk reset admin tidak dilakukan.

Eksposur token/transkrip log bergantung pada akses ke log. Ini bukan bukti
bahwa pengunjung tanpa autentikasi bisa membaca log server. Tambahkan deteksi
JWT dalam query URL ke tes higiene log yang sekarang ada.

Untuk pemisahan role database, sertakan kebutuhan bootstrap tabel LangGraph
dalam rancangan migrasi. Pengurangan privilege perlu memverifikasi startup,
worker, checkpoint, dan restore; jangan langsung mengganti kredensial runtime.

### Materi dan skenario demo

Seeder akun sudah dijalankan dan login ketiga akun berhasil. Guru dapat membuat
mata pelajaran, konsep, kelas, dan materi melalui fitur yang tersedia. Seeder
kurikulum contoh juga ada, tetapi tidak dijalankan otomatis pada produksi.
Pilih konten yang sesuai sebelum mengisi lingkungan publik.

Satu learning session yang ada adalah sesi chat uji provider yang sudah ditutup.
Tes kuis bersumber sebelumnya menggunakan fixture teks dalam memori. Pengujian
tersebut belum membuktikan retrieval dan kuis terhadap dokumen kelas nyata di
VPS. Alur materi, editorial, otorisasi, dan transaksi telah diuji memakai fixture
terisolasi; PDF uji opsional tidak tersedia pada checkout ini.

### Backup dan monitoring

Snapshot lengkap terbaru:
`/srv/kodmod/backups/kodmod-20261005T170449Z-30271`, dibuat 6 Oktober sekitar
00:04 WIB. Empat checksum arsip lulus; konfigurasi yang diarsipkan cocok dengan
kedua env, password admin, dan kredensial demo saat ini. Dump snapshot tersebut
berhasil direstore di container PostgreSQL sementara tanpa jaringan: empat
akun dan migrasi `0011_provider_usage` tetap utuh. Container restore dihapus;
database produksi tidak menjadi target restore.

Dua snapshot sebelumnya juga lolos pemeriksaan checksum/arsip. Snapshot penuh
menghentikan web/API/worker sebentar untuk konsistensi, lalu menghidupkan kembali
container yang sama. Setelah snapshot terbaru, healthcheck, smoke HTTPS, dan
monitoring kembali lulus. Jendela pemeliharaan dapat membesar ketika media
bertambah; ukur durasinya dan gunakan strategi backup yang sesuai.

Timer pertama dijadwalkan 6 Oktober 2026 sekitar 03:18 WIB. Timer sudah enabled,
tetapi eksekusi terjadwal pertamanya belum terjadi saat laporan dibuat.
Restore database membuktikan dump dapat digunakan; pemulihan seluruh VPS baru,
media, konfigurasi host, dan pengiriman backup offsite belum diuji.

Rujukan ambang RAM:
[prometheus-alerts.yml](/home/kodmod-admin/kodmod-ai/infra/docker/prometheus-alerts.yml:40).
Saat ini lima aturan alert dan tujuh panel dashboard berfungsi, tetapi belum
ada tujuan pengiriman notifikasi. Sistem masih perlu memberi tahu operator
tentang backup gagal, ruang disk, OOM/restart, layanan down, dan penggunaan API.

## Perbaikan yang sudah dilakukan dalam pemeriksaan ini

1. **URL metrik terenkode ditutup.** Sebelumnya `/api/metrics%2F` mengembalikan
   Prometheus metrics kepada request tanpa autentikasi. Matcher Caddy kini
   memblokir namespace `/metrics*` dan `/api/metrics*`, sudah divalidasi dan
   direload pada runtime. Enam belas variasi URL publik semuanya 404. Smoke
   check mencakup empat bentuk plain/encoded; scrape internal tetap berfungsi.
2. **UFW diaktifkan untuk boot.** Firewall aktif, tetapi unit systemd sebelumnya
   disabled. Unit sekarang enabled, dan helper firewall memastikan state itu.
   Aturan SSH/HTTP/HTTPS tetap tersedia. Pemeriksaan ini tidak melakukan reboot VPS.
3. **Format seeder diperbaiki.** Ruff menemukan format pada perubahan seeder
   sebelumnya. Perubahan hanya format; kesetaraan AST diverifikasi. Tidak ada
   reseeding atau reset password produksi dalam pemeriksaan ini.
4. **Mock JSX pada tes bahasa diperbaiki.** Pada Node 22.23.3, runtime JSX React
   asli mencoba memuat mock React beralamat data sebagai file CommonJS dan
   gagal ENOENT. Mock JSX kini berada dalam boundary tes yang sama; semua
   assertion tentang penyimpanan bahasa, event, dan kegagalan tetap dipertahankan.

Rujukan perbaikan: [Caddyfile](/home/kodmod-admin/kodmod-ai/infra/docker/Caddyfile:16),
[smoke check](/home/kodmod-admin/kodmod-ai/scripts/check-docker.mjs:131),
dan [helper firewall](/home/kodmod-admin/kodmod-ai/scripts/vps-firewall.sh:15).

## Hasil pengujian dan dependency

| Pemeriksaan | Hasil |
| --- | --- |
| Backend utama | Awalnya 805 lulus, 1 kegagalan format, 9 skip |
| Fuzzing | 348 lulus |
| Tes tambahan/ulang backend | 6 lulus: format, 4 transaksi PostgreSQL, higiene log |
| Backend unik, hasil akhir gabungan | **1.159 lulus, 0 gagal, 4 skip** |
| Frontend utama dengan fixture API/Next | Awalnya 138 lulus, 1 kegagalan mock, 2 skip |
| Editorial melalui proxy Next nyata | 2 lulus, menggantikan 2 skip |
| Tes bahasa setelah perbaikan mock | 1 lulus, menggantikan kegagalan sebelumnya |
| Frontend, hasil akhir gabungan | **141 lulus, 0 gagal** |
| Lint/format/typecheck | Backend lulus; lint/typecheck frontend lulus, termasuk lint sesudah perubahan tes |
| Build frontend | Lulus pada Node 22 dengan `npm ci` |
| Compose | Topologi produksi lulus; konfigurasi test/default, load, dan qdrant lulus terpisah pada host |
| HTTPS smoke / monitoring setelah snapshot | **14 / 14** dan **26 / 26** lulus |
| Sampel liveness/readiness HTTPS | 30/30 valid dengan 5 koneksi paralel; p95 sekitar 202 ms dari VPS yang sama, tanpa panggilan provider |
| Provider nyata, pemeriksaan sebelumnya pada 5 Oktober | **16 / 16** lulus: enam peran OpenAI, embedding, TTS ID/EN/cache, STT, chat HTTPS, receipt usage |
| Audit Python runtime | 100 paket terpasang, tidak ditemukan advisory yang dikenal oleh pip-audit |
| Audit npm runtime | Tidak ditemukan advisory oleh audit `--omit=dev` |
| Audit npm termasuk tooling | 5 paket high terdampak 1 advisory `braces` |

Angka gabungan memakai hasil terakhir per tes; bukan satu run penuh baru.
Empat skip backend terdiri dari satu pengujian PDF opsional dan tiga kasus
Compose yang tidak mendapat Docker daemon di dalam runner. Tiga konfigurasi
Compose tersebut telah diperiksa terpisah dengan CLI host. Dua kasus slow
untuk build image backend/stub dari awal tidak dijalankan; image review backend
diturunkan dari image produksi dengan versi paket runtime yang dipertahankan.

Kelima paket tooling adalah `braces`, `micromatch`, `fast-glob`,
`@next/eslint-plugin-next`, dan `eslint-config-next`. Mereka terhubung ke
advisory denial of service melalui pola brace bersarang. Advisory resmi belum
mencantumkan versi patched; jangan menerapkan downgrade besar dari
`npm audit fix --force` tanpa pemeriksaan kompatibilitas.
[GitHub Advisory GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).

Audit dependency ini tidak mencakup seluruh paket OS dalam image atau
dependency vendored yang tidak tercatat oleh package manager.

## Bukti dan batas pemeriksaan

Hasil terperinci, JUnit, probe redacted, dan log terisolasi disimpan privat di
`/home/kodmod-admin/kodmod-ai/.runtime/vps-review-20261005/results/`.
Ringkasan utama: `test-summary.json`, `security-probes.json`,
`full-backup-restore-final.json`, `secret-storage.json`, `public-metrics.json`,
`smoke-final.log`, dan `monitoring-final.log`. File ini diabaikan Git.
Snapshot konfigurasi dan log tetap merupakan artefak privat.

Semua container, network, volume database, dan tag image khusus review sudah
dihapus. Fixture pengujian tidak dimasukkan ke database produksi. Tidak ada
push atau PR yang dibuat untuk perubahan lokal pada pemeriksaan ini.

Ini laporan operasi dan pemeriksaan manual, bukan hasil scan resmi Codex
Security. Tool MCP untuk memulai/menyimpan scan resmi tidak tersedia. Aturan
skill [security-scan](/home/kodmod-admin/.codex/plugins/cache/openai-curated-remote/codex-security/0.1.31/skills/security-scan/SKILL.md)
beserta [artifact storage](/home/kodmod-admin/.codex/plugins/cache/openai-curated-remote/codex-security/0.1.31/references/artifact-storage.md:7)
menyatakan: “report the blocker; do not fall back to shell-authored canonical files.”
Tidak dibuat scan ID atau artefak canonical untuk menggantikan tool tersebut.

Belum dicakup: scan keamanan resmi menyeluruh, benchmark kapasitas AI nyata,
pemulihan VPS dari nol, eksekusi timer otomatis pertama, dokumen kurikulum
nyata dengan provider pada jalur RAG/kuis produksi, evaluasi pedagogi,
dan aksesibilitas/audio pada browser serta perangkat siswa.

# Menjalankan KODMOD dengan Docker dan deploy ke VPS

## Runtime yang dipakai

Semua proses aplikasi berjalan dalam Docker: **Next.js web → FastAPI/LangGraph → PostgreSQL + pgvector dan Redis**, serta worker terpisah untuk impor/OCR/indeks. Service `migrate` menjalankan Alembic sebelum API dan worker mulai. OpenAI dan ElevenLabs tetap layanan eksternal yang dipanggil oleh backend. Browser dan screen reader perangkat berjalan di perangkat pengguna.

Profil `monitoring` menambahkan Prometheus, Grafana, dan cAdvisor. Prometheus menyimpan metrik selama maksimal 30 hari atau 5 GB, serta mengambil sampel tiap 15 detik. Profil `monitoring-linux` menambahkan node-exporter untuk CPU, RAM, dan filesystem host Linux. Grafana memuat dashboard KODMOD secara otomatis. Prometheus dan exporter hanya dapat dijangkau pada jaringan Compose; Grafana hanya bind ke `127.0.0.1:3001`.

Image default menggunakan OpenAI LLM/embedding dan ElevenLabs STT/TTS. Tidak membutuhkan CUDA, GPU, Whisper lokal, Qdrant, ataupun download model reranker. LangChain dan LangGraph tetap terpasang. Docker lokal menjalankan hasil build, sehingga perubahan source perlu rebuild; ini bukan server hot reload.

## Lokal Windows, Docker Centre yang sudah ada

Dari `C:\laragon\www\kodmod`, setelah Docker Desktop aktif:

```powershell
pwsh -NoProfile -File .\scripts\docker.ps1 up
pwsh -NoProfile -File .\scripts\docker.ps1 status
```

Alias dari root repository: `npm run docker:up`, `npm run docker:status`,
`npm run docker:logs`, dan `npm run docker:down`. Di Windows alias memakai
script Docker Centre yang sama, sehingga tidak membuat project/database duplikat.

Script memakai project `kodmod-centre` dan override di `F:\Docker_Centre\kodmod` jika konfigurasi tersebut menunjuk checkout ini. Data PostgreSQL, Redis, audio, unggahan, dan metrik tetap di direktori `data` Docker Centre. Script akan menolak checkout yang berbeda agar tidak memakai database proyek lain tanpa sengaja. Saat monitoring pertama kali dijalankan, script membuat password Grafana acak di file privat `F:\Docker_Centre\kodmod\.env` dan menyiapkan folder metrik. `F:\Docker_Centre\kodmod\docker.ps1 up` juga memanggil script repository ini.

API, worker, dan migrasi harus memakai mount audio/unggahan yang sama. Template pemulihan konfigurasi: `infra/docker/compose.centre.example.yaml`. Worker memakai lease/heartbeat dan retry SQL; pekerjaan yang berhenti dapat diklaim ulang tanpa memerlukan halaman browser tetap terbuka.

- Web: `http://localhost:3100`.
- API lokal: `http://127.0.0.1:8109`; probes `/live` dan `/ready`.
- Grafana: `http://localhost:3001`, username `admin`; lihat password privat dengan `(Select-String -Path 'F:\Docker_Centre\kodmod\.env' -Pattern '^GRAFANA_ADMIN_PASSWORD=').Line.Split('=',2)[1]`.
- Prometheus: hanya jaringan internal Docker, tidak ada port publik/host.
- PostgreSQL: `127.0.0.1:5433`; Redis: `127.0.0.1:6379`.
- Antarkontainer memakai `ai-engine:8000`, `postgres:5432`, dan `redis:6379`.
- Migrasi otomatis menuju Alembic `head` pada checkout yang dibangun. Tidak memakai `database/schema.sql` lama.
- `down` menghentikan stack dan mempertahankan data. Jangan menambahkan `-v` untuk database yang diperlukan.

Perintah lain: `build`, `backup`, `logs`, `migrate`, `infra` (hanya database/cache), `qdrant` (opsional), `monitoring-up`, `monitoring-status`, `monitoring-logs`, dan `monitoring-down`. `api` menjadi alias `up` untuk kompatibilitas script lama. Menghentikan monitoring tidak menghapus data metrik.

Docker Desktop menjalankan container Linux di VM WSL2. cAdvisor mengukur container di Docker; node-exporter hanya aktif pada Linux VPS sehingga grafik host lokal Windows tidak ditampilkan. Tunnel ngrok KODMOD tetap hanya melayani aplikasi di port 3100, bukan Grafana.

`up`, `api`, dan `migrate` menunggu PostgreSQL sehat lalu membuat backup custom-format sebelum migrasi. Jika dump, validasi arsip, atau salinan gagal, pembaruan dibatalkan. Backup dan manifest SHA-256 berada di `F:\Docker_Centre\kodmod\backups` (atau `.runtime/backups` tanpa Docker Centre). Perintah `backup` hanya membuat backup; tidak mengubah schema atau isi database.

```powershell
pwsh -NoProfile -File .\scripts\docker.ps1 backup
```

Dump ini melindungi database. Audio dan original unggahan tetap membutuhkan backup volume terpisah. Arsip berisi data aplikasi; simpan di lokasi privat di luar Git.

Tanpa Docker Centre, dari root repository:

```bash
cp apps/ai-engine/.env.example apps/ai-engine/.env
# Isi konfigurasi backend dahulu.
docker compose --profile monitoring up -d --build --wait
docker compose ps --all
```

Docker lokal membutuhkan `.env` backend. API key tidak dimasukkan ke image maupun web. Isi `OPENAI_API_KEY`, enam `LLM_*_MODEL`, `ELEVENLABS_API_KEY`, dan `JWT_SECRET` acak yang kuat. Pilih ID model yang tersedia pada akun OpenAI. Preset Bian, Multilingual v2, serta Scribe v2 sudah disediakan. Jangan mengganti `.env` lokal yang sudah berisi key dengan file contoh.

### Akun admin pertama

Tidak ada akun dummy bawaan pada database nyata. Jalankan interaktif untuk admin pertama. Siswa dan guru dapat mendaftar langsung; tidak membutuhkan kode undangan:

```powershell
npm run docker:admin
```

Perintah tersebut memakai username `admin` dan meminta password dua kali.
Untuk username berbeda, jalankan perintah lengkap berikut:

```powershell
# Docker Centre:
& "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin\docker.exe" compose `
  --project-name kodmod-centre --env-file F:\Docker_Centre\kodmod\.env `
  -f docker-compose.yml -f F:\Docker_Centre\kodmod\compose.override.yaml `
  exec ai-engine python -m scripts.create_admin --username admin
```

Password diminta di terminal dan tidak ditulis pada command. Script ini juga mereset password jika username tersebut sudah merupakan admin; gunakan username yang dimaksud. Setelah itu buka `/masuk`.

### Akun demo opsional

Untuk pengujian lokal, jalankan dari PowerShell:

```powershell
pwsh -NoProfile -File F:\Docker_Centre\kodmod\docker.ps1 demo-users
```

Seeder membuat atau mereset password untuk `siswa.demo` (student), `guru.demo` (teacher), dan `admin.demo` (admin) menjadi `password`. Menjalankan ulang menjaga ketiga akun demo tetap bisa dipakai dengan kredensial yang sama. Seeder tidak mengubah pengguna lain, termasuk `baysatriow`. Password ini hanya untuk database pengujian lokal; jangan gunakan pada database produksi atau saat membagikan tunnel publik.

Pada VPS publik gunakan `sudo bash scripts/seed-demo-vps.sh` dari checkout
server. Helper menjalankan seeder dengan `--passwords-stdin` dan password
acak berbeda untuk setiap akun. Kredensial berada pada file privat
`.runtime/demo-accounts.json`; lihat [akun demo VPS](VPS_SETUP.md#akun-demo-pada-vps).

## VPS Linux

Untuk server yang sudah dipasang, mode privat sebelum domain tersedia,
konfigurasi provider, firewall Docker, backup harian, dan aktivasi HTTPS,
lihat [runbook VPS](VPS_SETUP.md). `scripts/release.sh` membaca
`KODMOD_MODE=private|https` dari root `.env`.

Konfigurasi utama: `infra/docker/docker-compose.prod.yml`. Entry lama `apps/ai-engine/docker/docker-compose.prod.yml` hanya meneruskan ke konfigurasi tersebut.

1. Pasang Docker Engine dan Compose plugin sesuai dokumentasi distro VPS, lalu clone repository ke direktori deploy.
2. Arahkan DNS domain ke IP VPS dan CNAME `www` ke domain utama; Caddy mengalihkan alias `www` ke domain utama. Buka port TCP 80/443 dan port SSH yang dipakai. Jika ada AAAA, pastikan IPv6 benar-benar menuju VPS.
3. Dari root repository, salin `.env.example` ke `.env` serta contoh backend ke `apps/ai-engine/.env`. Jangan membawa kredensial demo/database lokal ke VPS.
4. Isi root `.env`: `APP_DOMAIN` (tanpa `https://`), `DB_PASSWORD` dan `REDIS_PASSWORD` unik, `GRAFANA_ADMIN_PASSWORD` acak, serta `MONITORING_DATA_ROOT` sebagai path Linux absolut yang persisten, misalnya `/srv/kodmod/data/monitoring`. `ACME_EMAIL` opsional dan disarankan untuk kontak sertifikat. Generate password berbentuk hex agar aman dipakai pada URL database. Backend membaca password database/cache yang sama dari Compose override; root `.env` menjadi sumbernya.
5. Isi backend `.env`: `JWT_SECRET` acak minimal 32 byte, API key provider, dan enam ID model. Gunakan `STT_BACKEND=elevenlabs`, `TTS_BACKEND=elevenlabs`, serta `CHECKPOINTER=postgres`. Lindungi kedua file: `chmod 600 .env apps/ai-engine/.env`.
6. Siapkan kepemilikan direktori metrik, validasi, lalu jalankan:

```bash
sudo bash scripts/prepare-monitoring-data.sh
docker compose --profile monitoring --profile monitoring-linux --env-file .env -f infra/docker/docker-compose.prod.yml config --quiet
docker compose --profile monitoring --profile monitoring-linux --env-file .env -f infra/docker/docker-compose.prod.yml up -d --build --wait
docker compose --profile monitoring --profile monitoring-linux --env-file .env -f infra/docker/docker-compose.prod.yml ps --all
docker compose --profile monitoring --profile monitoring-linux --env-file .env -f infra/docker/docker-compose.prod.yml exec ai-engine python -m scripts.create_admin --username admin
```

Hanya Caddy yang membuka port publik 80/443. Port Grafana terikat pada loopback VPS; Prometheus, node-exporter, dan cAdvisor tetap pada jaringan internal. Untuk membuka Grafana dari laptop tanpa mempublikasikannya, jalankan `ssh -L 3001:127.0.0.1:3001 USER@IP_VPS`, lalu buka `http://localhost:3001`. Ganti `USER` dan `IP_VPS` sesuai server. Caddy mengurus sertifikat HTTPS, meneruskan halaman dan `/api/*` ke Next.js, serta `/ws/*` ke FastAPI. Cookie sesi pada VPS memakai `Secure`; override `SESSION_COOKIE_SECURE=false` hanya digunakan Docker lokal HTTP.

Username Grafana mengikuti `GRAFANA_ADMIN_USER` (default `admin`); password awal berasal dari `GRAFANA_ADMIN_PASSWORD`. Simpan `.env` dengan izin `600`. Folder Prometheus dimiliki UID/GID `65534:65534`, folder Grafana UID/GID `472:0`; script persiapan di atas mengatur kepemilikan itu tanpa membaca/mengekspor rahasia lain dari `.env`.

Image frontend memakai Next.js standalone dengan tracing monorepo. `API_ORIGIN=http://ai-engine:8000` sama saat build/runtime karena fallback rewrite dikompilasi saat build. Ganti alamat itu hanya dengan rebuild. Browser tetap memakai URL aplikasi `/api`; tidak memerlukan alamat container atau provider key.

Setup VPS privat tanpa domain dijelaskan pada runbook VPS. Domain, DNS, TLS,
panggilan provider nyata dan kapasitas di bawah beban tetap perlu diverifikasi
sebelum peluncuran publik. Mulai dengan satu instance API dan satu worker;
ukur memori, latency dan konkurensi sebelum menambah replika. Tesseract
Indonesia/Inggris tersedia pada image worker. Cache audio dan original
dokumen tersimpan dalam volume privat.

Tooling rilis dari root repository di VPS:

```bash
bash scripts/release.sh check
# Build, backup terverifikasi, migrasi, lalu tunggu seluruh runtime sehat:
bash scripts/release.sh deploy TAG_RILIS_UNIK
bash scripts/release.sh smoke
```

`check` memvalidasi service, ketergantungan migrasi, mount bersama dan port privat tanpa mencetak env. `backup` dapat dijalankan tersendiri. Atur `KODMOD_BACKUP_DIR` ke direktori backup privat. Tool rilis tidak menjalankan downgrade otomatis atau menimpa `.env`.

### Backup dan pembaruan

Simpan backup di luar VPS, termasuk database, volume `kodmod-audio`/`kodmod-uploads`, serta konfigurasi privat secara terpisah. Jangan menyimpan backup berisi data siswa dalam Git.

Contoh dump PostgreSQL dari root repository, dengan direktori backup yang sudah dibatasi aksesnya:

```bash
docker compose --env-file .env -f infra/docker/docker-compose.prod.yml exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > /secure-backup/kodmod.dump
```

Uji restore pada database terpisah sebelum mengandalkan backup. Untuk snapshot audio/unggahan yang konsisten, hentikan web/API/worker sebentar sebelum menyalin volume. `docker compose down` mempertahankan named volumes; penghapusan volume menghapus data.

Pemeriksaan restore lokal menerima arsip dengan manifest SHA256 dari script backup dan hanya boleh memakai container PostgreSQL tes pada port 5434. Database sementara yang dibuat di sana dihapus setelah pemeriksaan; database aplikasi pada 5433 tidak menjadi target restore:

```powershell
pwsh -NoProfile -File .\scripts\check-backup-restore.ps1 -BackupPath 'F:\Docker_Centre\kodmod\backups\NAMA_BACKUP.dump'
```

Database tes menggunakan `kodmod_test` dan port 5434, Redis tes 6380, provider stub 8099. Entrypoint tes menolak nama database aplikasi. Isolasi ini tetap diperlukan ketika menguji provider asli.

### Pencatatan penggunaan dan biaya

Panel pemantauan AI mencatat token yang dilaporkan model/embedding, volume suara, cache, latensi dan status. Tidak mencatat isi percakapan atau API key. Tarif opsional di backend `PROVIDER_PRICES_JSON` menghasilkan estimasi USD; nilai yang tidak diketahui tampil sebagai belum tersedia. Pantau `kodmod_provider_usage_dropped_total` untuk kegagalan penyimpanan metadata. Angka lokal bukan pengganti tagihan resmi penyedia.

Sebelum update: backup, review migration, simpan commit/image tag sebelumnya, lalu `git pull --ff-only` dan jalankan `up -d --build --wait` dengan konfigurasi produksi yang sama. Gunakan `KODMOD_TAG` unik untuk menyimpan image rilis; default `vps` akan ditimpa build berikutnya. Jangan menjalankan migrasi downgrade otomatis sebagai rollback pada database siswa.

### Reranker lokal opsional

Jika dibutuhkan, set `INSTALL_RERANKER=true` dan `RAG_RERANK_ENABLED=true` pada env Compose, lalu rebuild API. Ini memasang PyTorch CPU dan sentence-transformers; pemakaian pertama mengunduh model dan meningkatkan kebutuhan disk/memori. Varian ini belum diuji build pada delivery Docker default. Untuk lingkungan Python native: `pip install -e ".[dev,reranker]"`. RAG tanpa reranker tetap memakai OpenAI embeddings dan pgvector similarity retrieval.

## Acceptance setelah stack sehat

Pemeriksaan HTTP dasar yang dapat diulang: `node scripts/check-docker.mjs`
dari root. Default memakai web 3100/API 8109; untuk host lain atur
`DOCKER_WEB_ORIGIN` dan `DOCKER_API_ORIGIN`. Script hanya membaca halaman,
aset, probes dan penolakan akses tanpa login, tanpa membuat akun atau memanggil provider.
Hasil delivery lokal: [validasi Docker](docker-validation-2026-10-04.md).

Healthcheck membuktikan proses/jaringan dasar, bukan kualitas tutoring. Acceptance utama: guru→kelas/mata pelajaran→unggah dokumen→review teks/OCR/halaman→review konsep→terbit→indeks ready; siswa→pilih materi→pengajaran→tanya jawab→lanjut atau mini kuis→hasil/progres. Asesmen mandiri dan kuis guru memiliki siklus terpisah. Kuis guru melewati review/publikasi/penugasan; jawaban tersimpan dapat dilanjutkan setelah reload atau keluar sementara. Matikan/restart worker untuk memeriksa recovery pekerjaan pada database tes.

Uji Bian TTS, Scribe STT, bahasa Indonesia/Inggris, izin mikrofon, cache suara, retry provider, serta satu suara aktif. Pemeriksaan klik/visual/NVDA/TalkBack/VoiceOver dan low vision di perangkat nyata dilakukan pengguna. Pengujian otomatis memakai kode/API; keberhasilan build atau fixture bukan bukti acceptance perangkat atau deploy VPS.

Sumber konfigurasi: [Next.js standalone](https://nextjs.org/docs/app/api-reference/config/next-config-js/output), [Docker Compose startup order](https://docs.docker.com/compose/how-tos/startup-order/), [Compose production](https://docs.docker.com/compose/how-tos/production/).

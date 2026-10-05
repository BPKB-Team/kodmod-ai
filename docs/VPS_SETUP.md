# KODMOD pada VPS Ubuntu

Checkout server: `/home/kodmod-admin/kodmod-ai`, project Compose `kodmod`.
Data aplikasi memakai named volumes; monitoring berada di
`/srv/kodmod/data/monitoring`. Jangan memakai Compose lokal Windows pada VPS.

## Konfigurasi privat

Edit `/home/kodmod-admin/kodmod-ai/apps/ai-engine/.env` untuk provider:

```dotenv
OPENAI_API_KEY=
ELEVENLABS_API_KEY=
LLM_ROUTER_MODEL=SET_ME_IN_ENV
LLM_TUTOR_MODEL=SET_ME_IN_ENV
LLM_QUIZ_MODEL=SET_ME_IN_ENV
LLM_SCORING_MODEL=SET_ME_IN_ENV
LLM_RECOMMENDATION_MODEL=SET_ME_IN_ENV
LLM_REFLECTION_MODEL=SET_ME_IN_ENV
```

Ganti keenam ID model dengan model yang tersedia di akun OpenAI Anda.
Key belum diisi pada setup awal; pemeriksaan health tidak memanggil provider.
Fitur AI/suara perlu konfigurasi provider dan pengujian tersendiri.
Preset Bian, `eleven_multilingual_v2`, dan `scribe_v2` mengikuti konfigurasi repo.

Root `.env` menyimpan mode akses, tag image, password PostgreSQL/Redis/Grafana,
serta konfigurasi domain. JWT ada di env backend. Semua rahasia server dibuat
acak, berbeda dari Docker lokal, dan file env memiliki izin `600`.
Jangan menimpa password database yang sudah memiliki data.

Setelah mengedit key/model, terapkan tanpa rebuild:

```bash
cd /home/kodmod-admin/kodmod-ai
sudo bash scripts/release.sh compose up -d --no-deps ai-engine worker
sudo bash scripts/release.sh smoke
```

## Akses sebelum domain tersedia

`KODMOD_MODE=private` pada root `.env` menggunakan konfigurasi produksi ditambah
`infra/docker/docker-compose.private.yml`. Caddy dinonaktifkan. Web/API/Grafana
hanya bind pada loopback; PostgreSQL/Redis/Prometheus/exporter tidak memiliki
port host. Cookie HTTP hanya digunakan pada akses localhost melalui SSH.

Dari laptop, gunakan identitas SSH yang sama dengan login VPS:

```bash
ssh -N -L 3100:127.0.0.1:3100 -L 3001:127.0.0.1:3001 kodmod-admin@139.190.100.215
```

Jika key belum dikonfigurasi di SSH client, tambahkan `-i PATH_KEY.pem`.
Pada laptop Windows yang dipakai untuk setup ini:

```powershell
ssh -i "$env:USERPROFILE\.ssh\kodmod_ai_key.pem" -N -L 3100:127.0.0.1:3100 -L 3001:127.0.0.1:3001 kodmod-admin@139.190.100.215
```

Buka aplikasi di `http://localhost:3100` dan Grafana di
`http://localhost:3001`. Username awal keduanya `admin`.
Password aplikasi ada di `.runtime/admin-password`; password Grafana adalah
`GRAFANA_ADMIN_PASSWORD` pada root `.env`. Baca hanya melalui sesi privat.
Tidak ada akun demo dengan password `password` pada database VPS.

## Operasi

```bash
cd /home/kodmod-admin/kodmod-ai
sudo bash scripts/release.sh check
sudo bash scripts/release.sh compose ps --all
sudo bash scripts/release.sh compose logs --tail 100 ai-engine worker
sudo bash scripts/release.sh smoke
sudo node scripts/check-monitoring.mjs
```

Unit `kodmod.service` memastikan stack menggunakan mode dan tag dari `.env`
saat boot. Container memakai restart policy; Docker aktif saat boot.

Host memakai SSH key, login root/password SSH dinonaktifkan, UFW, Fail2ban,
update keamanan Ubuntu tanpa reboot otomatis, log Docker berotasi, dan swap
2 GiB. Firewall `DOCKER-USER` memblokir koneksi WAN baru ke container pada mode
privat, termasuk jika port tak sengaja dipublikasikan. Hook Docker menerapkan
kembali aturan setelah daemon dimulai. Database/cache dan metrik memakai
jaringan internal terpisah. API/worker/web memakai user non-root, filesystem
read-only dan batas RAM/CPU/proses. cAdvisor tetap memerlukan akses host luas;
aksesnya hanya melalui jaringan metrik internal.

Prometheus dibatasi 14 hari atau 2 GB pada VPS ini. Batas resource bukan hasil
uji beban pengguna; ukur penggunaan nyata sebelum menaikkan konkurensi.

## Backup

`kodmod-backup.timer` membuat snapshot privat setiap hari antara 03:15–03:25
Asia/Jakarta. Web/API/worker dihentikan sementara untuk konsistensi lalu
dijalankan kembali, termasuk jika proses backup gagal. Snapshot meliputi dump
PostgreSQL, audio, unggahan, dan konfigurasi privat; checksum serta daftar
arsip diperiksa sebelum ditandai `COMPLETE`.

```bash
sudo systemctl start kodmod-backup.service
sudo systemctl list-timers kodmod-backup.timer
sudo journalctl -u kodmod-backup.service --no-pager -n 50
sudo ls -la /srv/kodmod/backups
```

Backup lokal tidak melindungi dari kehilangan VPS. Salin snapshot lengkap ke
penyimpanan privat di luar VPS; arsip konfigurasi berisi rahasia. Tidak ada
tujuan offsite atau penghapusan backup lama otomatis yang dikonfigurasi.
Pantau pemakaian disk dan atur retensi setelah tujuan offsite tersedia.

## Aktifkan HTTPS setelah domain disetujui

1. Arahkan record A ke IP VPS. Jangan menambahkan AAAA tanpa konektivitas IPv6.
2. Edit root `.env`: `KODMOD_MODE=https`, `APP_DOMAIN=domain-anda`, dan
   `ACME_EMAIL=email-anda`. Domain tidak memakai skema atau slash.
3. Dari checkout server:

```bash
sudo bash scripts/release.sh check
sudo bash scripts/vps-firewall.sh https
sudo systemctl restart kodmod.service
sudo bash scripts/release.sh smoke
```

Mode HTTPS menghapus port host web/API dan mengaktifkan Caddy di 80/443.
Cookie menjadi Secure; Grafana tetap privat. Project dan volume tetap sama,
sehingga data dari mode privat dipertahankan. Caddy memberi header keamanan
dan menolak akses publik ke metrik. Sertifikat/DNS belum diverifikasi pada
setup privat ini.

## Pembaruan kode

Review perubahan checkout dan lakukan backup sebelum menarik perubahan.
Jangan menimpa perubahan deployment lokal dengan `git reset --hard`.
Gunakan tag image unik untuk rilis berikutnya:

```bash
sudo bash scripts/backup-vps.sh
sudo bash scripts/release.sh deploy TAG_RILIS_UNIK
sudo bash scripts/release.sh smoke
```

Tool deployment membuat backup database sebelum migrasi dan menyimpan tag
image yang berhasil ke `.env`. Tidak ada downgrade database otomatis.
Backup dan deployment memakai lock yang sama agar tidak berjalan bersamaan.

## Validasi VPS, 5 Oktober 2026

Source aplikasi di-clone lewat `gh` dari `main` pada `d4a983f`, termasuk
perbaikan warning backend yang sudah merged. Docker Engine `29.8.2` dan
Compose `5.6.0` dipasang dari repository resmi Docker.

- Sembilan service runtime aktif; migrator selesai dengan exit `0`.
- Smoke HTTP aplikasi/API: 13/13 lulus.
- Pemeriksaan monitoring, target, dashboard dan Grafana: 26/26 lulus.
- Login admin acak, identitas API, halaman admin, penolakan password default,
  dan pembatasan CORS diverifikasi.
- Snapshot lengkap berhasil dan checksum keempat arsip valid. Dump berhasil
  direstore pada PostgreSQL sementara dengan `--network none`; revisi
  `0011_provider_usage` dan satu akun admin dipertahankan. Container tes
  dihapus setelah pemeriksaan; database aplikasi tidak menjadi target restore.
- Startup Docker/stack dan penerapan ulang firewall diperiksa melalui restart
  service, tanpa reboot VPS.
- Konfigurasi Compose HTTPS dan Caddy valid; penerbitan sertifikat belum diuji
  karena domain belum tersedia. Provider nyata dan beban pengguna belum diuji.

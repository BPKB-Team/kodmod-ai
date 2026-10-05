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
Key belum diisi pada setup awal; pengguna telah mengisinya dan konfigurasi
API/worker sudah sesuai file privat pada 5 Oktober 2026. Keenam peran memakai
`gpt-6-luna`. Pemeriksaan health tidak memanggil provider; hasil pengujian
provider nyata dicatat di bawah.
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

### Pengujian provider nyata, 5 Oktober 2026

Pengujian memakai kode Python dan request HTTPS, sesuai pilihan pengguna.
Sebanyak 16/16 pemeriksaan lulus, menggunakan key dari backend VPS:

- OpenAI: klasifikasi intent, tutor Indonesia/Inggris, dua MCQ dengan empat
  opsi dan sumber yang valid, penilaian rubrik, rekomendasi, serta refleksi.
  Keenam peran diuji melalui factory/agent aplikasi dengan `gpt-6-luna`.
- Embedding `text-embedding-3-small`: dua vektor valid, masing-masing 1536
  dimensi, bernilai finite dan bukan vektor nol.
- ElevenLabs: Bian membuat MP3 Indonesia/Inggris yang berhasil didekode.
  Request berulang memakai audio cache; Scribe v2 membaca kembali frasa
  Indonesia dari audio uji dengan benar.
- Akun `siswa.demo` berhasil login dan mengirim chat melalui proxy HTTPS.
  Jawaban chat selesai sekitar 9,9 detik; kedua giliran tersimpan dan sesi
  uji ditutup. Percakapan tersebut tidak memakai lingkup materi kelas.
- Terdapat 16 catatan pemakaian provider dengan status `success` atau
  `cache_hit`; counter kegagalan penyimpanan metadata tetap nol. Key dan
  token sesi tidak ditampilkan dalam laporan.

Laporan privat: `.runtime/provider-test-2026-10-05.json`. Script sementara
berada pada `.runtime/probe-openai.py` dan `.runtime/probe-public-api.py`.
Soal bersumber memakai fixture teks dalam memori, sehingga hasil ini belum
membuktikan alur unggah/index dokumen kelas di VPS. Pengujian ini juga belum
mencakup beban pengguna, evaluasi pedagogi, atau pemutaran audio pada browser
dan perangkat siswa.

## Akses privat sebelum domain tersedia

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

## Akun demo pada VPS

| Username | Peran | Halaman setelah login |
| --- | --- | --- |
| `siswa.demo` | student | `/siswa` |
| `guru.demo` | teacher | `/guru` |
| `admin.demo` | admin | `/admin` |

Masing-masing akun memakai password acak berbeda. Kredensial tersimpan pada
`/home/kodmod-admin/kodmod-ai/.runtime/demo-accounts.json`, milik
`kodmod-admin` dengan izin `600`. Baca file tersebut hanya dalam sesi privat.
Login di `https://kodmodai.com/masuk`. Akun admin utama tetap memakai
password pada `.runtime/admin-password`.

Seeder VPS dapat dijalankan ulang:

```bash
cd /home/kodmod-admin/kodmod-ai
sudo bash scripts/seed-demo-vps.sh
```

Helper membuat file kredensial pada pemakaian pertama, lalu menggunakan
file yang sama pada pemakaian berikutnya. Backup database dibuat sebelum
seeding tanpa menghentikan aplikasi. Seeder memakai container sementara
dan script checkout melalui mount read-only; rebuild image tidak diperlukan.
Ketiga akun dibuat atau password-nya diatur ulang sesuai file privat.
Konflik peran membatalkan transaksi; akun lain tidak diubah. Snapshot harian
juga menyertakan file kredensial demo dalam arsip konfigurasi privat.

Validasi 5 Oktober 2026: ketiga akun berhasil login melalui server action
HTTPS, menerima cookie Secure/HttpOnly/SameSite=Lax, mengakses identitas API
dan halaman sesuai peran. Password `password` ditolak. Menjalankan seeder
ulang mempertahankan ID akun demo dan tidak mengubah akun lain; kredensial
admin utama tetap valid.

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

## Domain dan HTTPS

1. Arahkan record A domain utama (`@`) ke `139.190.100.215`. Untuk VPS ini
   domain yang dipilih adalah `kodmodai.com`. Lookup publik harus
   mengembalikan IP tersebut agar sertifikat dapat diterbitkan. Jangan
   menambahkan AAAA tanpa konektivitas IPv6. Tambahkan CNAME `www` ke
   `kodmodai.com.`; Caddy mengalihkan alias tersebut ke domain utama.
2. Edit root `.env`: `KODMOD_MODE=https`, `APP_DOMAIN=kodmodai.com`, dan
   opsional `ACME_EMAIL=email-anda` untuk kontak sertifikat. Domain tidak
   memakai skema atau slash. Email kosong tetap valid untuk ACME.
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
dan menolak akses publik ke metrik. Konfigurasi Caddy untuk `kodmodai.com`
telah divalidasi dengan email kosong. Jika DNS belum tersedia saat Caddy
dijalankan, penerbitan sertifikat akan dicoba ulang secara otomatis. Akses
HTTPS publik perlu diuji setelah sertifikat diterbitkan.

Periksa DNS sebelum mengganti mode:

```bash
dig @satu.neodns.id kodmodai.com A +short
dig @dua.neodns.id kodmodai.com A +short
dig @1.1.1.1 kodmodai.com A +short
dig @8.8.8.8 kodmodai.com A +short
```

Hasil yang diharapkan adalah `139.190.100.215`. Jika jawaban langsung dari
kedua nameserver belum memiliki A, periksa publikasi record pada zona
`kodmodai.com` di NEO DNS; menghapus cache DNS lokal tidak memperbaikinya.

### Domain aktif pada 5 Oktober 2026

- Root `.env`: `KODMOD_MODE=https`, `APP_DOMAIN=kodmodai.com`,
  `ACME_EMAIL=` sesuai pilihan pengguna.
- Sepuluh service runtime berjalan, termasuk Caddy. Web/API memakai cookie
  Secure dan CORS untuk `https://kodmodai.com`; port host web/API dihapus.
  Firewall membuka SSH dan TCP 80/443. Grafana tetap pada loopback.
- Kedua nameserver aktif (`satu.neodns.id`, `dua.neodns.id`) dan resolver
  Google/Cloudflare mengembalikan `139.190.100.215`. `www.kodmodai.com`
  mengikuti CNAME ke domain utama.
- Sertifikat Let’s Encrypt produksi terbit tanpa email untuk `kodmodai.com`
  dan `www.kodmodai.com`. Rantai sertifikat dan hostname diverifikasi tanpa
  menonaktifkan pemeriksaan TLS; masa berlaku berakhir 3 Januari 2027.
  Caddy menyimpan sertifikat pada volume persisten dan memperbaruinya
  otomatis.
- `https://kodmodai.com` mengembalikan HTTP 200. HTTP beralih ke HTTPS,
  sementara `https://www.kodmodai.com` beralih ke domain utama dengan path
  dan query tetap dipertahankan. Smoke HTTPS publik terakhir lulus 14/14.
- Login melalui server action HTTPS menghasilkan cookie Secure, HttpOnly,
  SameSite=Lax dan pengalihan admin. Sesi tersebut berhasil mengakses
  identitas API dan halaman admin. Password default ditolak, metrik publik
  mengembalikan 404, serta CORS hanya mengizinkan origin yang dikonfigurasi.
- Monitoring lulus 26/26. Jalur WebSocket diuji menolak upgrade tanpa
  autentikasi pada Caddy sementara dengan CA lokal; container tes dihapus.
- Snapshot lengkap sebelum perubahan:
  `/srv/kodmod/backups/kodmod-20261005T142946Z-14154`.

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

- Sepuluh service runtime aktif; migrator selesai dengan exit `0`.
- Smoke HTTPS aplikasi/API: 14/14 lulus, termasuk penolakan URL metrik terenkode.
- Pemeriksaan monitoring, target, dashboard dan Grafana: 26/26 lulus.
- Login admin acak, identitas API, halaman admin, penolakan password default,
  dan pembatasan CORS diverifikasi.
- Snapshot lengkap berhasil dan checksum keempat arsip valid. Dump berhasil
  direstore pada PostgreSQL sementara dengan `--network none`; revisi
  `0011_provider_usage` dan satu akun admin dipertahankan. Container tes
  dihapus setelah pemeriksaan; database aplikasi tidak menjadi target restore.
- Startup Docker/stack dan penerapan ulang firewall diperiksa melalui restart
  service, tanpa reboot VPS.
- Konfigurasi Compose/Caddy, sertifikat publik, domain utama, alias `www`,
  login HTTPS dan cookie sesi telah diverifikasi. Pengujian provider nyata
  lulus 16/16 melalui kode; beban pengguna belum diuji.

## Pemeriksaan ulang, 5–6 Oktober 2026

Laporan rinci ada pada [VPS_REVIEW_2026-10-06.md](/home/kodmod-admin/kodmod-ai/docs/VPS_REVIEW_2026-10-06.md).
Backend memiliki 1.159 tes unik lulus dan empat skip; frontend memiliki 141
tes lulus setelah fixture tambahan dan perbaikan mock JSX. Lint, format,
typecheck, build frontend, smoke HTTPS, dan monitoring lulus. Hasil suite
digabung dengan tes ulang yang relevan, bukan diklaim sebagai satu run penuh.

Caddy sekarang memblokir namespace metrik termasuk URL terenkode; 16 variasi
URL publik mengembalikan 404. UFW aktif tetapi unit boot-nya sebelumnya
disabled. Unit sudah di-enable, dan helper firewall memastikan pengaturan
boot tersebut tetap ada. Periksa dengan `sudo ufw status verbose` serta
`sudo systemctl is-enabled ufw.service`; VPS tidak direboot untuk audit ini.

Checksum kedua snapshot lengkap tetap valid. Dump database terbaru juga
berhasil dipulihkan di PostgreSQL sementara dengan empat akun dan revisi
`0011_provider_usage`; database produksi tidak direstore. Jadwal backup
otomatis pertama masih perlu diamati setelah timer benar-benar berjalan.
Snapshot lengkap terbaru `/srv/kodmod/backups/kodmod-20261005T170449Z-30271`
telah dibuat pada 6 Oktober sekitar 00:04 WIB. Keempat arsip valid, konfigurasi
arsip cocok dengan file privat saat ini, dan dump snapshot tersebut berhasil
direstore di container sementara tanpa jaringan. Smoke serta monitoring
kembali lulus setelah web/API/worker dinyalakan kembali.

Prioritas berikutnya adalah batas login/registrasi dan biaya API, pencabutan
JWT setelah perubahan password, validasi ulang sesi WebSocket, role database
khusus aplikasi, materi demo, backup offsite, dan tujuan notifikasi monitoring.
Audit ini berupa pemeriksaan manual dan pengujian kode; scanner resmi Codex
Security tidak tersedia pada sesi ini.

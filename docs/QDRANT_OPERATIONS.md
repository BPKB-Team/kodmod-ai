# Operasional Qdrant KODMOD

Panduan ini mencakup konfigurasi, indexing, pemeriksaan, backup, pemulihan,
dan rollback Qdrant untuk KODMOD. Ikuti prosedur ini sebelum mengubah backend
vektor atau memindahkan data.

## Batas penggunaan saat ini

| Lingkungan | Status |
|---|---|
| Docker Centre Windows | Qdrant opsional melalui profile `qdrant`; storage aktif memakai named volume Compose `kodmod-centre_kodmod-qdrantdata` pada Docker Desktop WSL2/ext4. Direktori data WSL Docker Desktop saat ini berada di `F:\Docker_Centre\wsl\DockerDesktopWSL`. |
| Pengembangan native / Docker mandiri | Default tetap `pgvector`; Qdrant hanya aktif jika `VECTOR_BACKEND=qdrant` dan servicenya dijalankan. |
| Compose produksi VPS | Qdrant dipasang lewat profile `qdrant`, image unprivileged yang dipatok, jaringan internal tanpa port host, TLS dengan CA privat, API key, dan volume persisten. Retrieval aplikasi tetap memakai `pgvector` sampai indeks Qdrant diverifikasi dan backend sengaja dialihkan. |

Direktori lama `F:\Docker_Centre\kodmod\data\qdrant` adalah salinan bind
mount lama dan tetap dibiarkan utuh; direktori itu tidak lagi dipakai container
aktif. Jangan menyalin pengaturan Docker Centre begitu saja ke VPS. Compose
Qdrant saat ini adalah konfigurasi lokal, bukan konfigurasi produksi.

## Arsitektur dan batas data

PostgreSQL adalah sumber data utama untuk teks materi, embedding kanonis,
versi materi, status publikasi, keanggotaan kelas, dan izin siswa. Qdrant
hanya mencari kandidat ID point secara approximate-nearest-neighbor. Backend
meminta PostgreSQL memvalidasi kandidat dan mengambil teks sebelum konteks
diberikan ke tutor.

Qdrant menyimpan vektor numerik dan payload metadata allowlist: `scope`, ID
kelas/materi/konsep/mata pelajaran, bahasa, versi materi, versi pemetaan, dan
`vector_hash`. Teks materi, path berkas, provenance dokumen, dan metadata
aksesibilitas tidak disalin ke payload Qdrant. Vektor dan ID tetap harus
diperlakukan sebagai data privat; lindungi file snapshot dan backup.

Jika Qdrant mati, koleksi kosong, hasilnya stale, atau jumlah kandidat yang
tervalidasi kurang, retrieval memakai query penuh PostgreSQL/pgvector.
Kegagalan mirror Qdrant setelah transaksi PostgreSQL dicatat sebagai
degradasi indeks; data kanonis tetap tersimpan di PostgreSQL.
Inisialisasi client dibatasi satu timeout keseluruhan. Setelah kegagalan,
probe berikutnya ditunda selama satu interval timeout; request bersamaan
langsung memakai fallback tanpa mengantre probe jaringan berulang.

## Versi dan konfigurasi

Versi runtime produksi dipatok ke image
`qdrant/qdrant:v1.19.2-unprivileged`; Docker Centre lokal memakai
`qdrant/qdrant:v1.19.2`. Python client dipatok ke
`qdrant-client>=1.19.1,<2.0`. Koleksi default
`kodmod_curriculum_v2` memakai embedding 1536 dimensi dengan jarak cosine.

| Variabel | Nilai / fungsi |
|---|---|
| `VECTOR_BACKEND` | `pgvector` (default) atau `qdrant`. |
| `QDRANT_URL` | VPS: `https://qdrant:6333` melalui jaringan internal. Docker Centre lokal: `http://qdrant:6333`, tanpa port host. Proses native perlu endpoint Qdrant terpisah yang memang dapat dijangkau dan diamankan. |
| `QDRANT_COLLECTION` | `kodmod_curriculum_v2`; ubah hanya untuk membangun atau memulihkan koleksi baru. |
| `QDRANT_TIMEOUT_SECONDS` | Batas waktu jaringan, default 5 detik. |
| `QDRANT_API_KEY` | Kredensial sisi client jika server Qdrant memang dikonfigurasi untuk autentikasi. Variabel ini sendiri tidak mengaktifkan autentikasi pada server. |
| `QDRANT_CA_CERT_FILE` | Opsional untuk client aplikasi. Menetapkan CA yang dipakai memvalidasi sertifikat TLS privat Qdrant. |

## Memasang Qdrant di VPS

Pemasangan ini tidak mengalihkan retrieval aktif dari `pgvector`. Profile
Qdrant diaktifkan oleh `QDRANT_ENABLED=true` pada root `.env`; helper membuat
API key acak dan sertifikat privat idempoten tanpa menampilkan nilainya:

```bash
cd /home/kodmod-admin/kodmod-ai
sudo bash scripts/prepare-qdrant-vps.sh
sudo bash scripts/release.sh check
sudo bash scripts/release.sh deploy TAG_RILIS_UNIK
sudo bash scripts/release.sh compose exec -T ai-engine python -m scripts.reindex_qdrant --batch-size 256
```

Sebelum update konfigurasi atau image, ikuti preflight dan buat snapshot penuh
sesuai [runbook VPS](VPS_SETUP.md). Helper menyimpan CA dan key server di
`/srv/kodmod/secrets/qdrant` dengan akses terbatas; private key CA tidak
dipasang ke container. Container Qdrant berjalan sebagai UID/GID 1000, hanya
terhubung ke network internal `vectors`, dan tidak menerbitkan port host.
Hanya API dan worker yang dapat menjangkau Qdrant. Key API dikirim melalui
HTTPS dan sertifikat diverifikasi terhadap CA privat yang dipasang read-only.

Pastikan reindex berhasil lalu verifikasi jumlah point dari API container tanpa
mencetak key atau payload:

```bash
sudo bash scripts/release.sh compose exec -T ai-engine python -c 'import ssl; from config.settings import settings; from qdrant_client import QdrantClient; c=QdrantClient(url=settings.QDRANT_URL,api_key=settings.QDRANT_API_KEY,timeout=30,verify=ssl.create_default_context(cafile=settings.QDRANT_CA_CERT_FILE)); info=c.get_collection(settings.QDRANT_COLLECTION); print(settings.VECTOR_BACKEND, settings.QDRANT_COLLECTION, info.status, info.points_count); c.close()'
sudo bash scripts/release.sh smoke
```

Hasil yang diharapkan adalah `pgvector`, koleksi berstatus `green`, jumlah
point sesuai vektor kanonis yang memenuhi syarat di PostgreSQL, dan smoke
aplikasi lulus. Ini menandakan Qdrant siap sebagai indeks sekunder; backend
tetap `pgvector`. Indeks Qdrant adalah data turunan: bila volume hilang,
jalankan kembali reindex dari PostgreSQL; database kanonis tidak diubah.

Untuk Docker Centre, `.env` yang dipakai Compose ada di
`F:\Docker_Centre\kodmod\.env`. File `apps/ai-engine/.env.example`
mempertahankan default `pgvector` untuk pengembangan. Jangan mengganti satu
file `.env` dengan file contoh; ubah hanya baris yang diperlukan agar key dan
konfigurasi lain tetap terjaga.

## Menjalankan Qdrant di Docker Centre

Pastikan `F:\Docker_Centre\kodmod\.env` memiliki:

```dotenv
VECTOR_BACKEND=qdrant
```

Jalankan wrapper proyek agar Compose menggunakan `.env` dan override Docker
Centre yang benar. Wrapper mengaktifkan profile `qdrant` saat backend yang
dipilih adalah Qdrant, membangun ulang image aplikasi, menunggu PostgreSQL,
dan membuat backup PostgreSQL sebelum proses migrasi:

```powershell
& 'F:\Laragon\www\kodmod\scripts\docker.ps1' up `
  -CentreRoot 'F:\Docker_Centre\kodmod'

& 'F:\Laragon\www\kodmod\scripts\docker.ps1' status `
  -CentreRoot 'F:\Docker_Centre\kodmod'
```

Perintah Compose biasa dari root repository dapat membaca `.env` yang berbeda
dan diam-diam memilih default `pgvector`. Untuk operasi Docker Centre,
gunakan wrapper ini atau teruskan `--env-file
F:\Docker_Centre\kodmod\.env` serta kedua file Compose secara eksplisit.

Antarkontainer memakai jaringan privat Compose dan backend terhubung ke
`http://qdrant:6333`. Port REST `6333` dan gRPC `6334` tidak dipublikasikan ke
host; gunakan service name dari container API untuk administrasi. Jangan
membuka port tersebut ke LAN atau internet.

Storage Qdrant memakai named volume Linux dari root Compose, bukan bind mount
Windows `F:\Docker_Centre\kodmod\data\qdrant`. Docker Desktop saat ini
menyimpan distro WSL2 di `F:\Docker_Centre\wsl\DockerDesktopWSL`, sehingga
volume ext4 persisten tetap berada di disk F:. Jangan membuka atau mengedit
isi volume Docker secara manual. Folder bind lama tetap tersimpan sebagai
salinan terpisah.

## Mengisi atau membangun ulang indeks

Setelah Qdrant berjalan, isi koleksi dari embedding kanonis PostgreSQL:

```powershell
$repo = 'F:\Laragon\www\kodmod'
$centre = 'F:\Docker_Centre\kodmod'
$composeArgs = @(
  'compose', '--project-directory', $repo,
  '--project-name', 'kodmod-centre',
  '--env-file', (Join-Path $centre '.env'),
  '--file', (Join-Path $repo 'docker-compose.yml'),
  '--file', (Join-Path $centre 'compose.override.yaml'),
  '--profile', 'qdrant'
)

& docker @composeArgs exec ai-engine python -m scripts.reindex_qdrant --batch-size 256
if ($LASTEXITCODE -ne 0) { throw 'Reindex Qdrant gagal.' }
```

Script membaca batch dari PostgreSQL dan melakukan upsert dengan ID yang
sama. Script tidak memanggil penyedia embedding, tidak menghapus data
PostgreSQL, dan tidak menghapus point lama di Qdrant. Karena itu, menjalankan
reindex berulang aman untuk point yang sama, tetapi bukan proses garbage
collection. Point lama yang tidak lagi memenuhi syarat dapat tetap ada di
koleksi; pemeriksaan versi dan izin di PostgreSQL mencegahnya menjadi konten
yang dikirim ke siswa.

Untuk membangun indeks bersih tanpa menghapus koleksi lama, gunakan nama
koleksi baru, misalnya `kodmod_curriculum_v3`:

1. Ganti `QDRANT_COLLECTION` di `.env` Docker Centre; jangan hapus koleksi lama.
2. Jalankan `docker.ps1 up -CentreRoot F:\Docker_Centre\kodmod` agar API dan
   worker memakai nama baru.
3. Jalankan perintah reindex di atas. Script akan membuat koleksi baru dan
   mengisi point dari PostgreSQL. Selama koleksi kosong atau belum lengkap,
   retrieval tetap dapat fallback ke pgvector.
4. Verifikasi jumlah point, payload, dan alur tutor. Simpan koleksi lama sampai
   hasilnya diterima dan masa rollback berlalu.

## Memverifikasi kondisi

Periksa status API, backend aktif di proses API, koleksi, dan bentuk payload.
Perintah berikut hanya menampilkan konfigurasi nonrahasia dan nama field,
bukan isi payload:

```powershell
$repo = 'F:\Laragon\www\kodmod'
$centre = 'F:\Docker_Centre\kodmod'
$composeArgs = @(
  'compose', '--project-directory', $repo,
  '--project-name', 'kodmod-centre',
  '--env-file', (Join-Path $centre '.env'),
  '--file', (Join-Path $repo 'docker-compose.yml'),
  '--file', (Join-Path $centre 'compose.override.yaml'),
  '--profile', 'qdrant'
)

& docker @composeArgs ps --all
& docker @composeArgs exec ai-engine python -c 'from config.settings import settings; print(settings.VECTOR_BACKEND, settings.QDRANT_COLLECTION)'
Invoke-RestMethod -Uri 'http://127.0.0.1:8109/ready'

$verifyCode = 'from config.settings import settings; from qdrant_client import QdrantClient; c=QdrantClient(url=settings.QDRANT_URL,api_key=settings.QDRANT_API_KEY); info=c.get_collection(settings.QDRANT_COLLECTION); points,_=c.scroll(collection_name=settings.QDRANT_COLLECTION,limit=1,with_payload=True,with_vectors=False); print(settings.VECTOR_BACKEND,settings.QDRANT_COLLECTION,info.status,info.points_count,sorted((points[0].payload or {}).keys()) if points else []); c.close()'
& docker @composeArgs exec ai-engine python -c $verifyCode
```

Sesudah reindex, pastikan API melaporkan `qdrant` dan nama koleksi yang benar,
koleksi berstatus `green`, jumlah point tidak nol, `/ready` berhasil, dan
payload hanya memiliki field metadata yang diizinkan. Jumlah point tidak
harus selalu 30; jumlahnya berubah mengikuti materi kanonis yang siap
diindeks.

Pemeriksaan koleksi belum membuktikan kualitas jawaban tutor. Untuk acceptance
aplikasi, jalankan satu alur tutor dengan siswa yang berhak mengakses materi,
lalu cek bahwa teks dan sumber jawaban berasal dari materi yang sama.

## Backup snapshot Qdrant

Backup PostgreSQL tetap wajib dan menjadi sumber pemulihan utama. Snapshot
Qdrant hanya salinan indeks turunan, bukan pengganti backup database. Snapshot
Qdrant dibuat lewat REST API pada jaringan internal lalu disalin ke direktori
privat. Data collection berada pada named volume Linux; direktori snapshot
bawaan Qdrant berada di `/qdrant/snapshots` di dalam container dan sementara
disimpan pada writable layer container.

Ukuran snapshot bisa besar meski jumlah point sedikit, karena snapshot
mencakup berkas dan indeks koleksi. Pastikan ruang tersedia untuk snapshot
sementara di container dan salinan backup di F:. Hindari membuat beberapa
snapshot bersamaan.

Contoh membuat snapshot koleksi melalui Python client di container API, lalu
menyalinnya dari container Qdrant ke folder backup privat. Client memakai
`QDRANT_URL` dan `QDRANT_API_KEY` yang sudah dikonfigurasi untuk backend:

```powershell
$repo = 'F:\Laragon\www\kodmod'
$centre = 'F:\Docker_Centre\kodmod'
$composeArgs = @(
  'compose', '--project-directory', $repo,
  '--project-name', 'kodmod-centre',
  '--env-file', (Join-Path $centre '.env'),
  '--file', (Join-Path $repo 'docker-compose.yml'),
  '--file', (Join-Path $centre 'compose.override.yaml'),
  '--profile', 'qdrant'
)
$qdrantContainer = (& docker @composeArgs ps -q qdrant | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($qdrantContainer)) { throw 'Container Qdrant aktif tidak ditemukan.' }
$backupDir = 'F:\Docker_Centre\kodmod\backups\qdrant'
$collection = (& docker @composeArgs exec -T ai-engine python -c 'from config.settings import settings; print(settings.QDRANT_COLLECTION)').Trim()
$createSnapshot = 'from config.settings import settings; from qdrant_client import QdrantClient; c=QdrantClient(url=settings.QDRANT_URL,api_key=settings.QDRANT_API_KEY,timeout=120); s=c.create_snapshot(collection_name=settings.QDRANT_COLLECTION); print(s.name); c.close()'
$snapshotName = (& docker @composeArgs exec -T ai-engine python -c $createSnapshot).Trim()
if ([string]::IsNullOrWhiteSpace($snapshotName)) { throw 'Nama snapshot tidak diterima.' }

New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$snapshotPath = Join-Path $backupDir $snapshotName
& docker cp ($qdrantContainer + ':/qdrant/snapshots/' + $collection + '/' + $snapshotName) $snapshotPath
if ($LASTEXITCODE -ne 0) { throw 'Snapshot tidak dapat disalin dari container Qdrant.' }

$snapshotFile = Get-Item -LiteralPath $snapshotPath
if ($snapshotFile.Length -le 0) { throw 'File snapshot kosong.' }
$snapshotHash = (Get-FileHash -LiteralPath $snapshotPath -Algorithm SHA256).Hash
$manifest = $snapshotHash.ToLowerInvariant() + '  ' + $snapshotFile.Name
Set-Content -LiteralPath ($snapshotPath + '.sha256') -Value $manifest -Encoding ascii
$manifest
$deleteSnapshot = 'from config.settings import settings; from qdrant_client import QdrantClient; c=QdrantClient(url=settings.QDRANT_URL,api_key=settings.QDRANT_API_KEY,timeout=30); c.delete_snapshot(collection_name=settings.QDRANT_COLLECTION,snapshot_name="' + $snapshotName + '"); c.close()'
& docker @composeArgs exec -T ai-engine python -c $deleteSnapshot
if ($LASTEXITCODE -ne 0) { Write-Warning 'Backup sudah tersalin; periksa dan hapus snapshot sementara di Qdrant setelah verifikasi.' }
```

Salin snapshot dan file `.sha256` ke media privat lain untuk backup di luar
mesin F:. Jangan commit snapshot ke Git. Snapshot membawa point, vektor, dan
konfigurasi koleksi; meskipun payload tidak berisi teks, tetap perlakukan
sebagai data privat.

## Pemulihan

### Gangguan Qdrant atau indeks tidak konsisten

1. Ubah `VECTOR_BACKEND=pgvector` pada
   `F:\Docker_Centre\kodmod\.env`.
2. Jalankan wrapper `up` yang sama. Tutoring kembali mengambil retrieval dari
   PostgreSQL/pgvector.
3. Pertahankan named volume dan folder lama
   `F:\Docker_Centre\kodmod\data\qdrant` untuk diagnosis. Jangan hapus
   folder, volume, atau koleksi.
4. Setelah Qdrant sehat, jalankan reindex dari PostgreSQL. Jika perlu indeks
   benar-benar bersih, gunakan nama koleksi baru sesuai prosedur di atas.

Karena PostgreSQL kanonis, ini adalah prosedur pemulihan yang disarankan.

### Restore snapshot

Folder bind Qdrant lama di F: muncul sebagai filesystem `9p`. Pada storage
tersebut, Qdrant memberi peringatan durability; snapshot uji 580 MB berisi
`0/wal/first-index` sepanjang 16 byte nol dan restore gagal. Folder lama
`F:\Docker_Centre\kodmod\data\qdrant` sengaja tetap disimpan, tetapi bukan
storage aktif.

Storage aktif sekarang memakai named volume Docker Linux/ext4 di Docker
Desktop WSL2 pada disk F:. Setelah reindex 30 vektor dari PostgreSQL, snapshot
uji sebesar 897,024 byte berhasil dipulihkan ke koleksi sementara yang
berstatus `green` dengan 30 point menggunakan Qdrant `v1.19.2`. Koleksi uji
dengan nama unik, proses restore memakai verifikasi checksum, dan snapshot
sementara sudah dibersihkan setelah pemeriksaan. File snapshot dan manifest
SHA-256 yang berhasil disalin ke backup privat tetap tersedia. File snapshot 580 MB
dari percobaan storage lama masih ada di folder backup untuk audit; jangan
gunakan file tersebut untuk restore. Snapshot yang sudah diverifikasi adalah
file 897 KB yang memiliki file `.sha256` berdampingan:

```text
F:\Docker_Centre\kodmod\backups\qdrant\kodmod_curriculum_v2-5134353806303611-2026-10-17-21-18-47.snapshot
Ukuran: 897,024 byte
SHA-256: b16d1ed0f635ec7a0125be8f50e8afde3f57899b5bcb146ea0f73d653dc76b36
Manifest: file yang sama dengan akhiran .sha256
```

File lama yang tidak boleh dipulihkan adalah
`kodmod_curriculum_v2-8865580017778149-2026-10-17-21-09-39.snapshot`
(580,416,000 byte). File tersebut masih ada di folder backup tanpa manifest
SHA-256 yang terverifikasi.

Sebelum pemulihan, verifikasi file dan manifest di Windows:

```powershell
$snapshotPath = 'F:\Docker_Centre\kodmod\backups\qdrant\kodmod_curriculum_v2-5134353806303611-2026-10-17-21-18-47.snapshot'
$manifestPath = $snapshotPath + '.sha256'
$expectedHash = ((Get-Content -LiteralPath $manifestPath -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
$actualHash = (Get-FileHash -LiteralPath $snapshotPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $expectedHash) { throw 'SHA-256 snapshot tidak cocok; hentikan pemulihan.' }
```

Pulihkan hanya ke nama koleksi baru yang belum ada. Jangan arahkan snapshot
langsung ke `kodmod_curriculum_v2` yang aktif. Qdrant akan membuat koleksi
target dari snapshot; endpoint pemulihan dapat menimpa koleksi yang sudah ada.
Prioritas `snapshot` diperlukan agar data snapshot menjadi sumber data target.
Pastikan nama target belum ada dan versi Qdrant target kompatibel, lalu salin
file ke container dan jalankan restore melalui API client dari `ai-engine`:

```powershell
# Gunakan $composeArgs yang sama seperti pada bagian backup.
$qdrantContainer = (& docker @composeArgs ps -q qdrant | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($qdrantContainer)) { throw 'Container Qdrant aktif tidak ditemukan.' }
$targetCollection = 'kodmod_curriculum_restore_check'
$containerSnapshot = '/qdrant/snapshots/kodmod-restore-check.snapshot'
$existsCode = 'from config.settings import settings; from qdrant_client import QdrantClient; c=QdrantClient(url=settings.QDRANT_URL,api_key=settings.QDRANT_API_KEY); print(c.collection_exists("' + $targetCollection + '")); c.close()'
$targetExists = (& docker @composeArgs exec -T ai-engine python -c $existsCode).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Tidak dapat memastikan koleksi tujuan belum ada.' }
if ($targetExists -ne 'False') { throw 'Koleksi tujuan sudah ada; pilih nama koleksi baru.' }
& docker cp $snapshotPath ($qdrantContainer + ':' + $containerSnapshot)
if ($LASTEXITCODE -ne 0) { throw 'Snapshot tidak dapat disalin ke container Qdrant.' }

$restoreCode = 'from config.settings import settings; from qdrant_client import QdrantClient,models; c=QdrantClient(url=settings.QDRANT_URL,api_key=settings.QDRANT_API_KEY,timeout=120); c.recover_snapshot(collection_name="' + $targetCollection + '",location="file://' + $containerSnapshot + '",checksum="' + $expectedHash + '",priority=models.SnapshotPriority.SNAPSHOT,wait=True); info=c.get_collection("' + $targetCollection + '"); print(info.status,info.points_count); c.close()'
& docker @composeArgs exec -T ai-engine python -c $restoreCode
if ($LASTEXITCODE -ne 0) { throw 'Restore gagal; koleksi aktif tidak boleh diarahkan ke target.' }
```

Pastikan output menunjukkan status `green` dan jumlah point yang diharapkan.
Periksa juga `/ready` serta satu alur tutor yang berhak mengakses materi.
Ganti nama koleksi uji bila nama target tersebut sudah ada; jangan menimpa
koleksi yang memiliki data. Setelah pemeriksaan, koleksi uji dapat dihapus
secara eksplisit hanya bila sudah dipastikan nama dan isi targetnya. Snapshot
koleksi hanya kompatibel dengan versi minor yang sama atau satu minor lebih
baru; misalnya snapshot dari `v1.18.x` dapat dipulihkan ke `v1.18.x` atau
`v1.19.x`.

Pemulihan rutin tetap beralih ke `pgvector`, lalu membangun ulang indeks dari
PostgreSQL. Snapshot dari storage aktif dapat dipakai untuk restore ke koleksi
terpisah; verifikasi point count dan retrieval sebelum mengarahkan aplikasi ke
hasil restore. Ikuti [panduan snapshot resmi
Qdrant](https://qdrant.tech/documentation/operations/snapshots/) dan [API
restore snapshot unggahan Qdrant v1.19](https://api.qdrant.tech/v-1-19-x/api-reference/snapshots/recover-from-uploaded-snapshot).

## Rollback backend

Untuk menghentikan penggunaan Qdrant dan kembali ke PostgreSQL:

1. Set `VECTOR_BACKEND=pgvector` di `.env` Docker Centre.
2. Jalankan `scripts/docker.ps1 up -CentreRoot F:\Docker_Centre\kodmod`.
3. Verifikasi `/ready` dan bahwa konfigurasi API melaporkan `pgvector`.
4. Biarkan koleksi, named volume, dan folder bind lama tetap utuh untuk
   diagnosis atau pemakaian berikutnya.

Rollback backend tidak perlu mengubah schema, memindahkan vektor, atau
menghapus volume. Hindari `docker compose down -v`, `docker volume prune`,
dan penghapusan manual `F:\Docker_Centre\kodmod\data\qdrant`.

## Keamanan dan batas produksi

Qdrant open-source tidak mengaktifkan autentikasi atau TLS secara otomatis.
Service hanya bergabung dengan jaringan privat Compose dan port REST/gRPC
tidak dipublikasikan ke host. API key pada service Qdrant belum diaktifkan.
`QDRANT_API_KEY` di konfigurasi backend hanya kredensial client; itu tidak
mengamankan service jika Qdrant belum dikonfigurasi untuk memeriksanya.

Jangan mengekspos port `6333` atau `6334`, jangan memakai konfigurasi lokal
ini di VPS publik, dan jangan mengirim API key melalui HTTP yang tidak
terenkripsi. Untuk produksi, siapkan autentikasi, TLS, jaringan privat,
backup/retensi, dan perubahan Compose yang sesuai terlebih dahulu. Lihat
[panduan keamanan Qdrant](https://qdrant.tech/documentation/security/) dan
[dokumentasi snapshot Qdrant](https://qdrant.tech/documentation/snapshots/).

## Pemecahan masalah

| Gejala | Pemeriksaan / tindakan |
|---|---|
| API tetap memakai `pgvector` | Pastikan `VECTOR_BACKEND=qdrant` ada di `.env` Docker Centre dan jalankan wrapper; jangan mengandalkan `.env` backend atau default Compose. |
| `qdrant` tidak ditemukan / koneksi timeout | Periksa container dan profile dengan `scripts/docker.ps1 status`; pastikan API memakai `http://qdrant:6333` di jaringan Compose. |
| Koleksi belum ada atau jumlah point nol | Jalankan `python -m scripts.reindex_qdrant` melalui `docker compose exec ai-engine`; periksa log API/worker jika upsert gagal. |
| Koleksi tidak `green` atau ukuran vektor tidak cocok | Jangan hapus/ubah koleksi aktif. Kembali ke `pgvector`, lalu buat koleksi baru bernama berbeda dan reindex. Pastikan dimensi embedding tetap 1536. |
| Data F: tidak cukup ruang | Jangan memindahkan atau membersihkan folder data saat service aktif. Kembali ke `pgvector`, buat salinan privat/backup, lalu rencanakan perpindahan storage saat maintenance. |
| Snapshot tidak dapat dipulihkan | Cocokkan versi Qdrant, pastikan target collection baru, cek file/hash, dan ingat bahwa snapshot adalah tambahan; indeks dapat dibangun ulang dari PostgreSQL. |

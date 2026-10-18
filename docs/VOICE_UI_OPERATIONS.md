# Pembacaan UI dan pemeriksaan alur KODMOD

Dokumen ini menjelaskan perilaku pembacaan UI yang diterapkan pada 18 Oktober
2026. KODMOD memakai satu koordinator suara agar menu, tutor, soal, dan popup
tidak berbicara bersamaan.

## Perilaku yang berlaku

| Interaksi | Pembacaan |
|---|---|
| Tombol, tautan, field, dan item menu | Label aksesibel saat fokus atau dipilih; ikon dekoratif diabaikan. |
| Pilihan jawaban radio dan checkbox | Label pilihan serta status dipilih/dicentang. Pilihan dapat memotong penjelasan yang sedang dibacakan. |
| Dropdown | Nama field dan pilihan saat ini; buka daftar, panah atas/bawah, Home/End, pencarian huruf, dan konfirmasi pilihan. |
| Switch, tab, dan menu yang bisa dibuka | Label beserta status aktif, dipilih, atau dibuka/ditutup. |
| Popup konfirmasi/hasil | Judul, penjelasan, dan tombol yang tersedia setelah popup terbuka. Fokus otomatis awal tidak memotong pengumuman popup. |
| Pengaturan suara | Semua kontrol mengikuti engine dan pengaturan draft yang sedang diedit. Tutor berhenti selama pengaturan terbuka. |
| Navigasi halaman | Fokus berpindah ke judul tujuan; judul yang muncul melalui pemuatan bertahap juga ditangani. Reset fokus terlambat oleh framework dipulihkan tanpa mengambil fokus kontrol yang sudah dipilih pengguna. Halaman masuk/daftar memakai audio publik tetap. |
| Soal asesmen | Pembacaan otomatis mengikuti Suara Tutor dan mencakup soal serta seluruh opsi A, B, dan seterusnya. |

Pergerakan pointer akibat perubahan layout tidak boleh membatalkan konfirmasi
pilihan. Klik dan keyboard mendapat prioritas selama 700 ms terhadap hover
pasif. Label tombol tindakan yang terlambat juga tidak boleh memotong soal
atau jawaban tutor yang baru mulai dibacakan.

Pada layar hingga 800 px, navigasi siswa/guru memakai tombol buka/tutup dan
konten mendapat lebar layar penuh. Menu ditutup setelah tujuan dipilih.
Tombol mengekspos `aria-expanded` dan `aria-controls` untuk pembaca layar.

## Provider, akses, dan privasi

- Engine `app` selalu meminta audio melalui proxy KODMOD. Kegagalan provider
  tidak mengaktifkan `speechSynthesis` perangkat secara diam-diam.
- Engine `device` memakai suara perangkat hanya ketika pilihan tersebut
  memang dipilih. Engine `off` menonaktifkan pembaca menu; pembacaan tutor
  mengikuti pengaturannya sendiri.
- Sebelum login, hanya key katalog publik tetap yang dapat disintesis.
  Katalog berada di `apps/ai-engine/voice/menu_catalog.py`. Endpoint TTS teks
  bebas tetap membutuhkan akun aktif.
- Label dan teks opsi terkontrol dapat dikirim untuk pembacaan. Nilai yang
  diketik pada password, username, textarea, dan input bebas tidak diambil
  oleh pembaca menu.
- Pembacaan menu dihentikan selama rekaman mikrofon. Status pemutar audio
  sendiri diabaikan agar tidak membuat lingkaran pembacaan.

## Aturan pemeliharaan

1. Beri kontrol nama lewat `label`, `aria-label`, atau `aria-labelledby`.
   Gunakan `aria-checked`, `aria-selected`, dan `aria-expanded` sesuai perilaku.
2. Gunakan `NativeSelect` untuk dropdown aplikasi. Komponen ini menangani
   opsi, pemulihan fokus setelah tindakan async, dan pengumuman terpilih.
3. Untuk popup, gunakan `confirmAction`/`notifyResult` atau dialog semantik
   dengan judul dan deskripsi. Jangan membungkus dialog interaktif dengan
   `data-voice-ignore`.
4. `data-voice-menu` harus menunjuk key katalog yang benar untuk kontrol
   publik. Jangan membentuk key dari masukan bebas pengguna.
5. `data-voice-managed` menandai komponen yang memiliki pengumuman klik dan
   pilihannya sendiri. Fokus tetap dapat dibacakan. Pemutar memakai
   `data-voice-player` agar status playback tidak disintesis kembali.
6. Pertahankan pengujian StrictMode: cleanup React tidak boleh membuat soal
   pertama berhenti permanen atau memutar tutor di belakang popup pengaturan.

## Hasil pemeriksaan 18 Oktober 2026

Pemeriksaan browser dengan API fixture lokal mencakup pengaturan suara,
dropdown bahasa/ukuran teks, pemulihan fokus, login batal/salah/berhasil,
pustaka dan filter, asesmen hingga selesai termasuk jawaban salah dan retry,
popup keluar asesmen, menu profil melalui keyboard, serta halaman progres.
Request suara diperiksa terpisah dari isi audio fixture yang memakai satu
contoh suara generik. Hasil ini membuktikan alur UI dan payload pembacaan,
bukan kualitas penilaian AI atau keakuratan isi suara per opsi di provider.

Layout mobile diperiksa pada viewport 390 × 844. Sidebar tidak lagi menjepit
konten, navigasi dapat dibuka/ditutup, dan lebar dokumen tidak melampaui
viewport. Bukti lokal disimpan di `.runtime/voice-ui-audit/mobile-progress.png`.
Perpindahan beranda ke daftar kelas juga diperiksa ulang setelah build source
terakhir: fokus berada pada `h1` tujuan dan lebar dokumen 375 px sama dengan
lebar area konten viewport. Bukti tambahan berada di
`.runtime/voice-ui-audit/mobile-classes-final.png`.

Hasil regresi frontend: **169 tes, 167 lulus, 0 gagal, 2 dilewati**.
Dua tes yang dilewati adalah suite editorial dengan opt-in
`EDITORIAL_PROXY_TEST=1`, yang memerlukan server editorial dan PostgreSQL
terisolasi tersendiri. Hasil ini tidak mengklaim dua tes tersebut lulus.
Typecheck, ESLint, Ruff untuk katalog suara, dan `git diff --check` lulus.
Web Docker dibangun ulang dan container berstatus healthy. Pemeriksaan live
`http://localhost:3200` mengembalikan 200; `/ready` API mengembalikan status
ready dengan database dan Redis ok. Log pemeriksaan tersimpan di
`.runtime/voice-ui-audit/web-tests-final.log`, `typecheck-final.log`,
`lint-final.log`, dan `web-build-final.log`.

Runtime Docker telah memilih `TTS_BACKEND=elevenlabs`. Namun sintesis untuk
empat key baru (`voice-settings`, `text-size-large-selected`, `contrast-on`,
`dialog-login`) ditolak provider dengan HTTP 401; proxy mengembalikan 502.
Key di file backend dan container cocok. Audio preview lama yang sudah
di-cache masih tersedia, sehingga preview lama bukan bukti sintesis baru.
Administrator perlu memperbarui kredensial ElevenLabs yang valid melalui
file privat `apps/ai-engine/.env`, lalu me-recreate API/worker lewat wrapper
Docker dan mengulangi pemeriksaan. Jangan memasukkan API key ke Git atau chat.
Sesuai keputusan pengguna, perbaikan UI dituntaskan dan kendala provider ini
dicatat sebagai tindak lanjut setelah kredensial valid tersedia.

Pengujian fisik dengan NVDA/JAWS/TalkBack, mikrofon, dan seluruh alur tugas
terbit/tutor pada provider produksi belum dibuktikan oleh audit UI ini.

## Menjalankan regresi lokal

Jalankan API fixture pada port tersendiri, bukan database aplikasi. Contoh
fixture browser memakai API `18109` dan web `3110`:

```powershell
$env:FIXTURE_PORT='18109'
node apps/web/tests/api-fixture.mjs
```

Di terminal terpisah, jalankan web dengan `API_ORIGIN` menunjuk fixture.
Untuk pemeriksaan playback, `FIXTURE_AUDIO_FILE` dapat menunjuk audio uji MP3
yang valid. Profil fixture mencakup hash audio agar cache contoh yang berbeda
tidak tertukar. Audio dummy bawaan hanya untuk pemeriksaan transport.

```powershell
$env:API_ORIGIN='http://127.0.0.1:18109'
$env:SESSION_COOKIE_SECURE='false'
npm run dev:web -- --port 3110
```

Jalankan suite frontend dan pemeriksaan source:

```powershell
$env:WEB_TEST_ORIGIN='http://127.0.0.1:3110'
$env:API_FIXTURE_ORIGIN='http://127.0.0.1:18109'
node --test apps/web/tests/*.test.mjs
npm run typecheck:web
npm run lint:web
```

Gunakan akun fixture `siswa.test`, `guru.test`, atau `admin.test` dengan
password fixture `fixture-only-123` hanya pada lingkungan sementara ini.
Log dan bukti lokal berada di `.runtime/voice-ui-audit/`, di luar Git.

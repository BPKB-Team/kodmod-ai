# Sinkronisasi preferensi dan pemulihan navigasi, 23 Oktober 2026

## Temuan

Pemeriksaan rilis aktif `04c03b6` melalui HTTPS menghasilkan `/masuk` → HTTP
308 ke `/login`; `/login` menghasilkan HTTP 200. Referensi navigasi aplikasi
saat ini memakai URL Inggris, dengan alias lama dalam `next.config.ts`.
Screenshot menampilkan error boundary pada URL lama setelah rilis yang
memindahkan halaman. Kode client/prefetch dari rilis sebelumnya merupakan
kemungkinan penyebab; tanpa console/network dari tab tersebut, penyebab pasti
error di screenshot belum dapat dikonfirmasi. Ini bukan bukti bahwa sesi
akun rusak.

Ada ketidaksesuaian preferensi yang dapat dibuktikan dari kode:

- Server Action login mengganti bahasa browser dengan bahasa akun, meskipun
  pengguna baru saja memilih bahasa pada halaman publik.
- Provider bahasa menyimpan pilihan React tersendiri dan belum mengamati
  cookie yang berubah ketika tab dipulihkan atau tab lain mengubah bahasa.
- Preferensi suara/tampilan lengkap berada dalam localStorage, sedangkan
  server hanya menerima cookie tampilan. Kontrol suara SSR dapat memakai
  default sebelum hydration mengembalikan pilihan browser.
- Key suara lama `kodmod.speech-engine.v1` belum dibaca oleh penyimpanan suara
  baru, sehingga pengguna lama dapat kembali melihat default/onboarding.

## Perilaku setelah perbaikan

Pilihan bahasa browser yang valid dibawa saat login. API menerapkannya dalam
transaksi login setelah password, status akun, dan konfirmasi sesi aktif
berhasil. Login salah atau konfirmasi yang belum disetujui tidak mengganti
bahasa maupun sesi. Client API tanpa pilihan bahasa tetap memakai preferensi
akun yang tersimpan. Registrasi mengikuti bahasa browser seperti sebelumnya.

Cookie bahasa menjadi sumber state browser; perubahan yang berhasil juga
memberi notifikasi ke tab lain. Focus, pageshow, dan perubahan visibility
memeriksa ulang cookie. Dokumen dan komponen client mengikuti nilai yang sama,
dan komponen server dimuat ulang ketika bahasa berubah. Login, registrasi,
dan logout menginvalidasi cache layout.

Suara dan tampilan tetap merupakan preferensi perangkat/browser, berlaku
sebelum dan setelah autentikasi. localStorage tetap dipakai, dengan cookie
`kodmod_voice` berisi field preferensi yang tervalidasi untuk SSR dan fallback
ketika localStorage tidak tersedia. Preferensi lama dimigrasikan tanpa
mengaktifkan suara menu yang sebelumnya dimatikan. Hydration juga menyalin
preferensi yang sudah ada ke cookie tanpa mengharuskan pengguna menyimpan
ulang. Cookie tidak berisi identitas akun, token, atau audio. Pengaturan ini
bukan sinkronisasi suara antarperangkat melalui akun.

Build VPS memakai tag rilis unik sebagai `deploymentId` Next.js. Aset dan
respons navigasi menandai versi deploy agar router dapat menangani perbedaan
versi client/server. Tombol pemulihan error utama melakukan navigasi penuh
untuk mengambil ulang kode dan menjalankan redirect URL lama.

## Validasi

- Suite web: 231 lulus, 2 tes opsional dilewati; tes session confirmation yang
  sebelumnya memakai sleep tetap kini mem-flush animation frame secara
  deterministik.
- Tes autentikasi/suara HTTP backend: 27 lulus, termasuk preservasi bahasa saat
  login ditolak dan penerapannya setelah konfirmasi pergantian sesi.
- Tes tambahan remount sebelum/sesudah login/logout, migrasi engine lama,
  fallback cookie, bahasa antar-tab, serta SSR suara/tampilan lulus.
- HTTP acceptance dijalankan pada build standalone Next.js dan fixture API
  loopback. URL lama menjaga query; respons navigasi mengirim deployment ID
  terbaru dan aset memiliki penanda versi.
- Lint dan typecheck web, build produksi, serta Ruff check/format pada file
  backend yang diubah dijalankan sebelum branch diserahkan.

Pengujian tidak memakai akun demo produksi, materi pengguna, atau provider
berbayar. Diagnosis tab lama tidak mencakup pengamatan langsung terhadap
console browser pengguna. Perubahan disiapkan pada branch
`goldenz/session-preferences-sync`; deployment adalah langkah terpisah dan
laporan ini tidak menyatakan patch sudah aktif di VPS.

# Preferensi bacaan siswa

Kelanjutan pustaka siswa: ukuran teks, kontras, dan jarak baris kini dapat disimpan melalui tombol Simpan tampilan dengan konfirmasi SweetAlert2. Perubahan kontrol memberi pratinjau langsung; Pratinjau bawaan tidak menimpa simpanan sampai dikonfirmasi melalui Simpan tampilan.

Preferensi disimpan satu tahun dalam cookie HttpOnly khusus akun dengan path `/student`, SameSite Lax, dan Secure pada production. Identitas akun berasal dari sesi yang diverifikasi di server. Preferensi bertahan saat pindah materi atau membuka ulang browser, selama cookie tersedia. Tidak tersinkron antarperangkat; penghapusan cookie mengembalikan tampilan bawaan.

Server membaca cookie sebelum merender pembaca agar tampilan awal menggunakan preferensi tersimpan. Nilai ukuran/jarak dibatasi pada pilihan yang dikenal; cookie rusak kembali ke default. Tidak ada perubahan atau migrasi database.

Validasi: tes parser preferensi, build Next.js/TypeScript, dan lint. Pengujian transaksi simpan lewat browser setelah login masih perlu dilakukan. Uji manual berikutnya: simpan ukuran 28 dan jarak lega, buka materi lain, muat ulang, lalu pastikan akun siswa berbeda tidak mendapat preferensi akun pertama. Batalkan dialog simpan untuk memastikan pratinjau tidak disimpan.

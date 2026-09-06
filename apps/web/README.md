# @kodmod/web

Antarmuka KODMOD. React 19 + Vite + Tailwind v4 + TypeScript.

```bash
npm install
npm run dev        # http://localhost:5173, /api diproksi ke :8000
```

Jalankan `apps/ai-engine` lebih dulu agar proxy API berfungsi.

## Aturan yang tidak boleh dilanggar

Aplikasi ini dipakai orang yang tidak melihat layar. Empat hal berikut adalah
persyaratan produk, bukan preferensi:

1. **Setiap alur bisa diselesaikan tanpa mouse.** Uji dengan Tab/Shift-Tab saja.
2. **Cincin fokus tidak boleh dihapus.** `outline: none` tanpa pengganti = regresi.
3. **Setiap informasi yang terdengar lewat TTS punya padanan di `LiveRegion`.**
   Pengguna mode "pembaca layar saya" harus mendapat informasi yang sama.
4. **Tidak ada dua suara sekaligus.** Kalau TTS aktif, konten yang sama tidak
   boleh juga dikirim ke live region sebagai `assertive`.

Setiap PR yang menyentuh antarmuka wajib lolos keempat poin di atas.

Uji minimal sebelum merge: **NVDA di Windows** dan **TalkBack di Android**.

# @kodmod/web

Antarmuka KODMOD. React 19 + Vite + Tailwind v4 + TypeScript.

```bash
npm install
npm run dev        # http://localhost:5173, /api diproksi ke :8000
```

Jalankan `apps/ai-engine` dulu biar proxy API-nya nyambung.

## Aturan yang nggak boleh dilanggar

Aplikasi ini dipakai orang yang nggak melihat layar. Empat hal berikut adalah syarat produk, bukan sekadar preferensi:

1. **Setiap alur harus bisa diselesaikan tanpa mouse.** Uji pakai Tab/Shift-Tab aja.
2. **Cincin fokus nggak boleh dihapus.** `outline: none` tanpa pengganti itu regresi.
3. **Setiap informasi yang keluar lewat TTS harus punya padanan di `LiveRegion`.** Pengguna mode "pembaca layar saya" harus tetap dapat informasi yang sama.
4. **Nggak boleh ada dua suara sekaligus.** Kalau TTS lagi aktif, konten yang sama jangan sampai dikirim juga ke live region sebagai `assertive`.

Setiap PR yang menyentuh antarmuka wajib lolos keempat poin di atas.

Uji minimal sebelum merge: **NVDA di Windows** dan **TalkBack di Android**.

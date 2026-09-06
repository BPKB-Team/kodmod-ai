<p align="center">
  <img src="assets/logo/Logo_horizontal_with_text.png" alt="KODMOD" width="420">
</p>

<p align="center">
  <strong>Asisten belajar AI buat siswa tunanetra.</strong><br>
  Dari sekadar dibacakan, jadi diajak mikir.
</p>

---

## Kenapa KODMOD dibuat

Di Indonesia ada sekitar 11 juta orang dengan gangguan penglihatan, dan 83% dari mereka sudah pernah merasakan sekolah formal. Jadi akses ke pendidikan sebenarnya bukan lagi tantangan terbesar.

Yang jadi tantangan justru apa yang mereka dapat setelah duduk di kelas. Baru sekitar 5% buku pelajaran yang hadir dalam format yang bisa mereka akses, dan 78% guru di sekolah inklusi belum pernah dapat pelatihan khusus untuk mengajar siswa disabilitas. Alat bantu yang ada sekarang, seperti screen reader JAWS atau NVDA, memang sudah cukup andal membacakan tulisan. Tapi sebatas itu saja, belum ada yang mengajak siswa untuk berpikir, bertanya balik, atau menyusun alasannya sendiri.

Jadi sebenarnya bukan soal kurangnya alat bantu, tapi belum adanya alat yang benar-benar bisa diajak berdiskusi.

Di situlah KODMOD hadir. Ia bekerja sebagai tutor percakapan yang mengikuti kurikulum SLB A, lebih peduli pada cara siswa berpikir ketimbang sekadar menguji hafalan, dan melaporkan progres belajarnya otomatis ke guru.

## Struktur folder

```
kodmod-ai/
├── apps/
│   ├── ai-engine/      Backend agentic (Python, FastAPI, LangGraph)
│   └── web/            Antarmuka (React 19, Vite, Tailwind v4)
├── docs/               Arsitektur, API, aksesibilitas, deployment
├── infra/docker/       Compose produksi, Caddy, Prometheus
├── assets/logo/        Aset merek
├── docker-compose.yml  Infrastruktur pengembangan lokal
└── Makefile            Kumpulan perintah sehari-hari
```

## Empat cluster agent

| Cluster | Isi | Tugasnya |
|---|---|---|
| Practices & Tutoring | Tutor Agent | Penjelasan gaya Socratic, berbasis RAG kurikulum |
| Quiz / Assessment | Scoring Agent, Quiz Analyzer | Menilai penalaran, menjelaskan di mana letak salahnya |
| Content & Exercise | Problem Generator | Bikin soal non-visual, tervalidasi guru |
| Analytics & Reporting | Learning Analytics Agent | Dasbor buat siswa dan guru |

Detail tiap cluster ada di [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Teknologi yang dipakai

| Lapisan | Pilihan |
|---|---|
| Orkestrasi | LangGraph + LangChain |
| LLM | Claude (bisa diganti ke OpenAI, Ollama, atau vLLM) |
| STT | faster-whisper, Deepgram |
| TTS | Piper, Azure, ElevenLabs |
| Embedding | BGE-M3 (multilingual) |
| Basis data | PostgreSQL 16 + pgvector, Redis |
| API | FastAPI + WebSocket |
| Antarmuka | React 19, Vite, Tailwind v4, TypeScript |

## Cara menjalankan

```bash
make infra-up     # nyalain Postgres (pgvector) + Redis
make install      # pasang dependensi ai-engine dan web
make api          # jalanin ai-engine  -> http://localhost:8000
make web          # jalanin antarmuka  -> http://localhost:5173
```

Ketik `make help` buat lihat semua perintah yang tersedia.

## Aturan aksesibilitas

Empat hal ini adalah syarat produk, bukan sekadar preferensi gaya:

1. Setiap alur harus bisa diselesaikan **tanpa mouse**.
2. **Cincin fokus nggak boleh dihapus.**
3. Setiap informasi yang keluar lewat TTS harus punya **padanan di ARIA live region**.
4. **Nggak boleh ada dua suara sekaligus.** Pilih salah satu: mode pembaca layar atau mode percakapan, jangan dua-duanya jalan bareng.

Uji minimal sebelum merge: **NVDA (Windows)** dan **TalkBack (Android)**.

## Lisensi

Apache-2.0, lihat [`LICENSE`](LICENSE).

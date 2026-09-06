<p align="center">
  <img src="assets/logo/Logo_horizontal_with_text.png" alt="KODMOD" width="420">
</p>

<p align="center">
  <strong>Asisten belajar AI agentic, audio-first, untuk siswa tunanetra.</strong><br>
  Bukan pembaca teks — pendamping berpikir.
</p>

---

## Latar belakang

Siswa tunanetra di Indonesia tidak kekurangan teknologi. Mereka sudah punya
JAWS, NVDA, braille display, dan audiobook. Yang belum ada adalah sesuatu yang
**menantang mereka bertanya, menganalisis, dan mengambil keputusan.**

Screen reader membacakan halaman. Ia tidak pernah bertanya balik.

KODMOD mengisi celah itu: tutor percakapan yang terikat kurikulum SLB A,
menilai penalaran alih-alih hafalan, dan melaporkan perkembangan siswa ke guru.

## Struktur

```
kodmod-ai/
├── apps/
│   ├── ai-engine/      Backend agentic — Python, FastAPI, LangGraph
│   └── web/            Antarmuka — React 19, Vite, Tailwind v4
├── docs/               Arsitektur, API, aksesibilitas, deployment
├── infra/docker/       Compose produksi, Caddy, Prometheus
├── assets/logo/        Aset merek
├── docker-compose.yml  Infrastruktur pengembangan lokal
└── Makefile            Perintah sehari-hari
```

## Empat cluster agent

| Cluster | Isi | Peran |
|---|---|---|
| Practices & Tutoring | Tutor Agent | Penjelasan Socratic berbasis RAG kurikulum |
| Quiz / Assessment | Scoring Agent, Quiz Analyzer | Menilai penalaran, menjelaskan letak salahnya |
| Content & Exercise | Problem Generator | Soal non-visual, divalidasi guru |
| Analytics & Reporting | Learning Analytics Agent | Dasbor siswa dan guru |

Detail per cluster: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Teknologi

| Lapisan | Pilihan |
|---|---|
| Orkestrasi | LangGraph + LangChain |
| LLM | Claude (bisa diganti OpenAI / Ollama / vLLM) |
| STT | faster-whisper, Deepgram |
| TTS | Piper, Azure, ElevenLabs |
| Embedding | BGE-M3 (multilingual) |
| Basis data | PostgreSQL 16 + pgvector, Redis |
| API | FastAPI + WebSocket |
| Antarmuka | React 19, Vite, Tailwind v4, TypeScript |

## Menjalankan

```bash
make infra-up     # Postgres (pgvector) + Redis
make install      # dependensi ai-engine + web
make api          # ai-engine  → http://localhost:8000
make web          # antarmuka  → http://localhost:5173
```

`make help` menampilkan semua perintah.

## Aturan aksesibilitas

Empat hal berikut adalah persyaratan produk, bukan preferensi gaya:

1. Setiap alur bisa diselesaikan **tanpa mouse**.
2. **Cincin fokus tidak boleh dihapus.**
3. Setiap informasi yang disuarakan TTS punya **padanan di ARIA live region**.
4. **Tidak pernah ada dua suara sekaligus** — pilih mode pembaca layar
   *atau* mode percakapan, tidak keduanya.

Uji minimal sebelum merge: **NVDA (Windows)** dan **TalkBack (Android)**.

## Lisensi

Apache-2.0 — lihat [`LICENSE`](LICENSE).

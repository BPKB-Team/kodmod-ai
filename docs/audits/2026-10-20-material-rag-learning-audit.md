# Audit materi PDF, grounding soal, dan alur Tutor

Audit berlangsung 19–20 Oktober 2026, pada checkout lokal `refined-ui-ux` di `778c5bc`. Screenshot pengguna berasal dari produksi. Database, file sumber, dan trace produksi **belum diperiksa**, sehingga laporan ini tidak menyatakan indeks produksi rusak.

## Kesimpulan

Masalah tidak dapat disimpulkan sebagai kegagalan pemetaan vektor. Pada lokal, chunk PostgreSQL dan Qdrant konsisten, tetapi ada jalur lain yang memberikan unit berisi komentar/judul kepada pembuat soal. Pemeriksaan kualitas soal belum menolak sumber tipis tersebut. PDF juga diratakan menjadi teks sehingga informasi penting hilang sebelum embedding. Aturan mencoba lagi belum membedakan Tutor dan asesmen mandiri.

Belum ada perbaikan kode produk, commit, push, merge, rebuild aplikasi, atau perubahan produksi pada audit ini. Perubahan data hanya corpus uji yang diminta pengguna di lingkungan lokal. Rencana implementasi dan desain disiapkan untuk ditinjau, ditambah audit StudentModel/progres sesuai permintaan berikutnya.

## Status Git dan pembaruan yang diperiksa

Fetch berhasil untuk main, goldenz/vps, refined-ui-ux, dan codex/vps-setup; origin/hanif tidak diikutkan. Working tree bersih sebelum dokumen laporan ditambahkan.

- `main`: `8e796ec`, dua commit lokal di depan `origin/main` (`526dbe2`). Belum didorong oleh audit ini.
- `refined-ui-ux`: `778c5bc`, delapan commit setelah main lokal; total sepuluh di depan origin/main, tidak tertinggal.
- Delapan commit terbaru mencakup refine toolbar/admin, UI kuis, footer, urutan navigasi siswa, pembacaan notasi matematika, respons Tutor, rekomendasi, dan indikator loading suara: `42b3ac7`, `40f811a`, `61c7687`, `3cb5a28`, `c6dd5a7`, `f96a592`, `aefb080`, `778c5bc`.

Perbandingan terhadap HEAD lokal setelah fetch: origin/main punya 0 commit unik, origin/refined-ui-ux 0, origin/codex/vps-setup 0, sedangkan origin/goldenz/vps masih punya satu commit unik `ab130e1` terkait password demo VPS. Commit itu belum digabung dan tidak menjadi prasyarat audit RAG. Jadi checkout memuat pembaruan UI yang diperiksa, tetapi seluruh branch remote belum dinyatakan sudah terkonsolidasi.

Hash enam file backend import, guided learning, generator, Qdrant, assessment service, dan main graph cocok dengan image API lokal. Ini membuktikan jalur backend yang diperiksa berjalan dengan sumber tersebut; bukan bukti seluruh UI/voice commit sudah terdeploy. Web Docker port 3200 berbasis image, bukan hot reload checkout.

## Temuan berprioritas

### P1 — Sumber mini kuis dapat berupa judul/metadata

`apps/ai-engine/api/learning_service.py:31` memecah unit berdasarkan heading tanpa menyaring frontmatter. Materi demo lokal “Dasar-Dasar Tata Surya” menghasilkan lima unit; dua pertama hanya komentar demo 114 karakter dan judul/metadata 91 karakter. `apply_learning_action` memulai kuis memakai `unit_source` langsung. Di `agents/problem_generator.py:149`, quiz_source_docs didahulukan atas RAGTool.retrieve, sehingga jalur ini tidak membutuhkan pencarian vektor.

Probe mengirim stem generik pada screenshot ke validator dan diterima. `validate_generated_questions` memeriksa struktur/count/source indices/options, belum apakah pertanyaan membutuhkan isi substantif atau jawabannya terbukti oleh evidence. Ini jalur lokal yang konsisten dengan gejala screenshot, bukan konfirmasi data produksi identik.

### P1 — Asesmen salah mengulang sekaligus membocorkan jawaban

`graphs/main_graph.py:97` mengirim nilai rendah ke tutoring berdasarkan jumlah percobaan, tanpa memisahkan assessment_kind. Request lokal nyata ke `/quiz/submit` menerima jawaban salah, memberikan pembahasan yang menyebut Ceres, tetapi next_question tetap order_index 0. Replay submission_id yang sama mengembalikan respons identik, sehingga idempotensi transport yang sudah benar harus dipertahankan.

`student-quiz.tsx` menebak retry dari order_index, lalu menampilkan “Coba jawab lagi”. Belum ada aksi Lanjut/skip/hint eksplisit. Agregasi skor memakai seluruh attempt, dan review soal terakhir perlu dipisahkan dari ringkasan akhir. Perubahan flow perlu outcome per soal, policy mode, dan evidence mastery yang tidak dihitung berulang.

### P1 — Ekstraksi PDF kehilangan struktur dan isi halaman campuran

`api/material_imports.py` memakai teks pypdf dan baru OCR jika teks native kurang dari lima karakter. Pada corpus nyata:

- Matematika halaman fisik 10: pangkat, pecahan, dan akar pada gambar PDF kehilangan relasi posisinya ketika menjadi plaintext.
- Kimia halaman fisik 13: isi “Tabel 3. Tata Nama Garam” terlihat pada render tetapi tidak hadir dalam hasil teks penuh halaman; halaman tetap memiliki banyak teks sehingga OCR tidak berjalan. CH₄ dan CO(NH₂)₂ menjadi CH4 dan CO(NH2)2 tanpa struktur subscript.
- IPA: gambar pengelompokan planet tidak menjadi konten yang bisa dipahami dari teks saja.

Normalisasi TTS yang baru tidak dapat memulihkan posisi pangkat yang sudah hilang saat ekstraksi. Ini sesuai [batas ekstraksi PDF yang dijelaskan pypdf](https://pypdf.readthedocs.io/en/stable/user/extract-text.html). Solusi yang diusulkan adalah AST terstruktur, layout/glyph, OCR region, dan review, dengan vision terbatas bila diperlukan.

### P1 — Dua jalur mini kuis belum berbagi grounding dan kebijakan

Guided Tutor memakai unit_source, sedangkan conversational `agents/quiz_agent.py:157` membuat mini kuis dari last_explanation dengan parse JSON. Yang terakhir tidak memakai seluruh pemeriksaan generator grounded. Ada risiko penjelasan AI menjadi satu-satunya sumber soal dan satu respons memicu pertanyaan evaluasi berulang. Perubahan pada `prompts/quiz_generator.md` juga belum menjamin perubahan perilaku: problem_generator memakai SYSTEM_PROMPT inline; tidak ditemukan referensi Python ke file prompt tersebut dalam pemeriksaan ini.

### P2 — Provenance dan guard revisi belum lengkap

Metadata chunk menyimpan rentang halaman seluruh import, belum lokasi halaman/blok spesifik. Guard `validate_assessment_source` membandingkan content_version tetapi belum mapping_version, meski versi mapping dipin di state. Perubahan pemetaan saat kuis aktif berpotensi menghasilkan evidence mastery yang tidak lagi sesuai pemetaan terkini.

### P2 — Vektor sehat, tetapi fallback dan kualitas retrieval perlu dibedakan

Sebelum import: 125 chunk PG dan Qdrant. Sesudah import dan persetujuan konsep: **157 vs 157**, missing=0, extra=0, stale=0. Mapping_version dan indexed_mapping_version tiga materi uji sama-sama 1. Retrieval terarah mengembalikan empat hasil dari materi yang benar, tanpa fallback penuh. Pembacaan PostgreSQL pada proses ini adalah hydration kandidat berizin.

Jalur generator meminta 20 kandidat dan melakukan fallback PG penuh pada materi yang hanya punya 18/7/7 chunk. Itu mekanisme fallback yang tersedia, bukan bukti vektor hilang. RAGTool dan retriever memiliki budget berbeda; perlu trace alasan fallback dan evaluasi recall. Reranker runtime nonaktif; menyalakannya tanpa benchmark belum menjadi solusi terukur.

### P2 — Kebenaran sumber berbeda dari ketepatan retrieval

Pada PDF IPA halaman fisik 22/label tercetak 16, render dan teks asli sama-sama menyebut orbit Merkurius 58 hari. [NASA menyatakan sekitar 88 hari](https://science.nasa.gov/mercury/facts/). Artinya, retrieval dapat setia pada PDF yang memuat kekeliruan. Corpus ini dipertahankan sebagai contoh review sumber; materi uji belum pantas dijadikan bank asesmen resmi tanpa tinjauan fakta.

### P3 — Editor dan satu kejadian keterlambatan visibilitas kelas

Form guru merender paragraf teks biasa dan memakai Textarea; editor admin juga Textarea. Belum ada penyimpanan dokumen kaya, sub/sup, tabel, atau aset gambar. Satu POST kelas diikuti enrollment langsung sempat 404 lalu kelas terlihat pada request berikutnya. Ini observasi transien; dugaan batas commit transaksi perlu uji tersendiri, belum dianggap akar masalah terbukti. Harness menunggu visibilitas kelas tanpa membuat kelas duplikat.

## Corpus PDF yang sudah diimport ke lokal

Ketiganya diambil dari repositori pendidikan pemerintah, dengan penulis dan mata pelajaran berbeda. Original dan preview seluruh buku tersimpan lokal; materi terbit dibatasi pada rentang isi berikut, di kelas uji tersendiri.

| Kelas lokal | PDF sumber | Halaman fisik materi | Isi/chunk |
| --- | --- | --- | --- |
| [UJI PDF] IPA - Tata Surya | [IPA Modul 11 Tata Surya](https://repositori.kemendikdasmen.go.id/36190/1/IPA_MODUL%2011_Tata%20Surya.pdf) | 12–28 dari 64 | 22.780 karakter / 18 chunk |
| [UJI PDF] Matematika - Eksponen dan Logaritma | [Matematika Peminatan X KD 3.1](https://repositori.kemendikdasmen.go.id/21931/1/X_Matematika-Peminatan_KD-3.1_Final.pdf) | 10–15 dari 51 | 9.093 karakter / 7 chunk |
| [UJI PDF] Kimia - Tata Nama Senyawa | [Kimia X KD 3.10](https://repositori.kemendikdasmen.go.id/22161/1/X_Kimia_KD-3.10_Final.pdf) | 9–13 dari 52 | 8.257 karakter / 7 chunk |

Pemilik kelas: guru.demo. Siswa terdaftar: siswa.demo dan baysatriow. Akun dan password tidak diubah. Setiap materi memiliki dua konsep sesuai mata pelajarannya dan indeks versi mapping yang sesuai. Label kelas/penjelasan menandai tujuan uji, bukan bank soal resmi.

| Materi | Class ID | Material ID | SHA-256 original |
| --- | --- | --- | --- |
| Tata Surya | 9a28faa3-a282-4f16-934d-d86b0b19b8f3 | d6c937d8-52bf-43e4-bcee-f9d28654138d | 266bfdf1a8a993501e36405a6409e8aaa60b71823f1dcb9f7aacf161b5f014af |
| Eksponen | 67198f81-6bdc-4bd3-8e67-7864c6b81828 | 26910526-8c76-4a08-b07f-d66fc3463792 | bfacd9647940fc7f34c81fa1fea53b6aa75a493f03b8e30deaa7c2a62a0388ca |
| Kimia | 4769a382-fe48-40ec-81cf-382fe8d09d0a | 02df7c17-e7ae-494b-8298-50398cd0294b | cc8db24d3ef6f344467cf72fc0f553720843748b6871bacfb477b30a8ed9aecb |

Local artifacts berada di `.runtime/pdf-rag-audit-2026-10-19/` yang diabaikan Git: PDF asli, render halaman pembanding, probes.json, vector-mapping-check.json, selected-results.json, retrieval-generation.json, dan script audit. JSON diagnostik dapat berisi teks sumber penuh/jawaban privat; jangan dipublish atau dimasukkan Git. Berkas sumber juga disimpan lewat endpoint import aplikasi di persistent upload volume.

## Pengujian dan batas buktinya

- **142 tes backend lulus** di container sekali pakai dengan source checkout saat ini, meliputi kualitas soal, scope RAG kelas, guided learning, pipeline materi/import/OCR, chunking, Qdrant, dan assessment service. Provider eksternal di tes fixture dimock.
- **63 tes web terfokus lulus** di Node Docker, meliputi normalisasi matematika, suara/narasi/autoplay, dialog, navigasi belajar, proxy guided learning/import, komponen kuis, serta copy UI. Tidak ada klik UI manual oleh agent.
- Tes lokal nyata memakai API/worker/database/vector/model yang dikonfigurasi: tiga PDF selesai diimport dan diindeks; tiga query retrieval terisolasi; tiga batch menghasilkan **9 soal**. Mayoritas stem merujuk isi sumber, tetapi contoh Ceres memperlihatkan ambiguitas istilah yang belum ditolak validator. Ini observasi sembilan soal, bukan estimasi kualitas keseluruhan.
- Submit salah nyata membuktikan retry paksa + jawaban bocor; replay request sama tidak menulis ulang respons. Tiga sesi kuis lokal dibiarkan untuk uji lanjutan pengguna.
- Audit ini tidak menjalankan seluruh suite, build rilis terbaru, pengujian device/screen reader, atau permintaan live ElevenLabs. Kelulusan baseline tidak berarti bug baru sudah diperbaiki atau rilis siap.

## Rencana yang disarankan

1. [Alur Tutor dan asesmen](../superpowers/plans/2026-10-20-learning-assessment-flow.md): kebijakan mode, hint/lanjut, outcome dan mastery sekali, recovery serta UI.
2. [StudentModel, progres dan poin](../superpowers/plans/2026-10-20-student-progress-points.md): progres materi tersimpan, coverage konsep, poin sesi tanpa persen, dan statistik di halaman Progres. [Audit tambahannya](2026-10-20-student-model-progress-audit.md) membuktikan jalur mapped assessment bekerja tetapi finish Tutor belum mengubah progres materi.
3. [Insight dan Planner](../superpowers/plans/2026-10-20-progress-insights-planner.md): satu fokus, saran berbasis evidence, maksimum tiga langkah yang dapat dimulai, persistence dan feedback dari hasil sesi.
4. [Dokumen, PDF, dan editor](../superpowers/plans/2026-10-20-material-document-pipeline.md): AST, aset, layout/OCR/vision terbatas, sumber per blok, editor bersama, learning units dan chunk.
5. [Grounding dan evaluasi agent](../superpowers/plans/2026-10-20-grounded-question-orchestration.md): sumber kanonik bersama, quality gate, prompt aktif tunggal, trace, golden corpus, dan backfill terkendali.

[Desain lengkap](../superpowers/specs/2026-10-20-grounded-material-learning-design.md) menentukan kontrak dan batas perilaku. Pengguna mengonfirmasi pada 20 Oktober 2026 bahwa Tugas/Kuis guru tetap mengikuti aturan rilis guru, sedangkan Latihan/Asesmen mandiri langsung memberi pembahasan lalu lanjut. Kebijakan ini sudah ditetapkan; kode implementasi belum diubah.

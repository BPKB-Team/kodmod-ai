# Audit lanjutan pembelajaran, PDF, dan progres

Tanggal: 20 Oktober 2026. Branch lokal: `goldenz/grounded-learning-progress` (sebelumnya `codex/grounded-learning-progress`). Worktree terisolasi; checkout utama tetap di `refined-ui-ux`. Setelah fetch, `origin/main...HEAD` adalah `0 28`. Tidak ada commit, merge, atau push pada audit ini.

## Temuan yang diperbaiki

1. **Sesi Tutor penuh bisa membuka sesi review Planner.** Pencarian sesi aktif hanya mencocokkan materi dan versi, sehingga `planned_review` dianggap sesi Tutor penuh. Sekarang hanya scope `full_material` yang boleh dilanjutkan. Dua regresi membuktikan kedua urutan pembukaan: review dahulu, maupun Tutor penuh dahulu. Sesi review tetap dapat diakses sendiri.
2. **Upload dokumen mata pelajaran meratakan ulang hasil ekstraksi.** Worker mengirim `preview.content` ke ingestion tanpa AST, sehingga blok `needs_review`/`excluded` diterima ulang sebagai teks legacy dan jejak halaman hilang. Worker kini meneruskan `MaterialDocument` tervalidasi. Regresi PostgreSQL memeriksa input embedding dan chunk tersimpan: hanya isi yang disetujui, dengan block ID, halaman, dan hash sumber yang benar. Embedding pada tes disimulasikan.
3. **PDF pengganti mewarisi atribusi PDF lama.** ID blok berbasis geometri dapat sama pada dua PDF berbeda. Preservasi atribusi kini dibatasi pada sumber yang sama. Untuk dokumen tanpa tautan impor, identitas sumber dibandingkan melalui hash dan ID impor per blok. Regresi memakai dua PDF nyata hasil ReportLab dengan tabel pada koordinat sama, lalu memeriksa penggantian sumber dan edit dalam sumber yang sama, baik dengan tautan impor maupun tanpa tautan impor. Perubahan halaman pada edit sumber yang sama tidak dapat menimpa atribusi awal.

Ketiga temuan direproduksi dengan tes gagal sebelum perbaikan, kemudian lulus setelah perbaikan. Review kedua menemukan variasi dokumen tanpa tautan impor pada temuan ketiga; variasi tersebut juga direproduksi dan diperbaiki.

## Pemeriksaan tipe dan tooling

Setelah memasang mypy pada container test, pemeriksaan kode inti menemukan 87 error di 15 berkas. Error diperbaiki melalui constructor AST bertipe, kontrak filter retrieval `TypedDict`, pemisahan variabel hasil OCR/DOCX, penghapusan dua key state duplikat, serta penanganan state/hasil kuis nullable. Adapter LangChain menyediakan argumen `func=None` untuk tool asinkron. Pencatatan awal belajar secara eksplisit menerima `completed_unit_id=None`, sesuai perilaku yang sudah ada.

Pemeriksaan inti berikut lulus untuk 114 berkas sumber:

```sh
python -m mypy --ignore-missing-imports agents graphs tools rag api analytics accessibility memory config
```

Run penuh berikutnya mengungkap empat error typing pada tes: tiga terkait stub ReportLab dan satu fixture yang memasukkan dict ke constructor bertipe. `reportlab` dan `types-reportlab` kini tercatat pada extra `test`, dan fixture memvalidasi dict menjadi `GroundedQuestion`. Ini tidak menambahkan dependensi ReportLab ke runtime produksi. Pada run final, gate typing kode inti dan tes sama-sama lulus; lint, format, dan pemeriksaan ketersediaan tooling juga lulus.

## Validasi dan batas bukti

- Tes Planner, guided learning, dan progres: **30 lulus** pada PostgreSQL terisolasi.
- Tes materi, AST, layout PDF, dan pipeline setelah perbaikan dokumen tanpa tautan impor: **50 lulus, 1 skip**. Skip membutuhkan Qdrant test tersendiri.
- **Run penuh final: 846 lulus, 127 skip, 2 gagal, 1 warning** dalam 162,74 detik. Kedua kegagalan merupakan gate yang memanggil executable Git, yang tidak tersedia di container: `tests/security/test_secret_hygiene.py::test_km_sec_072_env_not_in_image_context` dan `tests/static/test_sast_secrets.py::test_no_raw_secrets_in_tracked_files`. Keduanya gagal dengan `FileNotFoundError: git`, bukan temuan secret. Warning berasal dari plugin fixture pytest yang sudah terimpor.
- Pemeriksaan Git pada checkout asli lulus: `.env` diabaikan, tidak ada `.env` ter-track, konteks Docker mengecualikannya, dan pemindaian pola secret pada 351 berkas backend yang ter-track maupun baru tidak menemukan file yang cocok. Tidak ada nilai secret dicetak. Pemeriksaan ini tidak mengubah hasil dua gate Git di container.

Run Docker memakai mount source read-only, PostgreSQL/private schema, dan Redis test sementara; tidak memakai Redis aplikasi. Redis test dihentikan setelah run selesai. Provider AI dan embedding dimock pada regresi. Tidak dilakukan klik UI, pengujian screen reader/mobile, pemanggilan LLM/ElevenLabs nyata, atau perubahan data produksi.

Perintah run final dari root repository:

```sh
docker exec \
  -e KODMOD_GUIDED_POSTGRES=1 -e KODMOD_RETRIEVAL_POSTGRES=1 \
  -e AUDIO_DIR=/tmp/kodmod-test-audio -e UPLOAD_DIR=/tmp/kodmod-test-uploads \
  -e RUFF_CACHE_DIR=/tmp/kodmod-ruff -e MYPY_CACHE_DIR=/tmp/kodmod-mypy \
  -w /src/apps/ai-engine kodmod-learning-test \
  python -m pytest -p no:cacheprovider -q \
  --junitxml=/tmp/kodmod-followup-audit-final.xml --tb=short -r f
```

Perintah ini memerlukan PostgreSQL dan Redis test terisolasi yang sudah berjalan, serta extra test terpasang. XML hanya berada di container test; source dan laporan ini tersimpan di worktree.

Tes HTTP API/WS/E2E yang memerlukan server `localhost:8000`, Qdrant test tersendiri, serta pemeriksaan alat opsional yang belum tersedia tetap merupakan celah validasi. Kelulusan tes source tidak membuktikan kualitas semantik model live atau keberhasilan deployment.

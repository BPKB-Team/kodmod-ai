# Pemeriksaan indeks materi setelah pembaruan

Nomor versi indeks yang cocok belum menjamin indeks lama memiliki jejak sumber
yang diperlukan kuis. Setiap potongan materi perlu menyimpan `document_hash`,
`block_ids`, `spans`, dan versi pembagi blok yang sesuai dokumen saat ini.
Kuis menolak sumber yang kehilangan jejak tersebut sebelum memanggil generator.

Jalankan audit setelah pembaruan pipeline RAG atau pemindahan data lama:

```sh
sudo bash scripts/release.sh compose exec -T ai-engine python -m scripts.repair_material_indexes
```

Audit hanya membaca materi terbit di kelas aktif yang ditandai `ready`.
Hasil `needs_reindex` menjelaskan penyebabnya. Status `ready` saja tidak cukup
sebagai bukti bahwa pemrosesan terbaru sudah selesai.

Setelah backup database terverifikasi, antrekan pembangunan ulang indeks usang:

```sh
sudo bash scripts/release.sh compose exec -T ai-engine python -m scripts.repair_material_indexes --apply
```

Gunakan `--material-id UUID` untuk memeriksa atau memperbaiki satu materi dahulu.
Worker membuat kembali embeddings dan jejak sumber dari blok materi yang diterima.
Isi materi, versi konten/pemetaan, akun, keanggotaan kelas, dan progres tidak diedit.
Dokumen tanpa isi pembelajaran ditandai `no_learning_content` untuk ditinjau guru.

Tunggu pekerjaan indeks selesai, lalu audit kembali. Pastikan jumlah materi sehat
sesuai jumlah materi yang diperbaiki; materi `pending`, `processing`, dan `failed`
tidak termasuk hasil audit ini. Uji mulai latihan, jawab, review, lanjut sampai
selesai, serta tanya jawab Tutor dan mini kuis. Jangan menghapus validasi sumber
untuk menghindari respons 409.

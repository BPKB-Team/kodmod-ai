# Paket demo belajar umum KODMOD

**Status: SUDAH DIIMPOR KE INSTANCE LOKAL KODMOD (18 Oktober 2026).** Data akun dan aktivitas tersimpan di database lokal Docker Centre, jadi tidak ikut saat berkas repository di-push ke GitHub.

Paket ini berisi 20 bahan belajar orisinal berbahasa Indonesia dengan contoh umum dan tidak terikat kurikulum negara tertentu. Nama pada roster dibuat sintetis dan diberi penanda `[DEMO]`.

## Bahan belajar

| Berkas | Judul | Area | Konsep kandidat |
|---|---|---|---|
| `materials/01-fractions-part-and-whole.md` | Pecahan sebagai Bagian dari Keseluruhan | Matematika | Pecahan |
| `materials/02-equivalent-and-comparing-fractions.md` | Pecahan Senilai dan Membandingkan Pecahan | Matematika | Pecahan |
| `materials/03-fraction-operations.md` | Operasi Dasar Pecahan | Matematika | Operasi Pecahan |
| `materials/04-one-variable-equations.md` | Persamaan Linear Satu Variabel | Matematika | Persamaan Linear |
| `materials/05-perimeter-and-area.md` | Keliling dan Luas Bangun Datar | Matematika | Bangun Datar |
| `materials/06-reading-data-and-averages.md` | Membaca Data dan Ukuran Rata-Rata | Matematika | Data dan Statistik |
| `materials/07-photosynthesis.md` | Fotosintesis dan Aliran Energi | Sains | Fotosintesis |
| `materials/08-food-webs-and-energy-flow.md` | Jaring-Jaring Makanan dan Energi | Sains | Ekosistem |
| `materials/09-fair-science-investigation.md` | Merancang Penyelidikan yang Adil | Sains | Metode Ilmiah |
| `materials/10-solar-system-basics.md` | Dasar-Dasar Tata Surya | Sains | Tata Surya |
| `materials/11-percent-and-proportions.md` | Persentase, Rasio, dan Perbandingan | Matematika | Persentase dan Rasio |
| `materials/12-decimals-and-unit-conversion.md` | Desimal, Nilai Tempat, dan Konversi Satuan | Matematika | Desimal dan Satuan |
| `materials/13-coordinates-and-linear-patterns.md` | Koordinat dan Pola Linear | Matematika | Koordinat dan Pola |
| `materials/14-probability-and-chance.md` | Peluang dan Hasil Acak | Matematika | Peluang |
| `materials/15-states-of-matter.md` | Wujud Zat dan Model Partikel | Sains | Wujud Zat |
| `materials/16-forces-and-motion.md` | Gaya dan Gerak | Sains | Gaya dan Gerak |
| `materials/17-water-cycle.md` | Siklus Air dan Tempat Penyimpanan Air | Sains | Siklus Air |
| `materials/18-energy-transfer-and-transformation.md` | Perubahan dan Perpindahan Energi | Sains | Energi |
| `materials/19-checking-sources-and-evidence.md` | Memeriksa Sumber dan Bukti | Literasi Informasi | Evaluasi Sumber |
| `materials/20-claim-evidence-reasoning.md` | Menulis Penjelasan Berbasis Bukti | Bahasa dan Penalaran | Klaim dan Bukti |

Setiap berkas materi berisi tujuan belajar, penjelasan, contoh, dan latihan tanpa kunci jawaban. Unggah berkas di atas satu per satu melalui alur materi KODMOD. Jangan unggah file di `internal/` sebagai materi siswa.

Materi yang terbit dapat digunakan siswa untuk membaca. Agar Tutor memakai isi materi, materi perlu diproses sampai status indeks/RAG siap. Pemetaan konsep bersifat opsional: lakukan melalui UI hanya jika konsep yang sesuai memang tersedia.

## Tugas praktik dan kuis

Paket ini menambahkan 20 tugas terbuka yang dipasangkan satu per satu dengan materi, termasuk instruksi, bukti yang dikumpulkan, dan rubrik ringkas. Tugas-tugas ini adalah bahan pengajar; pengumpulan jawaban terbuka belum menjadi tugas aktif di website.

File `internal/quiz-templates.json` berisi 20 kuis pilihan ganda, masing-masing tiga soal, dengan opsi, jawaban benar, penjelasan, narasi, dan tingkat kesulitan. File ini khusus pengajar dan merupakan bank template, bukan payload API siap kirim. Alur `/siswa/tugas` KODMOD menggunakan kuis yang dibuat, ditinjau, disetujui, diterbitkan, lalu diberikan ke kelas. Sebelum membuat draft di environment test, pilih ID mata pelajaran yang benar; template belum memuat `subject_id` dari database.

Kunci latihan materi berada di `internal/kunci-jawaban-guru.md`.

## Roster siswa sintetis

Berkas `students-plan.csv` menyiapkan 50 profil dengan nama Indonesia, akun bernama `demo.siswa.001` sampai `demo.siswa.050`, jenjang bervariasi, preferensi aksesibilitas, dan lima pola penggunaan:

- 10 siswa rutin konsisten.
- 10 siswa meningkat bertahap.
- 10 siswa yang perlu latihan tambahan.
- 10 siswa dengan penggunaan sporadis.
- 10 siswa baru bergabung, termasuk profil yang belum memiliki aktivitas.

Kolom aktivitas adalah **rencana/simulasi**, bukan riwayat yang sudah tercatat di aplikasi. Roster tidak memuat kata sandi dan tidak membuat akun. Nilai durasi, jumlah sesi, skor, konsep kuat, dan fokus berikutnya baru menjadi progres website setelah aktivitas benar-benar tercatat melalui fitur aplikasi. Kuis mini dalam sesi tutor tidak diberi hitungan sesi asesmen mandiri terpisah.

## Cara menyelesaikan pengujian di website

1. Siapkan database khusus test KODMOD dan jalankan web serta API.
2. Buat akun melalui alur admin yang tersedia dengan kata sandi demo yang dibuat khusus untuk lingkungan test.
3. Buat kelas test, unggah materi, terbitkan, dan tunggu sampai status indeks siap.
4. Masuk sebagai beberapa akun dari tiap pola. Uji baca materi, Tutor, kuis mini Tutor, asesmen mandiri, tugas/kuis terbit di `/siswa/tugas`, progres, TTS, perpindahan halaman, dan pembacaan opsi.
5. Bandingkan progres dengan interaksi yang benar-benar dilakukan; jangan mengisi angka ringkasan secara manual.

Gunakan infrastruktur terisolasi `apps/ai-engine/docker/docker-compose.test.yml`: database `kodmod_test` berada pada port host 5434 secara default. Port 5433 pada Compose aplikasi adalah database aplikasi `kodmod`. Pastikan nama database dan port tujuan sebelum mengimpor data demo. Import yang tercatat pada status di atas dilakukan ke database aplikasi lokal; pengujian UI dengan fixture sementara tetap tidak membuat akun atau mengunggah materi.

## Referensi untuk memeriksa fakta

Materi ditulis ulang dengan kata-kata sendiri sebagai ringkasan belajar. Referensi berikut membantu memeriksa fakta inti:

- [OpenStax Prealgebra — Fractions](https://openstax.org/books/prealgebra/pages/4-introduction-to-fractions)
- [OpenStax Prealgebra — Averages and Probability](https://openstax.org/books/prealgebra/pages/5-5-averages-and-probability)
- [OpenStax Biology 2e — Photosynthesis](https://openstax.org/books/biology-2e/pages/8-1-overview-of-photosynthesis)
- [OpenStax Concepts of Biology — Energy Flow through Ecosystems](https://openstax.org/books/concepts-biology/pages/20-1-energy-flow-through-ecosystems)
- [NASA Science — About the Planets](https://science.nasa.gov/solar-system/planets/)
- [NASA Science — Solar System Facts](https://science.nasa.gov/solar-system/solar-system-facts/)
- [OpenStax Prealgebra — Persentase dan proporsi](https://openstax.org/books/prealgebra/pages/6-introduction-to-percents)
- [OpenStax Chemistry 2e — Wujud zat](https://openstax.org/books/chemistry-2e/pages/1-2-phases-and-classification-of-matter)
- [OpenStax Physics — Hukum kedua Newton](https://openstax.org/books/physics/pages/4-3-newtons-second-law-of-motion)
- [NOAA — Siklus air](https://www.noaa.gov/education/resource-collections/freshwater/water-cycle)
- [OpenStax Concepts of Biology — Siklus materi](https://openstax.org/books/concepts-biology/pages/20-2-biogeochemical-cycles)

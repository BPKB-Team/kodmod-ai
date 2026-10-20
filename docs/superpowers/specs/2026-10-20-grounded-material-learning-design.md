# Desain materi terstruktur, soal berbasis bukti, dan alur belajar

Tanggal: 20 Oktober 2026. Status: usulan untuk ditinjau; belum menjadi perubahan kode produk.

## Tujuan dan batas pekerjaan

Soal harus menguji isi pembelajaran yang benar-benar tersedia di materi, dengan jejak sumber yang dapat diperiksa guru. Tutor menawarkan bantuan proses dan pilihan lanjut. Latihan mandiri menyelesaikan satu soal setelah satu jawaban, menampilkan pembahasan, lalu menawarkan soal berikutnya. Editor dan import PDF mempertahankan struktur ilmiah dan gambar agar materi yang disimpan, dipelajari, dicari, dan dibacakan berasal dari representasi yang sama.

Audit serta import corpus lokal sudah dilakukan. Implementasi mengikuti rencana bertahap yang tercantum di bawah. Pekerjaan ini tidak mengubah produksi, melakukan merge/push, atau menyunting halaman pengaturan yang sedang dikerjakan agent lain.

Tambahan permintaan pengguna: audit StudentModel dan progres, serta gunakan poin selama sesi; persentase hanya di halaman Progres. Urutan rencana menjadi alur kuis → progres/poin → dokumen materi → grounding/evaluasi. Detail tambahannya ada di bagian 8.

Permintaan berikutnya menambahkan insight dan rencana belajar di halaman Progres. Bagian 9 menetapkan peran Planner dan hubungan saran dengan aksi serta hasilnya. Urutan implementasi diperbarui menjadi alur kuis → progres/poin → insight/Planner → dokumen materi → grounding/evaluasi.

## Dasar keputusan

Lihat [laporan audit](../../audits/2026-10-20-material-rag-learning-audit.md). Lokal mereproduksi unit belajar berisi komentar demo atau judul saja; mini kuis terpandu memakai unit itu secara langsung dan dapat melewati pencarian vektor. Validator menerima pertanyaan generik yang hanya memiliki format sah. Salah jawab pada asesmen lokal masih mengulang soal sambil membocorkan jawabannya. Sebaliknya, 157 ID/hash chunk PostgreSQL dan Qdrant konsisten dan retrieval terisolasi menurut materi yang dipilih. Temuan lokal belum membuktikan kondisi dataset produksi.

## Kendala global

- PostgreSQL tetap otoritas isi, hak akses, publikasi, content_version, dan mapping_version; Qdrant hanya kandidat vektor.
- Satu jawaban salah pada Latihan/Asesmen mandiri tidak memaksa mencoba lagi.
- Tutor selalu menyediakan Lanjut soal; bantuan sebelum penyelesaian tidak membocorkan jawaban final.
- Retry transport dengan submission_id yang sama mengembalikan receipt yang sama tanpa memanggil AI atau menulis mastery lagi.
- ElevenLabs tetap memakai model v2 dan cache 30 hari; hover/focus narration dan normalisasi matematika dipertahankan.
- Pengujian otomatis dijalankan di Docker; pengujian klik UI diserahkan kepada pengguna.
- Tidak ada merge/push atau perubahan produksi dalam pekerjaan audit dan perencanaan ini.
- Dokumen/PDF adalah data yang tidak dipercaya, bukan instruksi agent; tidak ada HTML mentah atau URL berkas bebas yang dieksekusi.

## 1. Kebijakan alur yang eksplisit

Kebijakan disimpan di sesi, bukan ditebak dari komponen embedded atau kesamaan order_index. Gunakan policy_version=2 untuk sesi baru; sesi lama dipertahankan sebagai v1 sampai selesai atau dimulai ulang. Kebijakan lama tidak boleh berubah diam-diam di tengah jawaban.

| Mode | Jawaban salah | Bantuan | Lanjut | Pengungkapan jawaban |
| --- | --- | --- | --- | --- |
| Tutor mini kuis / cek mandiri di Tutor | Tetap di soal dengan penjelasan letak kekeliruan | Petunjuk langkah berikutnya, retry opsional | Selalu boleh, termasuk sebelum menjawab | Setelah siswa menyelesaikan/melewati soal, dalam pembahasan yang diminta |
| Latihan / Asesmen mandiri | Jawaban dikunci, soal selesai | Pembahasan benar dan alur proses | Berikutnya tersedia langsung | Segera setelah jawaban diterima |
| Tugas/Kuis guru | Tetap mengikuti aturan tugas | Sesuai aturan rilis guru | Sesuai alur tugas yang ada | Tidak mempercepat jadwal rilis pembahasan |

Keputusan pengguna dikonfirmasi pada 20 Oktober 2026: Tugas/Kuis guru tetap mengikuti aturan rilis guru; Latihan/Asesmen mandiri langsung menampilkan pembahasan setelah jawaban diterima lalu lanjut. Rilis pembahasan tugas tidak dipercepat oleh Planner, insight, atau perubahan alur kuis. “Cek mandiri” yang dipanggil di dalam Tutor memakai kebijakan Tutor; halaman Asesmen mandiri memakai kebijakan mandiri. Konfirmasi ini menetapkan kebijakan rilis, bukan persetujuan untuk mengeksekusi seluruh rencana.

Sediakan endpoint aksi terpisah `POST /quiz/{session_id}/actions` dengan `action_id`, `question_id`, dan `action: hint|advance`. Jawaban tetap melalui `/quiz/submit`. Retry pembelajaran adalah jawaban baru dengan submission_id baru pada soal Tutor yang masih terbuka, bukan aksi yang mereset nilai. `advance` tanpa jawaban membuat outcome skipped, bukan jawaban salah buatan; setelah jawaban Tutor, ia menutup outcome yang sudah ada. `hint` memanggil AI dengan sumber dan misconception, bukan mengirim canonical answer ke klien.

Respons submit/recovery/aksi menyertakan `policy_version`, `question_state: answering|review|complete`, `available_actions`, dan `item_feedback` terpisah dari `final_summary`. Untuk asesmen mandiri, server mencatat outcome dan memajukan cursor dalam transaksi; UI menahan tampilan review soal yang baru dijawab sampai siswa memilih Berikutnya. Soal terakhir tetap menampilkan review sebelum ringkasan. Endpoint recovery mengembalikan review terakhir beserta cursor berikutnya secara eksplisit. Available actions divalidasi di server.

`advance` ketika review terbuka hanya mengakui review dan membuka cursor berikutnya, bukan memajukan cursor kedua kali. Submit baru ditolak selama review mandiri belum diakui. Tutor boleh advance dari soal terbuka langsung ke soal berikutnya; pembahasan soal yang dilewati tersedia sebagai review opsional, tanpa memaksa langkah tambahan. Matching receipt replay tetap memeriksa hak akses saat ini, lalu mengembalikan hasil lama tanpa mutasi; guard content/mapping diterapkan sebelum setiap aksi/jawaban baru.

Nilai resmi sesi v2 memakai **jawaban pertama per soal**; Tutor boleh menunjukkan keberhasilan setelah bantuan sebagai hasil belajar terpisah. Satu soal menghasilkan paling banyak satu event mastery berdasarkan jawaban pertama, diterapkan saat outcome ditutup. Hint sebelum jawaban menandai evidence assisted dan tidak meningkatkan mastery; skip tanpa jawaban tidak membuat event mastery. Retry tidak menambah denominator atau menghapus nilai pertama. Final_score = jumlah skor jawaban pertama / jumlah seluruh soal; skip bernilai 0 untuk penyelesaian sesi, tetapi bukan bukti miskonsepsi untuk mastery. Analitik menampilkan answered, skipped, dan assisted terpisah.

Simpan receipt aksi idempoten dan outcome soal dengan batas unik sesi+soal. Jangan mengubah AssessmentSubmission menjadi nullable serampangan: tambah tabel receipt aksi, outcome, dan hubungan event mastery yang kompatibel. Lock sesi berlaku untuk submit dan aksi agar hint/skip/submit bersamaan tidak melompati dua soal. Retry request dengan payload berbeda tetapi ID sama mendapat 409. Konten atau mapping berubah saat sesi aktif mendapat 409 sebelum scoring maupun mastery.

## 2. Satu representasi materi yang terstruktur

Tambah `MaterialDocument(schema_version=1)` sebagai JSON AST server-validatable. Root berisi blok stabil dengan ID, jenis, isi, status review, dan provenance. Blok: heading, paragraph, list, table, image, math. Inline: text dengan mark strong/emphasis/subscript/superscript, inline math LaTeX, dan tautan http(s) yang disanitasi. Tidak menerima script, event handler, iframe, HTML bebas, file path, atau LaTeX macro yang dapat memuat URL/HTML.

Batas AST awal: JSON encoded maksimum 2 MiB, 5.000 blok, kedalaman 12, dan proyeksi teks 100.000 karakter. Snapshot revisi dan aset lama tetap dipertahankan untuk kutipan/sesi lama; belum ada garbage collection aset otomatis pada tahap ini.

Setiap blok memiliki `role: instruction|example|exercise|answer_key|frontmatter|reference`, `confidence`, dan `review_state: accepted|needs_review|excluded`. Blok buatan guru dapat accepted saat disimpan. Hasil ekstraksi yang ambigu ditandai needs_review. Excluded/frontmatter/reference/answer_key tidak menjadi bukti soal. Exercise boleh dilihat sebagai latihan, tetapi tidak dipakai sebagai satu-satunya landasan penjelasan. Sumber lama dibungkus sebagai blok teks; jangan menebak pangkat yang telah hilang dari plaintext.

Untuk kompatibilitas, dokumen lama belum dimigrasi massal pada aktivasi fitur. Adapter baca membungkus paragraf substantif lama sebagai accepted dengan `review_origin=legacy_unverified`, bukan klaim persetujuan manusia; filter metadata dan quality gate tetap wajib. Materi lama yang sebelumnya siap tidak dinonaktifkan secara global. Unit yang ternyata kosong/ambigu menolak kuis per unit, dengan pesan tinjau materi. Re-extract PDF lama membuat draft revisi needs_review, dan baru mengganti versi aktif setelah disetujui guru. Persetujuan mapping lama tetap berlaku selama isi aktif tidak berubah.

`ClassMaterial.document` menyimpan AST; `content` tetap berupa proyeksi teks kompatibel bagi klien lama. Server adalah pembuat proyeksi. Klien mengirim document atau content, tidak keduanya. Document baru mengubah content_version dan menginvalidasi indeks serta persetujuan mapping seperti perubahan isi saat ini. Tahap awal semua perubahan AST dianggap revisi isi, termasuk format, untuk menghindari indeks yang kelihatan baru tetapi isinya lama. Optimasi format-only ditunda.

Proyeksi yang terpisah dan deterministik:

- tampilan: renderer AST yang sama untuk pratinjau, halaman materi, dan kutipan review;
- retrieval: teks dengan penanda matematika yang jelas, misalnya a^{p+q}, CO(NH_2)_2, beserta relasi baris/kolom tabel dan block IDs;
- narasi: kalimat yang dapat diucapkan, misalnya “a pangkat p tambah q”, dengan alt gambar yang ditinjau;
- learning units: heading digabung dengan penjelasan accepted yang mengikutinya, tidak menjadi unit judul saja.

Isi penjelasan, contoh, dan langkah penyelesaian dari sumber disimpan lengkap dalam batas import, bukan diganti ringkasan AI. Pemecahan unit boleh mengatur panjang penyajian, tetapi tidak membuang rincian materi. AI membantu pembacaan/struktur dan penyajian; tambahan fakta di luar sumber harus menjadi draft tambahan dengan sumber sendiri dan tinjauan guru, bukan dicampur otomatis ke evidence PDF.

Evidence gambar dibatasi pada alt/caption faktual yang disetujui guru, dengan block/asset ID yang dapat diperiksa. Generator tidak boleh menanyakan detail visual yang tidak tercantum pada deskripsi. Pemahaman gambar langsung oleh model saat membuat soal tidak termasuk tahap ini. Alt hasil AI belum accepted sampai ditinjau guru.

Tambah aset materi melalui upload multipart terotorisasi. Jenis awal PNG/JPEG/WebP, maksimum 10 MiB per aset, maksimum 20 megapiksel setelah decode. Validasi byte, re-encode, hapus metadata, tolak SVG/HTML. AST menyimpan asset_id; URL download melewati hak akses kelas/guru/admin. Alt wajib sebelum publikasi gambar instruksional, caption opsional; gambar dekoratif ditandai eksplisit. Jangan memasukkan base64 besar atau URL eksternal arbitrary ke dokumen.

## 3. Pembacaan PDF bertahap dan dapat ditinjau

Pilihan yang direkomendasikan: pertahankan pypdf untuk metadata/teks dasar, pypdfium2 untuk rendering, dan Tesseract ind+eng; tambahkan pembacaan glyph/layout/tabel menggunakan pdfplumber. Penggantian seluruh pipeline dengan OCR atau vision AI tidak diperlukan karena dapat menurunkan teks native yang sudah benar dan menaikkan biaya.

Urutan per halaman: native glyph+koordinat → blok dan urutan baca → deteksi tabel/gambar/posisi baseline matematika → OCR region yang belum terwakili → normalisasi AST → review guru. Halaman campuran tetap diperiksa meskipun memiliki lebih dari lima karakter teks. Gambar yang memuat tabel atau rumus harus dirender sebagai region; teks OCR digabung dengan blok native tanpa duplikasi. Jangan mengubah gambar menjadi deskripsi faktual rekaan.

Pertahankan batas saat ini: berkas maksimum 500 halaman, seleksi maksimum 150 halaman, proyeksi maksimum 100.000 karakter. Vision opsional lewat provider AI server yang sudah dikonfigurasi, default nonaktif. Batas awal 10 region per import, 1 request per region, timeout 45 detik, output JSON terstruktur maksimum 4.000 token per region, tidak ada retry otomatis berbayar. Setelah batas tercapai atau provider gagal, simpan region sebagai needs_review dengan gambar sumber; jangan menganggapnya berhasil. Cache hasil berdasarkan SHA sumber+halaman+bbox+versi extractor+model/prompt. Jangan mencatat API key atau isi siswa pada log.

Provenance menyimpan hash PDF, import ID, indeks halaman fisik 1-based, label halaman tercetak jika tersedia, bbox dalam koordinat PDF, block ID, extractor/method/version, dan confidence. Kutipan menunjuk blok/halaman yang benar, bukan sekadar seluruh rentang import.

Guru melihat PDF dan hasil ekstraksi berdampingan, dapat memperbaiki sub/sup/math/tabel/alt, mengecualikan sampul/daftar isi/kunci, lalu menyetujui versi. Materi tetap dapat disimpan sebagai draft saat quality gate gagal; status siap untuk Tutor/kuis hanya diberikan setelah blok relevan accepted dan indeks versi itu selesai. Terbit untuk dibaca dan siap untuk AI adalah status terpisah.

Kesetiaan pada PDF tidak sama dengan kebenaran fakta. Corpus lokal memiliki contoh kesalahan sumber; catat sebagai issue review dan bandingkan sumber otoritatif, jangan diam-diam menulis ulang semua fakta memakai AI. Tabel tak terbaca dan fakta yang ditandai guru tidak boleh menjadi evidence kuis sampai diperbaiki/disetujui.

## 4. Learning units, chunk, konsep, dan retrieval

Bangun learning units dan chunk dari blok accepted yang sama. Komentar HTML, identitas modul, running header/footer, daftar isi, referensi, dan kunci jawaban tidak menjadi unit belajar. Heading tanpa tubuh digabung ke bagian berikutnya; materi yang hanya berisi judul/metadata menghasilkan `insufficient_learning_content`, bukan mini kuis generik. Jangan menetapkan jumlah karakter minimum yang menolak rumus pendek yang valid; syaratnya ada blok penjelasan/contoh bermakna dengan konsep yang dapat diuji.

Chunk mempertahankan block IDs, page spans, hubungan tabel, content_version, mapping_version, document hash, serta konsep yang telah disetujui. Jangan memotong rumus atau melepaskan header tabel dari barisnya. Jika blok besar harus dipecah, ulangi konteks heading/header dengan provenance yang sama dan batas token yang terukur.

Konsolidasikan RAGTool dan retriever di satu façade agar batas kandidat, filter, dan trace konsisten. Tetap hydrate kandidat Qdrant melalui PostgreSQL berizin; itu operasi normal, bukan fallback. Rekam `candidate_count`, `hydrated_count`, `returned_count`, dan `fallback_reason: unavailable|stale|insufficient_authorized|none`. Jumlah chunk yang memang sedikit tidak memicu fallback penuh hanya karena lebih kecil dari requested top_k; kekurangan hasil berizin dibanding budget yang tersedia tetap dapat fallback. Uji recall sebelum memutuskan mengaktifkan reranker; jangan menjanjikan peningkatan dari sekadar menyalakan model.

Guard submit/recovery/aksi/penerbitan soal membandingkan content_version **dan** mapping_version. Materi yang belum memiliki mapping konsep tetap boleh dipelajari dan dibuatkan kuis berbasis materi jika evidence accepted memadai; skor sesi disimpan tanpa event mastery konsep. UI guru menampilkan mapping pending, dan analitik tidak menampilkan mastery palsu. Persetujuan mapping di tengah sesi mengharuskan mulai sesi baru melalui 409 seperti perubahan revisi lain. Sesi yang memakai versi lama tidak menulis mastery ke konsep versi baru.

## 5. Generator soal dan agentic flow

Satu jalur generator menerima `QuestionSourceBundle` dari retrieval atau accepted unit. Setiap source memiliki materi, block/chunk IDs, hash dan versi, teks evidence, serta scope pengguna. Unit langsung tetap harus melewati pemeriksaan yang sama; melewati vector search bukan alasan melewati validasi isi.

Simpan satu prompt generator yang aktif dan versioned; hapus duplikasi prompt yang tidak dipanggil atau hubungkan secara eksplisit. Output privat per soal memuat answer, rubric, explanation, evidence_refs, objective, dan cognitive_level. Client schema hanya memuat soal/options; answer/rubric/evidence jawaban tetap privat sebelum rilis.

Validasi dua tingkat: deterministik untuk struktur, source IDs, versi, duplikasi, generic title prompts, jenis soal/opsi; lalu semantic verifier untuk apakah evidence benar-benar mendukung jawaban, kesesuaian istilah/entitas, dan apakah soal memerlukan isi materi. Verifier hanya menilai sumber, tidak mencari fakta luar untuk melengkapi jawaban yang tidak tersedia. Contoh negatif wajib: pertanyaan judul pada screenshot; menyebut Ceres seolah salah satu delapan planet; soal rumus yang pangkatnya hilang; jawaban dari caption kosong.

Default batch tiga soal memuat minimal satu soal penerapan/penalaran jika sumber mendukungnya; jangan membuat tiga parafrasa definisi. Adaptasi level mengikuti kemampuan dan tujuan, bukan label medium semata. Maksimum tiga percobaan generasi total (awal + dua perbaikan) per batch. Kegagalan terakhir mengembalikan `source_quality_failed` dengan alasan yang dapat ditindaklanjuti guru, bukan template soal umum.

Pakai generator ini untuk kuis mandiri, kuis guided Tutor, dan mini_quiz_node conversational. `last_explanation` boleh menjadi konteks pedagogis tetapi tidak menjadi satu-satunya bukti faktual. Jangan membuka dua kuis dari satu giliran: pembuat kuis eksplisit menentukan penutup respons Tutor; prompt teach tidak sekaligus memaksa pertanyaan evaluasi kedua.

Flow deterministik: akses+versi → pilihan materi/unit → retrieval/evidence → quality gate → generate/verify → tampil soal → kebijakan mode → skor/feedback → outcome+mastery sekali → lanjut/ringkasan. Planner boleh memilih strategi penjelasan, tetapi tidak melonggarkan scope, rilis jawaban, atau transisi sesi. Hint menggunakan pola identifikasi kekeliruan → satu langkah proses → pertanyaan pemandu; gagal AI menggunakan petunjuk konservatif tanpa jawaban final.

## 6. Editor, aksesibilitas, dan instrumentasi

Gunakan satu MaterialRichEditor berbasis ekstensi terbuka Tiptap dan KaTeX untuk form guru serta admin. Toolbar ringkas: paragraf/judul, bold/italic, daftar, subscript, superscript, rumus, tabel, gambar, undo/redo. Next client editor memakai immediatelyRender=false; renderer baca tidak bergantung pada state editor. Editor tidak memiliki mode provider AI terpisah. Pengguna meninjau perubahan sebelum simpan/terbit.

Keyboard dapat menjangkau toolbar, input rumus, alt, dan aksi soal. Label/status menggunakan pola UiText yang sudah ada. TTS mengikuti hover/focus pada navigasi serta membaca proyeksi materi, tidak membacakan raw LaTeX/HTML, token, atau nilai input sensitif. Gambar instruksional memiliki deskripsi alternatif; tabel menggunakan header semantik. UI mengikuti desain refined yang sudah berjalan dan tidak mengubah pengaturan suara. Responsive mobile tetap menyediakan tombol nyata; gesture bukan satu-satunya cara mengerjakan soal.

Trace server menghubungkan request/session/question ke policy/prompt/extractor version, unit/block/chunk IDs, scope dan versi materi, quality decisions, fallback reason, jumlah pemanggilan model, latency dan biaya provider yang tersedia. Admin melihat alasan gagal dan sumber yang boleh diakses, tanpa answer key pada payload siswa. Hindari full prompt/isi siswa secara default. Tambahkan node spans untuk dua jalur Tutor agar masalah planner, extraction, retrieval, dan feedback bisa dibedakan.

## 7. Evaluasi, migrasi, dan peluncuran

Corpus lokal tiga mata pelajaran dipakai untuk fixture terukur; PDF asli dan hasil ekstraksi penuh tetap di penyimpanan lokal yang diabaikan Git. Commit hanya manifest URL/hash/rentang dan fixture kecil yang diizinkan atau sintetis. Tetapkan expected source blocks, rumus, tabel, dan klasifikasi bagian lewat tinjauan manusia sebelum menjadikannya golden set.

Acceptance minimum: nol kebocoran lintas kelas/materi dan jawaban sebelum rilis; semua contoh metadata-only ditolak; pangkat/subskrip/tabel sampel bertahan; expected evidence ditemukan untuk seluruh query golden set; hint tidak berisi canonical answer; asesmen salah maju satu soal; replay/concurrency tidak menggandakan outcome/mastery; recovery tidak kehilangan review soal terakhir. Laporan terpisah untuk fixture/mocked tests, live local AI, dan verifikasi produksi.

Peluncuran bertahap: (1) kebijakan kuis v2; (2) progres tersimpan dan poin sesi; (3) insight dan Planner yang dapat dijalankan; (4) dokumen/editor/import terstruktur untuk draft baru; (5) grounding bersama dan pilot corpus lokal; (6) backfill versi baru dari PDF asli dengan preview diff dan persetujuan guru. Sebelum migrasi deployment buat backup PostgreSQL dan sumber asli, verifikasi migrasi pada database uji, lalu jalankan canary. Pertahankan dokumen/revisi lama dan rollback feature flag; jangan menghapus volume atau mengubah sesi aktif otomatis. Re-extract dari PDF asli diperlukan untuk format yang sudah hilang.

Builder check independen telah dilakukan. Empat pertanyaan pentingnya diselesaikan di sini: kompatibilitas materi lama melalui adapter legacy_unverified, kuis tanpa mapping tanpa mastery, rilis tugas guru tetap, dan evidence gambar hanya deskripsi yang telah disetujui. Ini keputusan desain yang dapat ditinjau, bukan fitur yang sudah berjalan.

## 8. StudentModel, progres yang tersimpan, dan poin sesi

Audit tambahan membuktikan jalur asesmen dengan mapping yang disetujui menyimpan mastery dan dibaca API Progres. Satu jawaban benar membuat mastery konsep baru 0,625, satu event, dan n_attempts=1; replay tidak menambah evidence. Ini estimasi penguasaan konsep, bukan skor jawaban atau penyelesaian materi. Dua asesmen berbeda milik siswa yang sama sudah diserialisasi oleh lock User; guard itu dipertahankan. Jangan mengganti rumus StudentModel hanya agar angka terlihat naik.

Masalah lain terpisah: finish Tutor menyimpan akhir LearningSession tetapi tidak menghasilkan MaterialProgress. MaterialProgress saat ini hanya bookmark/selesai-baca manual, dan aggregator belum mengonsumsi progres unit. Mini kuis conversational juga tidak mencatat mastery untuk scope materi meskipun ada mapping, sedangkan REST assessment menggunakan approved snapshot. Penyatuan factory pada rencana grounding harus memperbaiki kesenjangan itu, bukan menghapus perlindungan terhadap materi unmapped.

### Poin selama sesi

Gunakan skala yang sudah ada di feedback per jawaban: **100 poin maksimum per soal**. Selama sesi tampilkan `Poin sesi 200 dari 300` dan `Soal 3 dari 3`; feedback item `100 dari 100 poin`. Total adalah jumlah poin, bukan rata-rata skor diberi label poin. Rumus per soal: first_score ternormalisasi × 100, pembulatan half-up ke integer, lalu dijumlahkan. Contoh dua skor 0,145 memberi 15+15=30 poin, bukan pembulatan rata-rata. Batas total = total_questions × 100, termasuk soal belum dijawab/skipped; nilai hanya bertambah dari soal yang ditutup, tidak dari hint/retry/replay.

ScoreSummary server berisi points_earned, points_possible, points_per_question=100, answered_questions, total_questions, skipped_questions, dan assisted_questions. Skala dipin pada sesi. Score/rubric 0..1 tetap untuk penilaian dan StudentModel; formal grade guru tetap disimpan sesuai kontrak lama. Tidak membuat mata uang XP/leaderboard/poin seumur hidup baru. Tugas formal tidak menampilkan poin earned/benar-salah selama pengerjaan. Sesudah submit, poin agregat boleh ditampilkan pada saat nilai resmi memang sudah tersedia menurut kontrak saat ini; poin/review per item tetap mengikuti rilis pembahasan guru. Jangan menyamakan rilis nilai agregat dengan rilis kunci jawaban.

Sesi v1 aktif mempertahankan perhitungan/hasil resmi lama. Jangan merekonstruksi total first-answer v2 secara retroaktif: respons `score_summary=null` dan `score_presentation=legacy_item_only`. UI baru hanya menampilkan poin jawaban terakhir (maksimum 100), jumlah soal, dan ringkasan selesai tanpa persen/total baru. Nilai resmi lama tetap tersedia pada Progres. Sesi baru memakai v2; client lama masih menerima field normalized yang kompatibel.

UI sesi, mini-kuis selesai, ringkasan selesai, aria label dan TTS sesi tidak menyebut %/persen/percent untuk skor/penguasaan. Progress bar selama sesi berlabel jumlah bagian/soal, bukan persen. Narasi deterministik memakai ScoreSummary, bukan membiarkan AI menambahkan persentase skor. Permintaan progres di dalam percakapan juga memakai jumlah aktivitas/poin dan tautan halaman Progres. Persentase penguasaan, akurasi, dan cakupan hanya ada pada halaman Progres beserta narasinya; persentase yang merupakan isi materi pelajaran tidak dihapus dari materi atau jawaban.

### Progres materi dan indikator yang dapat dibedakan

Tambah MaterialLearningProgress dengan unique(student_id, material_id, content_version, unit_manifest_hash). Simpan completed_unit_ids, total_units, status in_progress|completed, completed_at dan last_activity_at. Unit ditandai selesai saat Continue atau Finish diterima, bukan saat render/autoplay atau permintaan repeat/question. Replay dan membuka tab kedua melakukan set union unit IDs, tidak menambah hitungan dua kali. Finish menutup unit terakhir dan menyimpan completion versi itu dalam transaksi yang sama dengan receipt aksi/sesi; kegagalan commit tidak mengaku selesai.

Denominator adalah seluruh canonical units versi materi, bukan jumlah unit di sesi pilihan. Completed mensyaratkan seluruh canonical unit IDs tercakup dan Finish eksplisit yang sah. Finish hanya tersedia pada unit terakhir; bypass/finish parsial ditolak 409. Percakapan bebas atau belajar subset hanya mencatat aktivitas/cakupan, bukan completion materi penuh. Unit IDs sebelum AST memakai content_version+manifest_hash+index; setelah AST memakai versioned canonical block-group IDs. Manifest hash dihitung terlebih dahulu dari ordered base IDs, content hashes dan versi partitioner (tanpa memasukkan hash dirinya sendiri). Perubahan partitioner tidak menggabungkan indeks lama ke bagian baru. Current projection memilih manifest aktif dan menyimpan riwayat manifest lama, tanpa konversi coverage spekulatif.

MaterialProgress lama tetap menyimpan bookmark dan selesai-baca manual. DTO materi menyajikan reading_completed dan learning_progress terpisah, dengan overall_learning_status yang mengenali completion Tutor **pada versi aktif**. Kartu tidak menampilkan “belum belajar” ketika Tutor telah selesai. Tombol selesai-baca tetap mengubah status bacaan, tidak membatalkan completion Tutor; tidak ada reset tersembunyi. Completion manual lama adalah laporan baca, bukan bukti mastery. Revisi materi menyimpan riwayat versi lama dan menampilkan bahwa versi terbaru belum diselesaikan; jangan mengonversi sesi lama secara otomatis menjadi mastery baru.

Dashboard menampilkan aktivitas, bagian/materi selesai, dan cakupan konsep yang dinilai secara terpisah dari mastery. Materi tanpa mapping atau jawaban tetap terlihat sebagai aktivitas; mastery yang belum punya evidence ditampilkan “belum dinilai”, bukan dianggap kemampuan nol. Mastery dapat turun setelah jawaban salah atau decay; penyelesaian versi materi tidak turun hanya karena mastery turun. Persentase mastery rata-rata tetap cumulative; filter waktu berlaku pada aktivitas/hasil periode dan dijelaskan pada label.

Analitik v2 memakai outcome pertama per soal untuk skor resmi dan akurasi, dengan jumlah raw attempts/hint/assisted terpisah. Data v1/historis ditandai legacy, tidak dicampur diam-diam dengan denominator baru. Tampilkan waktu aktivitas terakhir, rentang waktu aktif, coverage assessed/mapped, serta status mapping pending. UI mengakses API no-store dan memperbarui data saat kembali dari sesi/refresh; jangan menyimpulkan masalah cache tanpa bukti.

Hint sebelum jawaban pertama berarti assisted: tidak ada mastery event sama sekali, baik kenaikan maupun penurunan, dan tidak masuk assessed-concept coverage. Raw activity/attempt serta assisted count tetap dicatat. Hint yang diberikan setelah jawaban pertama tidak mengubah evidence pertama yang sudah unassisted. Rumus StudentModel tidak berubah; eligibilitas evidence ditentukan outcome/policy sebelum pemanggilan update.

Tambahkan parameter timezone IANA untuk batas “hari ini”; default backend UTC menjaga klien lama, halaman Progres baru mengirim timezone browser (Asia/Jakarta untuk pengguna ini). Week/month tetap rolling 7/30 hari. Response memuat timezone serta batas waktu UTC yang dipakai. Riwayat 4–5 Oktober tidak muncul pada filter 7 hari tanggal audit 20 Oktober dan tetap tersedia di Semua waktu. Durasi start–end dengan jeda semalaman adalah durasi sesi, bukan bukti belajar aktif; gunakan label yang jujur dan jangan menciptakan active_minutes tanpa data aktivitas yang cukup.

Acceptance tambahan: jawaban benar mapped menghasilkan perubahan SQL→API→UI; dua sesi bersamaan tidak kehilangan update; finish Tutor mengubah progres materi versi aktif tanpa memberi mastery gratis; retry/hint/refresh tidak menambah poin; n unit selesai tidak melebihi total; sesi bebas persen untuk tampilan/narasi skor; halaman Progres tetap menampilkan persentase yang sesuai data. Laporan terpisah: [audit StudentModel dan progres](../../audits/2026-10-20-student-model-progress-audit.md).

Builder check tambahan menyelesaikan tiga ambiguitas: completion harus seluruh canonical units + Finish; sesi v1 hanya menampilkan poin item, tanpa total v2 retroaktif; assisted-before-first-answer tidak menghasilkan mastery event maupun assessed coverage.

## 9. Insight dan Planner pada halaman Progres

### Kondisi kode saat audit dan tanggung jawab

Graph utama sekarang menghubungkan analytics → recommendation → accessibility. Belum ditemukan node Planner tersendiri pada jalur aktif checkout ini; guided graph bahkan menyatakan memakai aksi eksplisit tanpa planner. Recommendation Agent menghasilkan structured_recommendations dalam state. Halaman Progres membaca active_recommendations dari tabel Recommendation; helper store_recommendation ada, tetapi pemanggilan produksi yang menghubungkan output node tersebut ke helper tidak ditemukan dalam pemeriksaan ini. Karena itu, menambah kartu UI saja belum menghubungkan saran dengan kegiatan belajar.

Gunakan tiga tanggung jawab, tanpa tiga panggilan AI untuk data yang sama:

| Komponen | Tugas | Batas |
| --- | --- | --- |
| Analytics / StudentModel | Menghasilkan fakta aktivitas, coverage, outcome pertama, mastery/confidence, dan perubahan yang didukung evidence | Tidak membuat angka/tren atau mastery dari klik |
| Planner Agent | Memilih satu fokus dan urutan maksimum tiga langkah dari kandidat materi/aksi yang sah | Tidak menambah target atau melonggarkan kebijakan kuis, hak akses, dan rilis jawaban |
| Recommendation / presentation | Menjelaskan alasan singkat dan menyajikan tombol langkah dari rencana tervalidasi | Tidak membuat rencana lain yang bertentangan atau menyimpan teks bebas tanpa target |

Planner menggunakan satu pemanggilan melalui get_recommendation_llm yang sudah dikonfigurasi untuk memilih candidate IDs dan penjelasan terstruktur. Recommendation pada jalur ini menjadi adapter penyajian, tidak memanggil model lagi. Rule-based planner selalu tersedia jika model gagal; tidak ada provider/menu AI baru. Output AI tidak dipercaya sampai lolos schema, candidate scope, evidence dan policy checks.

Fakta angka dan observasi dirender deterministik dari fact IDs. Model memilih goal_candidate_id, step_candidate_ids, dan reason_fact_ids yang telah disediakan, bukan membuat angka, URL, diagnosis, atau fakta baru dalam teks bebas. Untuk MVP rencana memakai evidence terbaru dalam rolling 30 hari ditambah progres aktif/cumulative snapshot yang berizin; filter grafik hari/minggu/bulan tidak mengganti rencana yang sedang berjalan. Label periode pada insight tetap sesuai evidence-nya.

### Susunan halaman yang diusulkan

1. **Fokus belajarmu sekarang**: satu tujuan, alasan pendek yang dapat diperiksa, perkiraan durasi, dan satu tombol utama Mulai/Lanjutkan. Contoh ilustratif: “Latih sifat perkalian eksponen” → “Dua jawaban terakhir perlu bantuan pada aturan pangkat.” Angka/kalimat ini hanya tampil jika ada evidence yang cocok; bukan teks placeholder untuk semua siswa.
2. **Yang bisa kamu pelajari dari progresmu**: maksimum tiga insight, dipilih dari kemajuan yang teramati, konsep yang perlu latihan, dan pola aktivitas. Tiap insight memuat observasi → arti yang terbatas → tindakan berikutnya. Jangan menampilkan konsep yang sama sekaligus sebagai kekuatan dan kelemahan.
3. **Rencana singkat berikutnya**: maksimum tiga langkah, misalnya tinjau satu bagian materi → latihan tiga soal → jelaskan satu konsep. Estimasi total 10–15 menit adalah perkiraan, bukan waktu belajar aktif yang telah tercatat. Setiap langkah memiliki target nyata, status, serta aksi; jumlah soal mengikuti kecukupan sumber dan kebijakan generator.
4. **Detail progres**: persentase penguasaan/akurasi/coverage, materi dan tugas selesai, aktivitas terakhir dan riwayat. Informasi lebih rinci ditempatkan setelah fokus dan langkah, agar siswa langsung tahu apa yang dapat dilakukan.

Sediakan Dengarkan ringkasan untuk fokus+alasan+langkah, penjelasan Mengapa saran ini?, serta pilihan mengganti fokus atau melewati saran. Alasan adalah fakta/evidence yang disetujui untuk siswa, bukan chain-of-thought model. Keyboard, fokus heading, hover narration, dan mobile punya tombol yang sama. Nama agent tidak perlu tampil sebagai jargon pada antarmuka siswa.

### Pemilihan insight dan tujuan

Snapshot masukan berasal dari transaksi yang sudah committed: outcome v2, aktivitas legacy yang diberi label, coverage unit, mapping/quality status, misconception yang tervalidasi, serta target kelas yang dapat diakses. Simpan evidence refs, waktu, sumber dan versi. Jangan menjadikan low score akibat ekstraksi/generator gagal sebagai bukti siswa tidak memahami materi.

Committed tidak otomatis berarti boleh diketahui siswa. Nilai agregat tugas boleh masuk insight agregat saat memang dirilis, tetapi outcome/konsep per item dan alasan kelemahan dari tugas hanya boleh dipakai setelah feedback item dirilis menurut aturan guru. Filter ini berlaku sebelum pemilihan kandidat, snapshot hash dan input model, bukan hanya menyembunyikan teks akhir. Jika MasteryScore mencampur evidence formal yang belum boleh dibuka, jangan memakai snapshot mentah itu untuk insight/target konsep; proyeksikan dari visible events yang lengkap atau tampilkan belum cukup data bila riwayat tidak lengkap. Internal mastery tersimpan tidak ditulis ulang. Release feedback memicu refresh baru. Dua kondisi dengan data publik sama dan hasil item privat berbeda harus menghasilkan kandidat/fakta publik yang sama.

Default awal yang akan dievaluasi: label kuat/lemah memerlukan sedikitnya tiga soal independen tanpa bantuan pada konsep itu, dari dua sesi berbeda. Satu jawaban benar hanya memberi insight “data awal mulai tercatat”, bukan klaim sudah menguasai. Kuat jika mastery >=0,8; perlu latihan jika mastery <0,6 dengan evidence cukup. Penurunan karena lama tidak berlatih disebut kebutuhan mengulang, bukan klaim salah konsep. Tren naik/turun memerlukan setidaknya dua titik evidence bertanggal yang dapat dibandingkan. Threshold ini kebijakan awal versioned, bukan klaim validasi pedagogis.

Urutan kandidat: lanjutkan unit aktif yang masih sah; bila evidence konsep kurang, cek awal singkat; bila evidence cukup menunjukkan kebutuhan latihan, remediasi pada materi yang sesuai; bila fokus stabil, lanjut bagian berikutnya. Pilih satu fokus, bukan daftar seluruh kelemahan. Prasyarat hanya dipakai jika relasinya tercatat dan disetujui, tidak diciptakan AI. Tugas formal hanya ditautkan melalui alur tugas yang sudah ada; Planner tidak otomatis memulai/menjawab/menilai tugas.

Materi unmapped tetap boleh disarankan untuk dibaca atau latihan berbasis materi tanpa mastery konsep; jelaskan bahwa penguasaan belum dinilai. Bila tidak ada materi yang diterbitkan/siap, berikan langkah yang dapat dilakukan siswa (pilih kelas atau hubungi guru) tanpa membuat link/topik palsu. Sebelum start, ulangi validasi enrollment, publication, archive, content/mapping/manifest versions, dan readiness sumber. Terbitnya materi baru atau dicabutnya akses dapat membatalkan target lama.

### Rencana yang tersimpan dan penyelesaian yang nyata

Tambahkan LearningPlan dan LearningPlanStep; Recommendation lama dapat menjadi proyeksi kompatibel dari langkah tervalidasi. Satu rencana aktif per siswa, dengan revision, source_snapshot_hash, policy/prompt version, goal, evidence_refs, generated_at, valid_until dan status active|completed|superseded. Langkah menyimpan kind review_unit|practice|self_explain, material/concept/unit target, expected versions, estimated_minutes, serta status pending|in_progress|completed|skipped|invalidated. Semua URL dibentuk server dari target yang tervalidasi, bukan teks URL buatan model.

Memilih Mulai hanya menandai in_progress dan membuat/melanjutkan sesi melalui kontrak yang sudah ada. Tombol atau membuka halaman tidak menandai langkah completed. Completion review mengikuti receipt penyelesaian unit; practice mengikuti sesi kuis yang selesai pada target/versi yang benar; self_explain mengikuti jawaban yang diterima atau skipped sesuai kebijakan Tutor. Salah menjawab tetap dapat menyelesaikan aktivitas latihan; tidak otomatis berarti target mastery sudah tercapai. Plan completion tidak memberi mastery/poin gratis.

Pembaruan mempertahankan langkah selesai dan yang sedang dikerjakan. Hanya langkah pending yang direncanakan ulang setelah hasil sesi baru committed; jangan mengganti fokus pada setiap jawaban/refresh. Target yang tidak lagi sah dibatalkan dengan alasan dan alternatif yang sah. Jika semua langkah selesai, tandai rencana completed; jangan menambahkan langkah tanpa akhir. Hari lokal berikutnya atau permintaan eksplisit rencana baru membuka cycle baru, dengan idempotency agar klik ganda tidak membuat dua rencana.

### Pemicu, biaya, dan kegagalan

GET guidance hanya membaca snapshot/rencana dan insight deterministik; tidak memanggil AI atau membuat job. POST refresh yang eksplisit dari client, atau outbox sesi/grade/material completion, memastikan job planner dengan dedupe key(student, cycle, source_snapshot_hash, policy/prompt/language). Outbox ditulis dalam transaksi sumber yang sama dan baru terlihat worker setelah commit; preview graph tidak menerbitkan saran. Refresh tampilan biasa tidak mengulang model. Jika belum ada rencana, tampilkan insight/fokus fallback dari kandidat yang sah sambil tombol Mulai menyiapkan rencana; jangan membiarkan halaman kosong atau menunggu AI untuk menampilkan statistik.

Gunakan antrean SQL durable yang sudah ada dengan handler kind progress_plan yang terdaftar jelas, bukan BackgroundTasks tanpa receipt. Worker material tidak boleh mengambil kind baru lalu gagal unknown kind; dispatcher/registry diperluas secara eksplisit. Satu panggilan model maksimum 10 detik per snapshot, tanpa retry berbayar otomatis; gagal/timeout menghasilkan rencana rule-based dengan kontrak sama. Input baru yang datang saat generasi berjalan membatalkan publikasi hasil stale. Lock/lease/fencing dan unique keys mencegah rencana ganda; jangan menahan transaksi mastery selama panggilan model.

UI dapat menampilkan rencana tersimpan yang masih sah saat refresh disiapkan, dengan waktu evidence yang jelas. Sumber yang telah dicabut tidak boleh tetap menjadi CTA aktif. Regenerasi saran tidak menulis nilai, mengubah jawaban, atau mengungkap kunci. Payload model berisi fitur/evidence minimum, tanpa API key, profil lengkap, atau jawaban privat yang tidak diperlukan.

### Acceptance dan prioritas implementasi

Prioritas setelah progres/poin: insight faktual + satu CTA → rencana tersimpan maksimum tiga langkah → feedback dari sesi memperbarui langkah pending. Tambahan kalender, streak/gamifikasi/leaderboard, notifikasi terjadwal, dan planner multi-hari ditunda.

Uji wajib di Docker dengan fixture dan SQL/HTTP nyata: cold start, satu evidence, unmapped, mutu sumber rendah, duplicate refresh, stale worker, enrollment dicabut, publisher mengedit materi, model timeout, selesai/rerun/skip/replay, dua tab dan dua bahasa. Assert setiap rekomendasi memiliki evidence serta target sah, tidak ada persentase skor pada sesi, tidak ada answer leak, tidak ada mastery gratis, dan plan yang selesai tetap tersimpan setelah restart. Evaluasi live AI terbatas diperlukan saat implementasi untuk menilai apakah alasan dan langkah benar-benar sesuai data; belum dijalankan pada tahap perencanaan ini.

Builder check tambahan telah dilakukan. Pertanyaan penting tentang kebocoran hasil tugas melalui fokus/alasan diselesaikan dengan visibility filtering sebelum snapshot/model dan pemisahan rilis grade agregat dari feedback item. [Rencana implementasi insight/Planner](../plans/2026-10-20-progress-insights-planner.md) menguraikan kontrak dan tesnya.

## Referensi teknologi

- [pypdf: batas ekstraksi teks dan struktur PDF](https://pypdf.readthedocs.io/en/stable/user/extract-text.html).
- [pdfplumber: glyph, koordinat, dan tabel](https://github.com/jsvine/pdfplumber).
- [Tiptap Next.js](https://tiptap.dev/docs/editor/getting-started/install/nextjs), [mathematics](https://tiptap.dev/docs/editor/extensions/nodes/mathematics), [subscript](https://tiptap.dev/docs/editor/extensions/marks/subscript), [superscript](https://tiptap.dev/docs/editor/extensions/marks/superscript), dan [image](https://tiptap.dev/docs/editor/extensions/nodes/image). Image node memerlukan endpoint upload aplikasi tersendiri.

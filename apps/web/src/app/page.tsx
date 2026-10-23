import Image from "next/image";
import Link from "next/link";
import { ArrowRight, AudioLines, BookOpen, Check, Keyboard, MessageCircle, ListChecks, TrendingUp, BarChart3, Users, GraduationCap, LogIn, Sparkles, HelpCircle } from "lucide-react";
import LandingMenu from "@/components/LandingMenu";
import { ExperienceToolbar } from "@/components/experience-toolbar";
import { LandingFaqList } from "@/components/landing-faq";
import { getServerI18n } from "@/lib/server-language";
import "../styles/landing.css";
import "../styles/public-learning.css";
import { TutorAgentDemo } from "@/components/tutor-agent-demo";
import { LandingFooter } from "@/components/landing-footer";

const navigation = [["#tentang", "Tentang KODMOD"], ["#cara-belajar", "Cara belajar"], ["#untuk-guru", "Untuk guru"], ["#faq", "Pertanyaan umum"]];
const menuKeys: Record<string, string> = { "#tentang": "about", "#cara-belajar": "how", "#untuk-guru": "features", "#faq": "faq" };

export default async function HomePage() {
  const { t } = await getServerI18n();
  return <div className="landing-v2 landing-refined">
    <header className="lp-header"><div className="lp-nav-wrap">
      <Link href="/" className="lp-brand" aria-label="KODMOD" data-voice-menu="home">
        <Image src="/brand/symbol.png" alt="" width={37} height={39} /><span>KODMOD<span className="lp-brand-dot">.</span></span>
      </Link>
      <nav className="lp-desktop-nav" aria-label={t("Navigasi utama")}>
        {navigation.map(([href, label]) => <a href={href} key={href} data-voice-menu={menuKeys[href]}>{t(label)}</a>)}
      </nav>
      <div className="lp-header-actions"><ExperienceToolbar /><Link className="lp-login" href="/masuk" data-voice-menu="login">{t("Masuk")}<ArrowRight size={16} aria-hidden="true" /></Link></div>
      <LandingMenu links={navigation} />
    </div></header>
    <main id="konten-utama" tabIndex={-1}>
      <section className="lp-hero">
        <div className="lp-grid" aria-hidden="true" />
        <div className="lp-globe-mesh" aria-hidden="true">
          <svg viewBox="0 0 1000 1000" fill="none" className="lp-globe-svg" aria-hidden="true">
            <defs>
              <radialGradient id="globeGlowGrad" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.16" />
                <stop offset="50%" stopColor="#2563eb" stopOpacity="0.06" />
                <stop offset="90%" stopColor="#020817" stopOpacity="0" />
              </radialGradient>
              <linearGradient id="globeLineGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.35" />
                <stop offset="50%" stopColor="#60a5fa" stopOpacity="0.15" />
                <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0.04" />
              </linearGradient>
            </defs>
            <circle cx="500" cy="500" r="440" fill="url(#globeGlowGrad)" />
            <circle cx="500" cy="500" r="440" stroke="url(#globeLineGrad)" strokeWidth="1.5" strokeDasharray="6 6" />
            <circle cx="500" cy="500" r="350" stroke="url(#globeLineGrad)" strokeWidth="1" strokeDasharray="4 6" opacity="0.6" />
            <ellipse cx="500" cy="500" rx="440" ry="130" stroke="url(#globeLineGrad)" strokeWidth="1" strokeDasharray="3 5" />
            <ellipse cx="500" cy="500" rx="440" ry="260" stroke="url(#globeLineGrad)" strokeWidth="1" strokeDasharray="3 5" />
            <ellipse cx="500" cy="500" rx="150" ry="440" stroke="url(#globeLineGrad)" strokeWidth="1" strokeDasharray="3 5" />
            <ellipse cx="500" cy="500" rx="300" ry="440" stroke="url(#globeLineGrad)" strokeWidth="1" strokeDasharray="3 5" />
            <ellipse cx="500" cy="500" rx="510" ry="170" stroke="#60a5fa" strokeWidth="2" opacity="0.32" transform="rotate(-24 500 500)" />
            <ellipse cx="500" cy="500" rx="560" ry="200" stroke="#38bdf8" strokeWidth="1" strokeDasharray="8 8" opacity="0.22" transform="rotate(-24 500 500)" />
          </svg>
        </div>
        <div className="lp-orbit lp-orbit-one" aria-hidden="true" />
        <div className="lp-orbit lp-orbit-two" aria-hidden="true" />
        <div className="lp-container lp-hero-layout">
          <div className="lp-hero-copy">
            <div className="lp-slogan-pill" data-voice-menu="slogan" tabIndex={0}>
              <Sparkles size={14} className="lp-slogan-sparkle" aria-hidden="true" />
              <span>{t("BEYOND ACCESS, BEYOND SIGHT")}</span>
            </div>
            <div className="lp-agentic-subtitle" data-voice-menu="agentic-sub" tabIndex={0}>
              <span>{t("AGENTIC AI LEARNING ASSISTANT FOR VISUALLY IMPAIRED STUDENTS")}</span>
            </div>
            <h1 data-voice-menu="hero-title">{t("Pahami pelajaran,")}<br />{t("selangkah demi selangkah.")}</h1>
            <p data-voice-menu="hero-subtitle">{t("Belajar dari materi guru, tanyakan yang belum kamu pahami, dan berlatih bersama Tutor AI. Pilih teks atau suara yang nyaman untukmu.")}</p>
            <div className="lp-actions">
              <Link href="/daftar" className="lp-btn lp-btn-blue lp-hero-cta" data-voice-menu="cta-start">
                <span>{t("Mulai belajar")}</span>
                <ArrowRight size={19} aria-hidden="true" />
              </Link>
            </div>
          </div>
          <div className="lp-hero-visual">
            <div className="lp-art-glow" aria-hidden="true" />
            <Image className="lp-hero-art" src="/images/landing/hero-learning.svg" alt={t("Ilustrasi buku belajar interaktif KODMOD")} width={800} height={800} priority />
            <div className="lp-floating lp-floating-top" data-voice-menu="floating-listen" tabIndex={0}>
              <span className="lp-icon"><AudioLines size={22} aria-hidden="true" /></span>
              <div>
                <strong>{t("Dengarkan penjelasan")}</strong>
                <small>{t("Jeda, ulangi, atau lanjutkan.")}</small>
              </div>
            </div>
            <div className="lp-floating lp-floating-bottom" data-voice-menu="floating-ask" tabIndex={0}>
              <span className="lp-icon"><MessageCircle size={21} aria-hidden="true" /></span>
              <div>
                <strong>{t("Tanyakan yang belum paham")}</strong>
                <small>{t("Satu pertanyaan setiap langkah.")}</small>
              </div>
            </div>
          </div>
        </div>
        <div className="lp-principles lp-container" data-voice-menu="principles" tabIndex={0}>
          <span><BookOpen size={19} aria-hidden="true" />{t("Materi dari guru")}</span>
          <span><MessageCircle size={19} aria-hidden="true" />{t("Tutor yang menemani")}</span>
          <span><ListChecks size={19} aria-hidden="true" />{t("Latihan & penugasan")}</span>
        </div>
      </section>

      {/* SECTION BARU: DEMO INTERAKTIF AGENTIC AI TUTOR */}
      <section className="lp-agentic-demo-section" id="demo-tutor" aria-labelledby="agentic-demo-heading">
        <div className="lp-container">
          <div className="lp-agentic-section-header">
            <span className="lp-agentic-badge" data-voice-menu="demo-badge" tabIndex={0}>
              <Sparkles size={14} aria-hidden="true" />
              <span>{t("Simulasi Tutor AI")}</span>
            </span>
            <h2 id="agentic-demo-heading" className="lp-agentic-title" data-voice-menu="demo-heading" tabIndex={0}>{t("Coba Langsung Simulasi Tutor AI")}</h2>
            <p className="lp-agentic-desc">
              {t("Ketik pertanyaan materi pelajaran yang ingin kamu pelajari, atau pilih topik cepat di bawah. Saksikan langkah berpikir AI yang menyusun analogi khusus audio untuk membantu pemahaman konsep secara mendalam.")}
            </p>
          </div>
          <TutorAgentDemo />
        </div>
      </section>

      {/* 5 Core Solution Pillars Showcase from Pitch Deck */}
      <section className="lp-pillars-section" id="pilar-solusi">
        <div className="lp-container">
          <div className="lp-pillars-header">
            <div className="lp-sdg-showcase" data-voice-menu="sdg-badge" tabIndex={0} aria-label={t("Target PBB SDG 4: Pendidikan Berkualitas")}>
              <div className="lp-sdg-logo-box">
                <Image
                  src="/images/landing/sdgs.png"
                  alt={t("Tujuan Pembangunan Berkelanjutan PBB nomor 4: Pendidikan Berkualitas")}
                  width={200}
                  height={100}
                  className="lp-sdg-img"
                  priority
                />
              </div>
              <div className="lp-sdg-meta">
                <span className="lp-sdg-kicker">{t("KOMITMEN GLOBAL")}</span>
                <strong className="lp-sdg-headline">{t("Target SDG 4: Pendidikan Berkualitas")}</strong>
              </div>
            </div>
            <div className="lp-pillars-title-wrap">
              <span className="lp-pillars-tag" data-voice-menu="pillars-tag" tabIndex={0}>{t("Pilar Solusi KODMOD")}</span>
              <h2 className="lp-pillars-headline" data-voice-menu="slogan-section" tabIndex={0}>{t("BEYOND ACCESS, BEYOND SIGHT")}</h2>
            </div>
          </div>

          <div className="lp-pillars-grid">
            <div className="lp-pillar-card" data-voice-menu="pillar-audio" tabIndex={0}>
              <div className="lp-pillar-icon wave"><AudioLines size={24} aria-hidden="true" /></div>
              <h3>{t("Belajar dengan Suara")}</h3>
              <p>{t("Arsitektur multisensori yang memprioritaskan narasi suara jernih, navigasi keyboard tanpa mouse, dan interaksi yang ramah pembaca layar.")}</p>
            </div>
            <div className="lp-pillar-card" data-voice-menu="pillar-practice" tabIndex={0}>
              <div className="lp-pillar-icon pencil"><ListChecks size={24} aria-hidden="true" /></div>
              <h3>{t("Latihan dan Asesmen")}</h3>
              <p>{t("Latihan interaktif dan kuis terstruktur dengan opsi ramah aksesibilitas untuk menguji pemahaman konsep secara bertahap.")}</p>
            </div>
            <div className="lp-pillar-card" data-voice-menu="pillar-feedback" tabIndex={0}>
              <div className="lp-pillar-icon chat"><MessageCircle size={24} aria-hidden="true" /></div>
              <h3>{t("Umpan Balik Kognitif")}</h3>
              <p>{t("Tutor AI memberikan analogi konkret dan panduan berpikir selangkah demi selangkah yang disesuaikan untuk siswa disabilitas netra.")}</p>
            </div>
            <div className="lp-pillar-card" data-voice-menu="pillar-adaptive" tabIndex={0}>
              <div className="lp-pillar-icon trend"><TrendingUp size={24} aria-hidden="true" /></div>
              <h3>{t("Pembelajaran Adaptif")}</h3>
              <p>{t("Ritme belajar adaptif yang mengikuti pemahaman dan respon siswa, memudahkan mereka mengulang atau mendalami topik.")}</p>
            </div>
            <div className="lp-pillar-card" data-voice-menu="pillar-analytics" tabIndex={0}>
              <div className="lp-pillar-icon chart"><BarChart3 size={24} aria-hidden="true" /></div>
              <h3>{t("Analitik dan Pelaporan")}</h3>
              <p>{t("Laporan progres dan penguasaan konsep yang transparan bagi guru dan pendidik untuk mendampingi intervensi belajar tepat sasaran.")}</p>
            </div>
          </div>

          {/* Dual Impact Bar: For Students | For Educators */}
          <div className="lp-dual-value-bar">
            <div className="lp-dual-val-col" data-voice-menu="val-students" tabIndex={0}>
              <span className="lp-dual-icon student"><Users size={22} aria-hidden="true" /></span>
              <div>
                <strong>{t("Untuk Siswa")}</strong>
                <p>{t("Belajar lebih dalam")}: {t("Eksplorasi materi secara mandiri dengan pendampingan AI interaktif.")}</p>
              </div>
            </div>
            <div className="lp-dual-divider" aria-hidden="true" />
            <div className="lp-dual-val-col" data-voice-menu="val-teachers" tabIndex={0}>
              <span className="lp-dual-icon teacher"><GraduationCap size={22} aria-hidden="true" /></span>
              <div>
                <strong>{t("Untuk Pendidik")}</strong>
                <p>{t("Mengajar lebih cerdas")}: {t("Distribusi materi cepat, peninjauan kuis otomatis, dan pemantauan menyeluruh.")}</p>
              </div>
            </div>
          </div>
        </div>
      </section>
      <section id="tentang" className="lp-about-section">
        <div className="lp-container lp-section">
          <div className="lp-section-heading" data-voice-menu="heading-about"><h2>{t("Semua kebutuhan belajar,")}<br />{t("lebih mudah dijangkau.")}</h2><p>{t("Dirancang untuk siswa tunanetra dan siswa dengan penglihatan terbatas, dengan pendampingan guru.")}</p></div>
          <div className="lp-capability-grid">
            {[
              [BookOpen, "Materi belajar", "Buka materi dari kelasmu dan lanjutkan bacaan dari bagian terakhir.", "feature-materials"],
              [MessageCircle, "Tutor AI", "Bahas materi, minta contoh sederhana, dan dengarkan penjelasannya.", "feature-tutor"],
              [ListChecks, "Latihan & penugasan", "Uji pemahaman melalui latihan dan kuis yang ditugaskan guru.", "feature-practice"],
              [TrendingUp, "Progres belajar", "Lihat hasil belajar dan tentukan bagian yang perlu dilatih lagi.", "feature-progress"],
            ].map(([Icon, title, copy, voiceKey]) => { const FeatureIcon = Icon as typeof BookOpen; return <article key={title as string} className="lp-capability" data-voice-menu={voiceKey as string} tabIndex={0}><span className="lp-feature-icon"><FeatureIcon size={24} aria-hidden="true" /></span><h3>{t(title as string)}</h3><p>{t(copy as string)}</p></article>; })}
          </div>
        </div>
      </section>
      <section id="cara-belajar" className="lp-flow-section"><div className="lp-container lp-section">
        <div className="lp-section-heading" data-voice-menu="heading-how"><h2>{t("Mulai dari materi,")}<br />{t("lanjutkan dengan rasa ingin tahu.")}</h2><p>{t("Atur suara sekali. Setelah itu, belajar dengan ritmemu sendiri.")}</p></div>
        <div className="lp-flow-layout"><div className="lp-student-art"><Image src="/images/landing/student-voice.svg" alt="" width={960} height={1080} /></div>
          <ol className="lp-steps">{[
            ["Bergabung dengan kelas", "Daftar sebagai siswa, lalu buka kelas yang kamu ikuti.", "step-1"],
            ["Pilih materi belajar", "Baca atau dengarkan materi yang sudah dibagikan guru.", "step-2"],
            ["Tanyakan dan latih pemahamanmu", "Bertanya kepada Tutor, kemudian kerjakan latihan atau tugas.", "step-3"],
            ["Lanjutkan dari progresmu", "Lihat hasil, baca pembahasan yang tersedia, dan lanjutkan belajar.", "step-4"],
          ].map(([title, copy, stepKey], index) => <li key={title} data-voice-menu={stepKey} tabIndex={0}><span className="lp-step-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><div><h3>{t(title)}</h3><p>{t(copy)}</p></div></li>)}</ol>
        </div>
      </div></section>
      <section id="untuk-guru" className="lp-teacher-section"><div className="lp-container lp-section lp-teacher"><div>
        <div data-voice-menu="section-teacher">
          <h2>{t("Siapkan pembelajaran.")}<br />{t("Dampingi setiap siswa.")}</h2>
          <p>{t("Kelola kelas, bagikan materi, dan siapkan kuis dengan peninjauan sebelum dipublikasikan. Pantau hasil siswa untuk menentukan langkah belajar berikutnya.")}</p>
        </div>
        <ul className="lp-checks">{[
          ["Unggah materi dan atur publikasinya", "teacher-check-material"],
          ["Tinjau kuis, lalu tugaskan ke kelas", "teacher-check-quiz"],
          ["Pantau hasil dan progres siswa", "teacher-check-progress"],
        ].map(([copy, voiceKey]) => <li key={copy} tabIndex={0} data-voice-menu={voiceKey}><Check size={18} aria-hidden="true" /><span>{t(copy)}</span></li>)}</ul>
        <Link href="/daftar" className="lp-btn lp-btn-outline" data-voice-menu="register">{t("Daftar sebagai guru")}<ArrowRight size={18} aria-hidden="true" /></Link>
      </div><div className="lp-teacher-art"><Image src="/images/landing/teacher-support.svg" alt="" width={1200} height={900} /></div></div></section>
      <section className="lp-access-section" id="aksesibilitas"><div className="lp-container lp-access-layout"><div><h2>{t("Pilih cara belajar")}<br />{t("yang nyaman untukmu.")}</h2></div>
        <div className="lp-access-items">{[
          [Keyboard, "Keyboard & pembaca layar", "Fokus terlihat, label jelas, dan navigasi berurutan.", "access-1"],
          [BookOpen, "Tampilan yang bisa disesuaikan", "Aktifkan teks lebih besar dan pilihan navigasi geser.", "access-2"],
          [AudioLines, "Kendali suara di tanganmu", "Atur pembaca menu dan suara Tutor secara terpisah.", "access-3"],
        ].map(([Icon, title, copy, accessKey]) => { const AccessIcon = Icon as typeof Keyboard; return <div key={title as string} data-voice-menu={accessKey as string} tabIndex={0}><AccessIcon aria-hidden="true" /><h3>{t(title as string)}</h3><p>{t(copy as string)}</p></div>; })}</div>
      </div></section>
      <section id="faq" className="lp-faq-section">
        <div className="lp-faq-bg-pattern" aria-hidden="true" />
        <div className="lp-faq-glow lp-faq-glow-1" aria-hidden="true" />
        <div className="lp-faq-glow lp-faq-glow-2" aria-hidden="true" />

        {/* Pernak-pernik aksen edukatif */}
        <div className="lp-faq-decor-badge lp-faq-badge-left" aria-hidden="true">
          <span className="lp-faq-decor-icon bg-blue"><Sparkles size={16} /></span>
          <div>
            <strong>{t("Tutor AI 24/7")}</strong>
            <small>{t("Interaktif & ramah")}</small>
          </div>
        </div>

        <div className="lp-faq-decor-badge lp-faq-badge-right" aria-hidden="true">
          <span className="lp-faq-decor-icon bg-emerald"><GraduationCap size={16} /></span>
          <div>
            <strong>{t("Ramah Tunanetra")}</strong>
            <small>{t("Audio & keyboard")}</small>
          </div>
        </div>

        <div className="lp-container lp-faq-container">
          <div className="lp-faq-header">
            <div className="lp-faq-badge-pill" data-voice-menu="faq-badge" tabIndex={0}>
              <HelpCircle size={14} className="lp-faq-badge-icon" aria-hidden="true" />
              <span>{t("BANTUAN & FAQ")}</span>
            </div>
            <h2>{t("Pertanyaan umum")}</h2>
            <p>{t("Hal yang perlu kamu tahu sebelum mulai.")}</p>
          </div>

          <LandingFaqList
            items={[
              { question: "Bagaimana cara membuat akun?", answer: "Pilih Daftar, isi nama, username dan kata sandi, lalu pilih peran siswa atau guru. Tidak perlu kode undangan.", key: "faq-1" },
              { question: "Apakah saya harus menggunakan suara?", answer: "Kamu bisa menggunakan teks. Pembaca menu dan suara Tutor dapat diatur terpisah dari tombol pengaturan suara.", key: "faq-2" },
              { question: "Bisa menggunakan suara dari HP?", answer: "Bisa. Pilih Suara perangkat dalam pengaturan. Ketersediaan suara bergantung pada perangkat dan browsermu.", key: "faq-3" },
              { question: "Bagaimana Tutor menggunakan materi?", answer: "Pilih materi kelas di ruang Tutor agar penjelasan mengacu pada materi yang kamu pelajari.", key: "faq-4" },
              { question: "Apakah tersedia Bahasa Inggris?", answer: "Pilih EN dari menu bahasa. Tampilan dan jawaban Tutor mengikuti bahasa pilihanmu. Materi guru tetap menggunakan bahasa aslinya.", key: "faq-5" },
            ]}
          />
        </div>
      </section>

      {/* Dedicated Sponsor & Ecosystem Section */}
      <section className="lp-sponsors-section" id="sponsor">
        <div className="lp-sponsors-bg-glow" aria-hidden="true" />
        <div className="lp-container">
          <div className="lp-sponsors-header">
            <div className="lp-sponsors-badge" data-voice-menu="sponsor-badge" tabIndex={0}>
              <Sparkles size={14} className="lp-sponsors-badge-icon" aria-hidden="true" />
              <span>{t("SPONSOR & KOLABORASI")}</span>
            </div>
            <h2 className="lp-sponsors-title" data-voice-menu="sponsor-title" tabIndex={0}>
              {t("Didukung oleh Ekosistem Digital Terdepan")}
            </h2>
            <p className="lp-sponsors-desc" data-voice-menu="sponsor-desc" tabIndex={0}>
              {t("Kolaborasi strategis menghadirkan pembelajaran inklusif berstandar tinggi bagi seluruh siswa di Indonesia.")}
            </p>
          </div>

          <div className="lp-sponsors-grid">
            {/* Tier 1: Main Sponsor (Telkom Indonesia) */}
            <div className="lp-sponsor-card lp-sponsor-card-lead" data-voice-menu="sponsor-telkom" tabIndex={0}>
              <div className="lp-sponsor-tier-badge lead">
                <span className="lp-tier-dot" aria-hidden="true" />
                <span>{t("Sponsor Utama")}</span>
              </div>
              <div className="lp-sponsor-logo-box lead">
                <Image
                  src="/images/landing/Sponsor/telkom-indonesia.png"
                  alt="Telkom Indonesia"
                  width={340}
                  height={190}
                  className="lp-sponsor-logo lead"
                />
              </div>
              <div className="lp-sponsor-content">
                <h3 className="lp-sponsor-name">{t("PT Telkom Indonesia (Persero) Tbk")}</h3>
                <p className="lp-sponsor-copy">
                  {t("Mendukung penuh inovasi teknologi inklusif dan kecerdasan buatan untuk masa depan pendidikan Indonesia.")}
                </p>
              </div>
            </div>

            {/* Tier 2: Subgrid for Telin & Telkom University */}
            <div className="lp-sponsors-subgrid">
              {/* Co-Sponsor: Telin */}
              <div className="lp-sponsor-card lp-sponsor-card-sub" data-voice-menu="sponsor-telin" tabIndex={0}>
                <div className="lp-sponsor-tier-badge telin">
                  <span>{t("Mitra Global Connectivity")}</span>
                </div>
                <div className="lp-sponsor-logo-box">
                  <Image
                    src="/images/landing/Sponsor/telin.png"
                    alt="Telin"
                    width={220}
                    height={110}
                    className="lp-sponsor-logo"
                  />
                </div>
                <div className="lp-sponsor-content">
                  <h3 className="lp-sponsor-name">{t("PT Telekomunikasi Indonesia International (Telin)")}</h3>
                  <p className="lp-sponsor-copy">
                    {t("Menghubungkan ekosistem digital KODMOD dengan infrastruktur telekomunikasi global yang handal.")}
                  </p>
                </div>
              </div>

              {/* Academic Partner: Telkom University */}
              <div className="lp-sponsor-card lp-sponsor-card-sub" data-voice-menu="sponsor-telu" tabIndex={0}>
                <div className="lp-sponsor-tier-badge telu">
                  <span>{t("Mitra Akademik & Riset")}</span>
                </div>
                <div className="lp-sponsor-logo-box">
                  <Image
                    src="/images/landing/Sponsor/telkom-university.png"
                    alt="Telkom University"
                    width={180}
                    height={110}
                    className="lp-sponsor-logo telu"
                  />
                </div>
                <div className="lp-sponsor-content">
                  <h3 className="lp-sponsor-name">{t("Telkom University")}</h3>
                  <p className="lp-sponsor-copy">
                    {t("Kolaborasi riset pendidikan, validasi materi ajar, dan pendampingan implementasi kurikulum inklusif.")}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-cta-refined" id="mulai-belajar">
        <div className="lp-cta-bg-glow" aria-hidden="true" />
        <div className="lp-container">
          <div className="lp-cta-card">
            <div className="lp-cta-badge-pill" data-voice-menu="cta-badge" tabIndex={0}>
              <Sparkles size={14} className="lp-slogan-sparkle" aria-hidden="true" />
              <span>{t("MULAI SEKARANG")}</span>
            </div>
            <h2 className="lp-cta-headline" data-voice-menu="cta-title" tabIndex={0}>
              {t("Siap mulai belajar?")}
            </h2>
            <p className="lp-cta-subheadline" data-voice-menu="cta-desc" tabIndex={0}>
              {t("Buat akunmu dan pilih cara belajar yang paling nyaman.")}
            </p>

            <div className="lp-cta-actions-wrap">
              <Link
                href="/daftar"
                className="voice-game-voice-btn lp-cta-btn-primary"
                data-voice-menu="cta-register"
                aria-label={t("Buat akun")}
              >
                <span className="lp-cta-btn-icon" aria-hidden="true">
                  <ArrowRight size={20} strokeWidth={2.5} />
                </span>
                <span className="lp-cta-btn-text">
                  <strong>{t("Buat akun")}</strong>
                </span>
              </Link>

              <Link
                href="/masuk"
                className="voice-game-voice-btn lp-cta-btn-secondary"
                data-voice-menu="cta-login"
                aria-label={`${t("Sudah punya akun?")} ${t("Masuk")}`}
              >
                <span className="lp-cta-btn-icon secondary" aria-hidden="true">
                  <LogIn size={18} />
                </span>
                <span className="lp-cta-btn-text">
                  <strong>{t("Sudah punya akun?")} {t("Masuk")}</strong>
                </span>
              </Link>
            </div>

            <div className="lp-cta-perks-row" aria-label={t("Keunggulan KODMOD")}>
              <span className="lp-cta-perk-item">
                <Check size={16} strokeWidth={3} className="lp-perk-check" aria-hidden="true" />
                <span>{t("100% Ramah Pembaca Layar")}</span>
              </span>
              <span className="lp-cta-perk-dot" aria-hidden="true">•</span>
              <span className="lp-cta-perk-item">
                <Check size={16} strokeWidth={3} className="lp-perk-check" aria-hidden="true" />
                <span>{t("Suara Jernih AI")}</span>
              </span>
              <span className="lp-cta-perk-dot" aria-hidden="true">•</span>
              <span className="lp-cta-perk-item">
                <Check size={16} strokeWidth={3} className="lp-perk-check" aria-hidden="true" />
                <span>{t("Akses Gratis")}</span>
              </span>
            </div>
          </div>
        </div>
      </section>
    </main>
    <LandingFooter />
  </div>;
}

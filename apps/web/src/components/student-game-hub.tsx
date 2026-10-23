"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  Library,
  BookOpen,
  Sparkles,
  ListChecks,
  ClipboardList,
  LineChart,
  ArrowRight,
  Volume2,
} from "lucide-react";
import { UiText, useI18n } from "./language-provider";
import { findGridNeighbor } from "@/lib/student-grid-navigation.mjs";
import type { Classroom, StudentMaterial } from "@/lib/class-types";
import type { User } from "@/lib/types";

const GAME_PAD_ROUTES = [
  "/siswa/tutor",
  "/siswa/latihan",
  "/siswa/tugas",
  "/siswa/progres",
  "/siswa/kelas",
  "/siswa/materi",
];

interface StudentGameHubProps {
  user: User;
  classes: Classroom[];
  materials: StudentMaterial[];
}

export function StudentGameHub({
  user,
  classes,
  materials,
}: StudentGameHubProps) {
  const { t } = useI18n();
  const router = useRouter();
  const activeClasses = classes.filter((c) => !c.is_archived);
  const completedCount = materials.filter((m) => m.learning_progress?.status === "completed").length;
  const nextMaterial = materials.find((m) => m.learning_progress?.status !== "completed");

  // References to game pad anchor elements for arrow-key spatial navigation
  const padRefs = useRef<(HTMLAnchorElement | null)[]>([]);

  const gamePads = [
    {
      num: "1",
      href: GAME_PAD_ROUTES[0],
      voiceKey: "tutor",
      title: "Tutor AI",
      desc: "Tanya jawab langsung dengan suara",
      stat: t("AI Interaktif"),
      icon: Sparkles,
    },
    {
      num: "2",
      href: GAME_PAD_ROUTES[1],
      voiceKey: "practice",
      title: "Latihan & Kuis",
      desc: "Asesmen mandiri langkah demi langkah",
      stat: t("Kuis Mandiri"),
      icon: ListChecks,
    },
    {
      num: "3",
      href: GAME_PAD_ROUTES[2],
      voiceKey: "assignments",
      title: "Tugas Siswa",
      desc: "Daftar penugasan dari bapak ibu guru",
      stat: t("Penugasan"),
      icon: ClipboardList,
    },
    {
      num: "4",
      href: GAME_PAD_ROUTES[3],
      voiceKey: "progress",
      title: "Progres Belajar",
      desc: "Laporan capaian dan evaluasi suara",
      stat: `${completedCount} ${t("Selesai")}`,
      icon: LineChart,
    },
    {
      num: "5",
      href: GAME_PAD_ROUTES[4],
      voiceKey: "classes",
      title: "Kelas Saya",
      desc: "Ruang kelas dan guru pendamping",
      stat: `${activeClasses.length} ${t("Kelas Aktif")}`,
      icon: Library,
    },
    {
      num: "6",
      href: GAME_PAD_ROUTES[5],
      voiceKey: "materials",
      title: "Pustaka Materi",
      desc: "Semua modul dan bahan bacaan",
      stat: `${materials.length} ${t("Materi")}`,
      icon: BookOpen,
    },
  ];

  // Hotkey listener: 1-6 for instant routing, arrow keys for spatial navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement;
      const isInput =
        active &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName);
      const isModal = document.querySelector(".swal2-shown, dialog[open]");
      if (isInput || isModal) return;

      // Number shortcuts 1 - 6
      const keyNum = parseInt(e.key, 10);
      if (keyNum >= 1 && keyNum <= 6) {
        e.preventDefault();
        const target = GAME_PAD_ROUTES[keyNum - 1];
        if (target) {
          router.push(target);
        }
        return;
      }

      // Arrow keys follow the cards' visual positions at each responsive size.
      const focusedIndex = padRefs.current.findIndex((el) => el === active);
      if (focusedIndex === -1) return;
      if (
        e.key !== "ArrowRight" &&
        e.key !== "ArrowLeft" &&
        e.key !== "ArrowDown" &&
        e.key !== "ArrowUp"
      ) return;

      const rects = padRefs.current.map((element) =>
        element?.getBoundingClientRect() ?? null
      );
      const nextIndex = findGridNeighbor(rects, focusedIndex, e.key);
      if (nextIndex !== -1) {
        e.preventDefault();
        padRefs.current[nextIndex]?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [router]);

  return (
    <div className="student-game-hub">
      {/* Hero Welcome & Audio Navigation Instructions */}
      <section className="student-hub-hero" aria-labelledby="hub-heading">
        <div className="student-hub-hero-content">
          <h1 id="hub-heading" className="student-hub-title">
            <UiText>{"Halo, "}</UiText>
            {user.full_name || user.username}
          </h1>
          <p className="student-hub-description">
            <UiText>
              {
                "Pilih ruang belajarmu di bawah. Tekan tombol angka 1 sampai 6 di keyboard untuk akses cepat atau sentuh tombol pilihanmu."
              }
            </UiText>
          </p>
          <div className="student-audio-nav-guide" role="note">
            <Volume2 size={16} aria-hidden="true" />
            <span>
              <UiText>
                {
                  "Suara narasi aktif: Sentuh atau sorot tombol untuk mendengarkan penjelasannya."
                }
              </UiText>
            </span>
          </div>
        </div>
      </section>

      {/* Featured Quest / Next Learning Mission */}
      {nextMaterial && (
        <section
          className="student-next-mission-card"
          aria-labelledby="mission-heading"
        >
          <div className="mission-card-badge">
            <Sparkles size={16} aria-hidden="true" />
            <span>{t("Misi Belajar Kamu Berikutnya")}</span>
          </div>
          <div className="mission-card-body">
            <div>
              <h2 id="mission-heading" className="mission-card-title">
                {nextMaterial.title}
              </h2>
              <p className="mission-card-desc">
                {nextMaterial.class_name ? `${nextMaterial.class_name} · ` : ""}
                <UiText>
                  {
                    "Lanjutkan belajar langkah demi langkah bersama Tutor AI."
                  }
                </UiText>
              </p>
            </div>
            <Link
              href={`/siswa/tutor?class_id=${encodeURIComponent(
                nextMaterial.class_id
              )}&material_id=${encodeURIComponent(nextMaterial.id)}`}
              className="button primary mission-action-btn"
              data-voice-menu="tutor"
              aria-label={`${t("Lanjutkan belajar")} ${nextMaterial.title} ${t(
                "bersama Tutor AI"
              )}`}
            >
              <span>{t("Lanjut Belajar")}</span>
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </div>
        </section>
      )}

      {/* The 6 Centered Game Pads */}
      <section
        className="student-game-grid-section"
        aria-label={t("Menu Utama Belajar")}
      >
        <div className="student-game-grid">
          {gamePads.map((pad, idx) => {
            const Icon = pad.icon;
            return (
              <Link
                key={pad.href}
                href={pad.href}
                ref={(el) => {
                  padRefs.current[idx] = el;
                }}
                className="game-pad-card"
                data-voice-menu={pad.voiceKey}
                aria-label={t("Menu {number}: {title}. {description}. {stat}. Tekan angka {number}.", {
                  number: pad.num,
                  title: t(pad.title),
                  description: t(pad.desc),
                  stat: pad.stat,
                })}
              >
                <div className="game-pad-top">
                  <span className="game-pad-key" aria-hidden="true">
                    {pad.num}
                  </span>
                  <span className="game-pad-stat">{pad.stat}</span>
                </div>

                <div className="game-pad-icon-wrap" aria-hidden="true">
                  <Icon size={40} strokeWidth={2.3} className="game-pad-svg-icon" />
                </div>

                <div className="game-pad-info">
                  <h2 className="game-pad-title">{t(pad.title)}</h2>
                  <p className="game-pad-desc">{t(pad.desc)}</p>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Classes Overview List */}
      {activeClasses.length > 0 && (
        <section
          className="student-classes-overview"
          aria-labelledby="classes-heading"
        >
          <div className="student-classes-header">
            <h2 id="classes-heading" className="student-classes-title">
              <UiText>{"Kelas Terdaftar Kamu"}</UiText>
            </h2>
            <Link
              href="/siswa/kelas"
              className="student-see-all-btn student-see-all-link"
              data-voice-menu="classes"
              aria-label={t("Lihat kelas saya. Buka daftar lengkap semua kelas terdaftar kamu.")}
            >
              <span><UiText>{"Lihat kelas saya"}</UiText></span>
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>

          <div className="student-classes-row">
            {activeClasses.slice(0, 4).map((cls) => (
              <Link
                key={cls.id}
                href={`/siswa/kelas/${cls.id}`}
                className="student-class-mini-card"
                data-voice-menu="classes"
                aria-label={t("Kelas {name}. Mata pelajaran {subject}. {count} materi.", {
                  name: cls.name,
                  subject: cls.subject,
                  count: cls.material_count,
                })}
              >
                <div className="mini-card-top">
                  <span className="mini-card-badge">{cls.subject}</span>
                  <span className="mini-card-count">
                    {cls.material_count} <UiText>{"materi"}</UiText>
                  </span>
                </div>
                <h3 className="mini-card-name">{cls.name}</h3>
                <p className="mini-card-teacher">
                  <UiText>{"Guru: "}</UiText>
                  {cls.teacher_name}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

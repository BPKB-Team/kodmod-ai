
import type { ReactNode } from "react";
import { Brand } from "./ui";
import { LearningNav } from "./learning-nav";
import { requireSession } from "@/lib/session";
import type { LearningRole } from "@/lib/class-types";
import "@/styles/learning.css";
import "@/styles/student-hub.css";
import { ExperienceToolbar } from "./experience-toolbar";
import { getServerI18n } from "@/lib/server-language";
import { UserProfileDropdown } from "./user-profile-dropdown";
import { StudentTopNav, StudentBackBar } from "./student-top-nav";
import { InnerFooter } from "./inner-footer";

export async function LearningShell({
  role,
  children,
}: {
  role: LearningRole;
  children: ReactNode;
}) {
  const { user } = await requireSession(role);
  const { t } = await getServerI18n();
  const teacher = role === "teacher";

  // Dedicated accessible layout for Students: No sidebar, clean full-width workspace
  if (!teacher) {
    return (
      <div className="student-app-shell">
        <div className="student-bg-decoration" aria-hidden="true">
          <div className="student-bg-glow glow-top-left" />
          <div className="student-bg-glow glow-top-right" />
          <div className="student-bg-glow glow-center" />
          <div className="student-bg-soundwaves">
            <svg viewBox="0 0 1200 240" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
              <path d="M0 120 C 150 70, 300 170, 450 120 C 600 70, 750 170, 900 120 C 1050 70, 1150 150, 1200 120" stroke="url(#audioWaveGrad1)" strokeWidth="2.5" strokeDasharray="6 8" opacity="0.45" />
              <path d="M0 140 C 180 190, 320 80, 500 140 C 680 200, 820 90, 1000 140 C 1120 180, 1180 110, 1200 135" stroke="url(#audioWaveGrad2)" strokeWidth="2" opacity="0.3" />
              <defs>
                <linearGradient id="audioWaveGrad1" x1="0" y1="0" x2="1200" y2="0" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#3b82f6" stopOpacity="0.05" />
                  <stop offset="0.3" stopColor="#3b82f6" stopOpacity="0.35" />
                  <stop offset="0.7" stopColor="#6366f1" stopOpacity="0.35" />
                  <stop offset="1" stopColor="#6366f1" stopOpacity="0.05" />
                </linearGradient>
                <linearGradient id="audioWaveGrad2" x1="0" y1="0" x2="1200" y2="0" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#0ea5e9" stopOpacity="0.05" />
                  <stop offset="0.4" stopColor="#0ea5e9" stopOpacity="0.25" />
                  <stop offset="0.8" stopColor="#8b5cf6" stopOpacity="0.25" />
                  <stop offset="1" stopColor="#8b5cf6" stopOpacity="0.05" />
                </linearGradient>
              </defs>
            </svg>
          </div>
        </div>
        <StudentTopNav user={user} />
        <main id="konten-utama" tabIndex={-1} className="workspace-main student-main-content">
          <StudentBackBar />
          {children}
        </main>
        <InnerFooter className="student-footer" />
      </div>
    );
  }

  return (
    <div className="admin-shell learning-shell">
      <aside className="sidebar">
        <Brand href={teacher ? "/teacher" : "/student"} />
        <div className="sidebar-label">
          {t("Ruang mengajar")}
        </div>
        <LearningNav base="/teacher" />
        <div className="sidebar-bottom">
          <p>{t("Ruang belajar untuk semua.")}</p>
        </div>
      </aside>
      <div className="admin-workspace">
        <header className="workspace-header">
          <span className="workspace-title">
            {t("Ruang guru")}
          </span>
          <div className="account">
            <ExperienceToolbar />
            <UserProfileDropdown
              user={user}
              roleLabel="Guru"
              role={role}
            />
          </div>
        </header>
        <main id="konten-utama" tabIndex={-1} className="workspace-main">
          {children}
        </main>
        <InnerFooter className="workspace-footer" />
      </div>
    </div>
  );
}

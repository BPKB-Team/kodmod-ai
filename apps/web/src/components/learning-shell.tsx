
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
        <StudentTopNav user={user} />
        <main id="konten-utama" tabIndex={-1} className="workspace-main student-main-content">
          <StudentBackBar />
          {children}
        </main>
        <footer className="student-footer">
          <div className="student-footer-inner">
            <strong>KODMOD</strong>
            <span>{t("Ruang belajar untuk semua.")}</span>
          </div>
        </footer>
      </div>
    );
  }

  return (
    <div className="admin-shell learning-shell">
      <aside className="sidebar">
        <Brand href={teacher ? "/guru" : "/siswa"} />
        <div className="sidebar-label">
          {t("Ruang mengajar")}
        </div>
        <LearningNav base="/guru" />
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
        <footer className="workspace-footer">
          KODMOD <span>{t("Ruang belajar untuk semua.")}</span>
        </footer>
      </div>
    </div>
  );
}

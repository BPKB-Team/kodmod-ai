
import type { ReactNode } from "react";
import { Brand } from "@/components/ui";
import { AdminNav } from "@/components/admin-nav";
import { requireSession } from "@/lib/session";
import { ExperienceToolbar } from "@/components/experience-toolbar";
import { getServerI18n } from "@/lib/server-language";
import { UserProfileDropdown } from "@/components/user-profile-dropdown";
import { InnerFooter } from "@/components/inner-footer";

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { user } = await requireSession("admin");
  const { t } = await getServerI18n();
  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <Brand href="/admin" />
        <div className="sidebar-label">{t("Ruang administrasi")}</div>
        <AdminNav />
        <div className="sidebar-bottom">
          <p>{t("Ruang belajar untuk semua.")}</p>
        </div>
      </aside>
      <div className="admin-workspace">
        <header className="workspace-header">
          <span className="workspace-title">{t("Ruang admin")}</span>
          <div className="account">
            <ExperienceToolbar />
            <UserProfileDropdown
              user={user}
              roleLabel="Administrator"
              role="admin"
            />
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="workspace-main">
          {children}
        </main>
        <InnerFooter className="workspace-footer" />
      </div>
    </div>
  );
}

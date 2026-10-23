import { GraduationCap } from "lucide-react";
import { Heading } from "@/components/ui";
import { UiText } from "@/components/language-provider";
import { requireSession } from "@/lib/session";
import { backend } from "@/lib/server-api";
import type { AdminClass, AdminSubject } from "@/lib/admin-academic-types";
import type { User } from "@/lib/types";
import { AdminAcademicManager } from "@/components/admin-academic-manager";

export default async function AdminAcademicPage() {
  const { token } = await requireSession("admin");

  const [classes, subjects, teachers] = await Promise.all([
    backend<AdminClass[]>("/admin/classes", token),
    backend<AdminSubject[]>("/admin/subjects", token),
    backend<User[]>("/admin/users?role=teacher", token),
  ]);

  return (
    <>
      <Heading
        icon={<GraduationCap size={24} aria-hidden="true" />}
        title={<UiText>{"Kelola Kelas & Mata Pelajaran"}</UiText>}
        description={
          <UiText>
            {
              "Kelola seluruh daftar nama kelas, guru pengampu, dan mata pelajaran dengan kontrol kaskade penuh."
            }
          </UiText>
        }
      />
      <AdminAcademicManager
        initialClasses={classes}
        initialSubjects={subjects}
        teachers={teachers}
      />
    </>
  );
}

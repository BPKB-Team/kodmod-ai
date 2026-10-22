export type Role = "admin" | "teacher" | "student";
export type User = {
  id: string;
  username: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
  preferred_language?: "id" | "en";
};
export type Invitation = {
  id: string;
  code: string;
  label: string | null;
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
};
export type ActionState = {
  error?: string;
  success?: string;
  redirectUrl?: string;
  activeSession?: {
    sessionId: string;
    username: string;
    changed?: boolean;
    challengeVersion: string;
  };
};
export const roleLabel: Record<Role, string> = {
  admin: "Admin",
  teacher: "Guru",
  student: "Siswa",
};
export function homeFor(role: Role) {
  return { admin: "/admin", teacher: "/guru", student: "/siswa" }[role];
}
export function dateLabel(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("id-ID", {
        dateStyle: "medium",
        timeZone: "Asia/Jakarta",
      }).format(new Date(value))
    : "Belum pernah masuk";
}
export function invitationStatus(invite: Invitation) {
  if (!invite.is_active) return "Dicabut";
  if (invite.expires_at && new Date(invite.expires_at) <= new Date())
    return "Kedaluwarsa";
  if (invite.used_count >= invite.max_uses) return "Kuota habis";
  return "Aktif";
}

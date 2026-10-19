
import { UiText } from "@/components/language-provider";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { RegisterForm } from "@/components/register-form";
import { session } from "@/lib/session";
import { homeFor } from "@/lib/types";
export default async function RegisterPage() {
  const current = await session();
  if (current) redirect(homeFor(current.user.role));
  return (
    <AuthShell register>
      <span className="auth-badge-pill"><UiText>{"Daftar akun baru"}</UiText></span>
      <h1><UiText>{"Buat akun KODMOD"}</UiText></h1>
      <p className="auth-description"><UiText>{"Pilih peranmu dan mulai belajar atau mengajar."}</UiText></p>
      <RegisterForm />
    </AuthShell>
  );
}

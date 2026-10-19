
import { UiText } from "@/components/language-provider";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { LoginForm } from "@/components/forms";
import { session } from "@/lib/session";
import { homeFor } from "@/lib/types";
export default async function LoginPage() {
  const current = await session();
  if (current) redirect(homeFor(current.user.role));
  return (
    <AuthShell>
      <span className="auth-badge-pill"><UiText>{"Ruang belajar Anda"}</UiText></span>
      <h1><UiText>{"Senang bertemu lagi."}</UiText></h1>
      <p className="auth-description"><UiText>{"Masuk untuk melanjutkan perjalananmu di KODMOD."}</UiText></p>
      <LoginForm />
    </AuthShell>
  );
}

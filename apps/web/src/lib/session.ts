import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { backend, BackendError } from "./server-api";
import { homeFor, type Role, type User } from "./types";

export const SESSION_COOKIE = "kodmod_session";
export const session = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const user = await backend<User>("/auth/me", token);
    if (!user.is_active || !["admin", "teacher", "student"].includes(user.role))
      return null;
    return { token, user };
  } catch (error) {
    if (error instanceof BackendError && [401, 403].includes(error.status))
      return null;
    throw error;
  }
});
export async function requireSession(role?: Role) {
  const value = await session();
  if (!value) redirect("/login");
  if (role && value.user.role !== role) redirect(homeFor(value.user.role));
  return value;
}

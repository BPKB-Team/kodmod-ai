import { redirect } from "next/navigation";

// Old bookmarks lead to account management; invitation registration is retired.
export default function LegacyInvitationPage() { redirect("/admin/users"); }

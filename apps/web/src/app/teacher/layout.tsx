import type { ReactNode } from "react";
import { LearningShell } from "@/components/learning-shell";
export default function Layout({ children }: { children: ReactNode }) {
  return <LearningShell role="teacher">{children}</LearningShell>;
}

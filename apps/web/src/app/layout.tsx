import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { RedirectFeedback } from "@/components/action-feedback";
import { VoicePreferencesProvider } from "@/components/voice-preferences-provider";
import "../styles/index.css";
import "../styles/product.css";
import "sweetalert2/dist/sweetalert2.min.css";
import "../styles/experience.css";
import "../styles/refinement.css";
import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource-variable/source-sans-3";
import SkipLink from "@/components/SkipLink";
import { LanguageProvider } from "@/components/language-provider";
import { getServerI18n } from "@/lib/server-language";
import { serverDisplaySettings, serverVoiceSettings } from "@/lib/server-display";
import "../styles/accessibility.css";
import "../styles/loading.css";

export const metadata: Metadata = {
  title: "KODMOD - Asisten Belajar",
  description: "Asisten belajar AI untuk siswa tunanetra.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { language } = await getServerI18n();
  const display = await serverDisplaySettings();
  const voice = await serverVoiceSettings();
  return (
    <html lang={language} data-text-size={display.fontScale} data-high-contrast={String(display.highContrast)} data-spacious={String(display.spacious)} data-reduced-motion={String(display.reducedMotion)}>
      <body>
        <LanguageProvider initialLanguage={language}>
        <SkipLink />
        <VoicePreferencesProvider initialDisplay={display} initialVoice={voice}>
          {children}
          <Suspense fallback={null}>
            <RedirectFeedback />
          </Suspense>
        </VoicePreferencesProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}

import Image from "next/image";
import { Sparkles, Headphones } from "lucide-react";
import { getServerI18n } from "@/lib/server-language";
import { cn } from "@/lib/utils";

export async function InnerFooter({ className }: { className?: string } = {}) {
  const { t } = await getServerI18n();
  const year = new Date().getFullYear();

  return (
    <footer className={cn("inner-app-footer", className)}>
      <div className="inner-app-footer-inner">
        <div className="inner-app-footer-brand">
          <Image
            src="/brand/symbol.png"
            alt=""
            width={24}
            height={25}
            className="inner-footer-symbol"
          />
          <div className="inner-footer-titles">
            <span className="inner-footer-name">KODMOD</span>
            <span className="inner-footer-sep" aria-hidden="true">·</span>
            <span className="inner-footer-tagline">{t("Ruang belajar untuk semua.")}</span>
          </div>
        </div>

        <div className="inner-app-footer-meta">
          <span className="inner-footer-badge">
            <Headphones size={13} aria-hidden="true" />
            <span>Audio-First</span>
          </span>
          <span className="inner-footer-badge">
            <Sparkles size={13} aria-hidden="true" />
            <span>Agentic AI</span>
          </span>
          <span className="inner-footer-copy">© {year} KODMOD</span>
        </div>
      </div>
    </footer>
  );
}

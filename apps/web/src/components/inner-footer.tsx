import Image from "next/image";
import { getServerI18n } from "@/lib/server-language";
import { cn } from "@/lib/utils";

export async function InnerFooter({ className }: { className?: string } = {}) {
  const { t } = await getServerI18n();

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
      </div>
    </footer>
  );
}


"use client";

import { useRef } from "react";
import { Menu } from "lucide-react";
import { useI18n } from "./language-provider";

export default function LandingMenu({ links }: { links: string[][] }) {
  const { t } = useI18n();
  const menu = useRef<HTMLDetailsElement>(null);
  function close() {
    if (menu.current) menu.current.open = false;
  }
  return (
    <details
      ref={menu}
      className="lp-mobile-nav"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          close();
          menu.current?.querySelector("summary")?.focus();
        }
      }}
    >
      <summary data-voice-menu="navigation" aria-label={t("Buka navigasi")}>
        <Menu size={23} />
      </summary>
      <nav aria-label={t("Navigasi seluler")}>
        {links.map(([href, label]) => (
          <a href={href} key={href} onClick={close} data-voice-menu={{ "#about": "about", "#how-it-works": "how", "#for-teachers": "features", "#faq": "faq" }[href]}>
            {t(label)}
          </a>
        ))}
      </nav>
    </details>
  );
}

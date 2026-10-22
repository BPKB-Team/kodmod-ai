"use client";
import { useI18n } from "./language-provider";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { speechOutput } from "@/lib/browser-speech";

export function Brand({ href = "/" }: { href?: string } = {}) {
  const { t } = useI18n();
  return (
    <Link
      className="brand"
      href={href}
      aria-label={t("KODMOD, halaman utama")}
      onClick={() => speechOutput.stop()}
    >
      <Image
        src="/brand/logo.png"
        alt="KODMOD"
        width={1564}
        height={452}
        priority
      />
    </Link>
  );
}
export function Heading({
  title,
  description,
  kicker,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  kicker?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`page-heading${className ? ` ${className}` : ""}`}>
      <div>
        {kicker && <div className="heading-kicker-wrap">{kicker}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children && <div className="heading-actions">{children}</div>}
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}
export function Badge({
  active,
  children,
}: {
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={`badge ${active ? "badge-active" : ""}`}>{children}</span>
  );
}

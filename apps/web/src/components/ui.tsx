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
  children,
}: {
  title: ReactNode;
  description: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
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

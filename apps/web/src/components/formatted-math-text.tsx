"use client";

import { memo } from "react";
import { formatHtmlMath } from "@/lib/format-math.mjs";

export const FormattedMathText = memo(function FormattedMathText({
  text,
  className,
  language = "id",
}: {
  text?: string | null;
  className?: string;
  language?: string;
}) {
  if (!text) return null;
  const html = formatHtmlMath(text, language);
  return (
    <span
      className={className ? `formatted-math-text ${className}` : "formatted-math-text"}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});

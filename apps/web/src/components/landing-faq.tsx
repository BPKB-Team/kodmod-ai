"use client";

import { useI18n } from "./language-provider";
import { ChevronDown } from "lucide-react";
import { speechOutput } from "@/lib/browser-speech";

export interface FaqItemData {
  question: string;
  answer: string;
  key: string;
}

export function LandingFaqList({ items }: { items: FaqItemData[] }) {
  const { t, language } = useI18n();

  function handleToggle(e: React.SyntheticEvent<HTMLDetailsElement>, q: string, a: string, key: string) {
    const details = e.currentTarget;
    if (details.open) {
      void speechOutput.play({
        owner: `faq-${key}`,
        text: `${t(q)}. ${t(a)}`,
        engine: "app",
        language,
      });
    } else {
      speechOutput.stop(`faq-${key}`);
    }
  }

  return (
    <div className="lp-faq-list">
      {items.map(({ question, answer, key }) => (
        <details
          key={question}
          data-voice-menu={key}
          className="lp-faq-item"
          onToggle={(e) => handleToggle(e, question, answer, key)}
        >
          <summary>
            <span className="lp-faq-q-text">{t(question)}</span>
            <ChevronDown size={19} className="lp-faq-chevron" aria-hidden="true" />
          </summary>
          <div className="lp-faq-body" data-voice-menu={`${key}-ans`} tabIndex={0}>
            <p>{t(answer)}</p>
          </div>
        </details>
      ))}
    </div>
  );
}

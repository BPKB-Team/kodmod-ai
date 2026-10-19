"use client";
import {Lightbulb} from "lucide-react";
import {UiText,useI18n} from "./language-provider";
import type {GuidanceInsight} from "@/lib/progress-guidance-types";

export function ProgressInsights({insights}:{insights:GuidanceInsight[]}){
  const {t}=useI18n();
  return <section className="progress-insights" aria-label={t("Insight belajarmu")}>
    {insights.slice(0,3).map((item,index)=><article key={`${item.kind}:${index}`} className="progress-insight panel">
      <Lightbulb size={20} aria-hidden="true"/><div><h3>{item.title}</h3><p>{item.body}</p></div>
    </article>)}
    {!insights.length&&<p className="info-note"><UiText>{"Rencanamu mengikuti bukti belajar yang tersedia."}</UiText></p>}
  </section>;
}

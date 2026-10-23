"use client";
import {CheckCircle2,Clock3} from "lucide-react";
import {UiText,useI18n} from "./language-provider";
import type {GuidanceStep,StudyPlan} from "@/lib/progress-guidance-types";

export function ProgressLearningPlan({plan,disabled,onStart,onSkip}:{plan:StudyPlan|null;disabled:boolean;onStart:(step:GuidanceStep)=>void;onSkip:(step:GuidanceStep)=>void}){
  const {t}=useI18n();
  if(!plan)return null;
  const labels:Record<GuidanceStep["status"],string>={pending:"Belum mulai",in_progress:"Sedang berjalan",completed:"Selesai",skipped:"Dilewati",invalidated:"Sumber berubah"};
  return <section className="panel progress-plan" aria-label={t("Rencana belajar singkat")}>
    <h2><UiText>{"Rencana belajarmu"}</UiText></h2>
    <p className="muted"><UiText>{"Satu langkah selesai setelah aktivitas yang sesuai tersimpan."}</UiText></p>
    <ol>{plan.steps.map(step=><li key={step.id} className={`progress-plan-step ${step.status}`}>
      <span className="progress-step-symbol" aria-hidden="true">{step.status==="completed"?<CheckCircle2 size={22}/>:<Clock3 size={20}/>}</span>
      <div className="progress-step-content"><span className="progress-step-status">{t(labels[step.status])}</span><h3>{step.title}</h3><p>{step.body}</p>
        {!!step.estimated_minutes&&<small>{t("Perkiraan")} {step.estimated_minutes} {t("menit")}</small>}
      </div>
      {["pending","in_progress"].includes(step.status)&&<div className="progress-step-actions">
        <button type="button" className="button secondary small" disabled={disabled} onClick={()=>onStart(step)}>{t(step.status==="in_progress"?"Lanjutkan":"Mulai")}</button>
        <button type="button" className="button secondary small" disabled={disabled} onClick={()=>onSkip(step)} aria-label={t("Lewati langkah: {title}", { title: step.title })}>{t("Lewati")}</button>
      </div>}
    </li>)}</ol>
  </section>;
}

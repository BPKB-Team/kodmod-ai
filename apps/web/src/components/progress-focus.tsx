"use client";
import {useCallback,useEffect,useRef,useState,useSyncExternalStore} from "react";
import {useRouter} from "next/navigation";
import Link from "next/link";
import {ArrowRight,BookOpenCheck,Headphones,Lightbulb,RefreshCw,Target,TrendingUp} from "lucide-react";
import {UiText,useI18n} from "./language-provider";
import {VoiceControls} from "./voice-controls";
import {ProgressInsights} from "./progress-insights";
import {ProgressLearningPlan} from "./progress-learning-plan";
import {prepareProgressIntent,ProgressRequestError,readGuidanceResponse,readProgressMutation} from "@/lib/progress-guidance-client.mjs";
import type {GuidanceResponse,ProgressIntent,ProgressIntentInput} from "@/lib/progress-guidance-types";
import "@/styles/progress-guidance.css";

function subscribeTimezone(listener:()=>void){globalThis.window.addEventListener("focus",listener);return()=>globalThis.window.removeEventListener("focus",listener);}
const browserTimezone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone;

export function ProgressFocus({initial, analyticsSpoken}:{initial:GuidanceResponse; analyticsSpoken?: string}){
  const {t}=useI18n();
  const router=useRouter();
  const [data,setData]=useState(initial);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [retry,setRetry]=useState<ProgressIntentInput|null>(null);
  const pending=useRef<ProgressIntent|null>(null);
  const inFlight=useRef(false);
  const reads=useRef(0);
  const polls=useRef(0);
  const timezone=useSyncExternalStore(subscribeTimezone,browserTimezone,()=>initial.timezone??"UTC");
  const load=useCallback(async()=>{
    const serial=++reads.current;
    const result=await readGuidanceResponse(await fetch(`/api/analytics/me/guidance?${new URLSearchParams({timezone})}`,{cache:"no-store"}));
    if(serial===reads.current)setData(result);
    return result;
  },[timezone]);
  useEffect(()=>{
    if(timezone===(initial.timezone??"UTC"))return;
    void load().catch(()=>setError("Rencana belum dapat diperbarui. Coba periksa status lagi."));
  },[timezone,initial.timezone,load]);
  useEffect(()=>{
    if(!data.updating){polls.current=0;return;}
    if(polls.current>=30)return;
    const timer=setTimeout(()=>{polls.current+=1;void load().catch(()=>setError("Rencana belum dapat diperbarui. Coba periksa status lagi."));},2000);
    return()=>clearTimeout(timer);
  },[data.updating,data.as_of,load]);

  async function perform(input:ProgressIntentInput){
    if(inFlight.current)return;
    inFlight.current=true;setBusy(true);setError("");
    try{
      const intent=prepareProgressIntent(pending.current,input);
      pending.current=intent;setRetry(input);
      const result=await readProgressMutation(await fetch(intent.path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(intent.body)}));
      pending.current=null;setRetry(null);polls.current=0;
      if(result.destination){router.push(result.destination);return;}
      try{await load();}catch{setError(t("Tindakan tersimpan. Data rencana terbaru belum dapat dimuat."));}
    }catch(caught){
      if(caught instanceof ProgressRequestError&&[400,401,403,404,409,422].includes(caught.status??0)){
        pending.current=null;setRetry(null);void load().catch(()=>{});
      }
      setError(caught instanceof Error?caught.message:t("Hasil tindakan belum dapat dipastikan."));
    }finally{inFlight.current=false;setBusy(false);}
  }
  const input=(action:ProgressIntentInput["action"],stepId?:string):ProgressIntentInput=>({action,stepId,planId:data.plan?.id,revision:data.plan?.revision??0,timezone});
  const locked=busy||Boolean(retry);
  const focus=data.focus;
  const completed=data.plan?.status==="completed";

  const buildFullSpoken=()=>{
    const parts:string[]=[];
    if(analyticsSpoken?.trim()){
      parts.push(analyticsSpoken.trim());
    }
    if(focus&&!completed){
      const focusText=[
        `${t("Target langkah berikutnya yang disarankan")}: ${focus.title}${focus.body?` — ${focus.body}`:""}.`,
        focus.estimated_minutes?`${t("Perkiraan")} ${focus.estimated_minutes} ${t("menit")}.`:"",
        focus.reason_text?`${t("Alasan rekomendasi ini")}: ${focus.reason_text}`:"",
      ].filter(Boolean).join(" ");
      parts.push(focusText);
    }else if(completed){
      parts.push(t("Aktivitas dalam rencana ini sudah selesai atau dilewati. Buat rencana berikutnya saat kamu siap."));
    }
    if(data.insights?.length){
      parts.push(data.insights.map(i=>`${i.title}. ${i.body}`).join(" "));
    }
    return parts.filter(Boolean).join(" ");
  };

  const spoken=buildFullSpoken()||[focus?.title,focus?.body,focus?.reason_text,...data.insights.map(i=>`${i.title}. ${i.body}`)].filter(Boolean).join(". ");

  return <section className="progress-guidance" aria-label={t("Fokus dan rencana belajar")} aria-busy={busy}>
    <nav className="progress-section-nav" aria-label={t("Navigasi bagian progres belajar")}>
      {spoken && (
        <a href="#audio-summary" className="progress-nav-chip"><Headphones size={15} aria-hidden="true"/><span><UiText>{"Audio Ringkasan"}</UiText></span></a>
      )}
      <a href="#learning-target" className="progress-nav-chip"><Target size={15} aria-hidden="true"/><span><UiText>{"Target Belajar"}</UiText></span></a>
      <a href="#learning-plan" className="progress-nav-chip"><BookOpenCheck size={15} aria-hidden="true"/><span><UiText>{"Rencana Belajar"}</UiText></span></a>
      <a href="#progress-stats" className="progress-nav-chip"><TrendingUp size={15} aria-hidden="true"/><span><UiText>{"Statistik Belajar"}</UiText></span></a>
    </nav>

    {spoken&&(
      <section id="audio-summary" className="panel progress-audio-card" aria-labelledby="heading-ringkasan-audio">
        <div className="progress-audio-header">
          <div className="progress-audio-title-group">
            <span className="progress-audio-icon" aria-hidden="true"><Headphones size={22}/></span>
            <div>
              <h2 id="heading-ringkasan-audio"><UiText>{"Ringkasan Suara KODMOD"}</UiText></h2>
              <p><UiText>{"Dengarkan evaluasi progres dan penjelasan alasan langkah belajarmu."}</UiText></p>
            </div>
          </div>
        </div>
        <div className="progress-audio-transcript" role="region" aria-label={t("Teks ringkasan audio")}>
          <p>{spoken}</p>
        </div>
        <VoiceControls text={spoken}/>
      </section>
    )}

    <section id="learning-target" className="progress-focus-section" aria-labelledby="heading-target-belajar">
      <div className="progress-guidance-toolbar">
        <p role="status">{data.updating?t("Rencana sedang disiapkan. Kamu tetap bisa melanjutkan aktivitas yang tersedia."):t("Saran berdasarkan aktivitas dan sumber yang tersedia.")}</p>
        <button className="button secondary small" type="button" disabled={locked} onClick={()=>{if(data.updating)void load().catch(()=>setError(t("Rencana belum dapat diperbarui.")));else void perform(input("refresh"));}}>
          <RefreshCw size={16} aria-hidden="true"/>{t(data.updating?"Periksa status":"Perbarui rencana")}
        </button>
      </div>

      {error&&<div className="alert error-message" role="alert"><p>{t(error)}</p>{retry&&<button type="button" className="button secondary" disabled={busy} onClick={()=>void perform(retry)}><UiText>{"Coba kirim kembali"}</UiText></button>}</div>}

      <article className="panel progress-focus-card">
        <span className="progress-focus-symbol" aria-hidden="true"><BookOpenCheck size={28}/></span>
        <div className="progress-focus-copy">
          <h2 id="heading-target-belajar">{completed?t("Rencana selesai"):focus?.title??t("Pilih bahan belajar pertamamu")}</h2>
          <p>{completed?t("Aktivitas dalam rencana ini sudah selesai atau dilewati. Buat rencana berikutnya saat kamu siap."):focus?.body??t("Belum ada materi siap belajar yang bisa dijadikan target. Pilih kelas atau minta guru meninjau sumber materi.")}</p>
          {focus&&!completed&&(
            <>
              <small>{t("Perkiraan")} {focus.estimated_minutes} {t("menit")}</small>
              {focus.reason_text&&(
                <div className="progress-focus-reason" role="note" aria-label={t("Alasan rekomendasi ini")}>
                  <div className="progress-reason-header">
                    <Lightbulb size={16} aria-hidden="true"/>
                    <strong><UiText>{"Mengapa saran ini?"}</UiText></strong>
                  </div>
                  <p>{focus.reason_text}</p>
                </div>
              )}
            </>
          )}
        </div>
        {completed?(
          <button type="button" className="button primary" disabled={locked} onClick={()=>void perform(input("refresh"))}>
            <UiText>{"Susun langkah berikutnya"}</UiText><ArrowRight size={18} aria-hidden="true"/>
          </button>
        ):focus?(
          <button type="button" className="button primary" disabled={locked||(data.updating&&!focus.id)} onClick={()=>void perform(input(focus.id?"start":"refresh",focus.id))}>
            {t(focus.id?(focus.status==="in_progress"?"Lanjutkan":"Mulai"):(data.updating?"Menyiapkan rencana…":"Siapkan rencana"))}
            <ArrowRight size={18} aria-hidden="true"/>
          </button>
        ):(
          <Link className="button primary" href="/student/classes">{data.empty_action.label}<ArrowRight size={18} aria-hidden="true"/></Link>
        )}
      </article>
    </section>

    <section id="learning-plan" className="progress-plan-section" aria-label={t("Rencana dan insight belajar")}>
      <ProgressInsights insights={data.insights}/>
      <ProgressLearningPlan plan={data.plan} disabled={locked} onStart={step=>void perform(input("start",step.id))} onSkip={step=>void perform(input("skip",step.id))}/>
    </section>
  </section>;
}

"use client";
import {useState} from "react";
import type {MaterialDocument,MaterialBlock} from "@/lib/material-document-types";
import {validateMaterialLatex} from "@/lib/material-document-adapter.mjs";
import {MaterialRenderer} from "./material-renderer";
import {UiText,useI18n} from "./language-provider";
export function MaterialSourceReview({document,onChange,classId,originalUrl,disabled=false}:{document:MaterialDocument;onChange:(document:MaterialDocument)=>void;classId:string;originalUrl?:string;disabled?:boolean}){
 const {t}=useI18n();
 const [mathDrafts,setMathDrafts]=useState<Record<string,string>>({});
 const [mathErrors,setMathErrors]=useState<Record<string,string>>({});
 const uncertain=document.blocks.filter(b=>b.review_state==="needs_review").length;
 function patch(id:string,changes:Partial<MaterialBlock>){onChange({...document,blocks:document.blocks.map(block=>block.id===id?{...block,...changes,...((changes.alt!==undefined||changes.latex!==undefined)?{provenance:{...block.provenance,edited:true}}:{})}:block)});}
 return <details className="material-source-review"><summary>{t("Tinjau sumber dan blok materi")} · {uncertain} {t("perlu ditinjau")}</summary><p className="muted"><UiText>{"Blok yang belum ditinjau tetap bisa dibaca, tetapi belum menjadi sumber soal. Penerbitan dan kesiapan Tutor ditampilkan terpisah."}</UiText></p>
 <div className="material-source-grid">{originalUrl?<div><a className="button secondary" target="_blank" rel="noopener noreferrer" href={originalUrl}><UiText>{"Buka PDF sumber"}</UiText></a><iframe title={t("Pratinjau PDF sumber")} src={`${originalUrl}${originalUrl.includes("?")?"&":"?"}preview=true`} sandbox="allow-same-origin" referrerPolicy="no-referrer"/></div>:<p><UiText>{"Sumber PDF belum ditautkan. Riwayat lokasi blok tetap disimpan pada materi."}</UiText></p>}
 <div className="material-review-blocks">{document.blocks.map(block=><section key={block.id} className="material-review-block" data-review-state={block.review_state??"accepted"} aria-label={t("Blok materi {id}", { id: block.id })}>
 <small>{block.provenance?.page?`${t("Halaman")} ${block.provenance.page} · `:""}{t(block.provenance?.edited?"Teks revisi guru":"Sumber materi")} · {block.id}</small>
 <MaterialRenderer document={{schema_version:1,blocks:[block]}} classId={classId} showReview/>
 {block.warnings?.map((warning,i)=><p key={i} className="info-note">{t(warning)}</p>)}
 <div className="material-review-fields">
 {block.type==="image"&&<label><UiText>{"Deskripsi alternatif gambar"}</UiText><textarea maxLength={4000} disabled={disabled} value={block.alt??""} onChange={e=>patch(block.id,{alt:e.target.value})}/></label>}
 {block.type==="math"&&<div className="field"><label htmlFor={`math-${block.id}`}><UiText>{"Rumus LaTeX"}</UiText></label><textarea id={`math-${block.id}`} disabled={disabled} maxLength={4000} value={mathDrafts[block.id]??block.latex??""} onChange={e=>{setMathDrafts(current=>({...current,[block.id]:e.target.value}));setMathErrors(current=>({...current,[block.id]:""}));}} aria-describedby={mathErrors[block.id]?`math-error-${block.id}`:undefined}/><button type="button" className="button secondary" disabled={disabled||(mathDrafts[block.id]??block.latex??"")===(block.latex??"")} onClick={()=>{try{const latex=validateMaterialLatex(mathDrafts[block.id]??"");patch(block.id,{latex});setMathDrafts(current=>{const next={...current};delete next[block.id];return next;});setMathErrors(current=>({...current,[block.id]:""}));}catch(error){setMathErrors(current=>({...current,[block.id]:error instanceof Error?error.message:t("Rumus belum valid.")}));}}}><UiText>{"Terapkan rumus"}</UiText></button>{mathErrors[block.id]&&<p id={`math-error-${block.id}`} className="alert error-message" role="alert">{t(mathErrors[block.id])}</p>}</div>}
 <label><UiText>{"Peran isi"}</UiText><select disabled={disabled} value={block.role??"instruction"} onChange={e=>patch(block.id,{role:e.target.value as MaterialBlock["role"]})}>{[["instruction","Penjelasan"],["example","Contoh"],["exercise","Latihan"],["answer_key","Kunci jawaban"],["frontmatter","Sampul atau daftar isi"],["reference","Referensi"]].map(([value,label])=><option key={value} value={value}>{t(label)}</option>)}</select></label>
 <label><UiText>{"Status tinjauan"}</UiText><select disabled={disabled} value={block.review_state??"accepted"} onChange={e=>patch(block.id,{review_state:e.target.value as MaterialBlock["review_state"]})}><option value="needs_review">{t("Perlu ditinjau")}</option><option value="accepted" disabled={block.type==="image"&&!block.decorative&&!block.alt?.trim()}>{t("Disetujui")}</option><option value="excluded">{t("Tidak digunakan untuk belajar")}</option></select></label>
 </div></section>)}</div></div></details>;
}

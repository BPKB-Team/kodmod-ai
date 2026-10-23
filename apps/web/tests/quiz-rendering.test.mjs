import test from "node:test";
import assert from "node:assert/strict";
import {registerHooks} from "node:module";
import {readFileSync,existsSync} from "node:fs";
import ts from "typescript";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
globalThis.kodmodRenderReact=React;
const stubs=new Map([
 ["next/navigation",`export const useRouter=()=>({push:()=>{}});`],
 ["next/link",`export default function Link({children,...props}){return globalThis.kodmodRenderReact.createElement("a",props,children);}`],
 ["@/components/ui/native-select",`export const NativeSelect=({children})=>children;`],
 ["@/components/ui/textarea",`export const Textarea=()=>null;`],
 ["@/components/language-provider",`export const UiText=({children})=>children; export const useI18n=()=>({t:x=>x,language:"id"});`],
 ["./voice-controls",`export const VoiceControls=()=>null;`],
 ["./use-quiz-exit-guard",`export const useQuizExitGuard=()=>{};`],
 ["@/lib/dialogs",`export const confirmAction=async()=>true;export const notifyResult=async()=>{};`],
 ["./loading-feedback",`export const LoadingStatus=()=>null;`],
]);
stubs.set("./language-provider",stubs.get("@/components/language-provider"));
const hooks=registerHooks({
 resolve(specifier,context,next){
  if(specifier.endsWith(".css"))return{shortCircuit:true,url:"data:text/javascript,"};
  if(stubs.has(specifier))return{shortCircuit:true,url:"data:text/javascript,"+encodeURIComponent(stubs.get(specifier))};
  if(specifier.startsWith("@/")){
   let url=new URL("../src/"+specifier.slice(2),import.meta.url);
   if(!existsSync(url))url=new URL(url.href+(existsSync(new URL(url.href+".tsx"))?".tsx":".ts"));
   return{shortCircuit:true,url:url.href};
  }
  if(specifier.startsWith(".")&&context.parentURL?.startsWith("file:")){
   const url=new URL(specifier,context.parentURL);
   if(!existsSync(url)){
    const extension=[".tsx",".ts"].find(value=>existsSync(new URL(url.href+value)));
    if(extension)return{shortCircuit:true,url:url.href+extension};
   }
  }
  return next(specifier,context);
 },
 load(url,context,next){
  if(/\.tsx?$/.test(url))return{shortCircuit:true,format:"module",source:ts.transpileModule(readFileSync(new URL(url),"utf8"),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText};
  return next(url,context);
 }
});
const {StudentQuiz}=await import("../src/components/student-quiz.tsx");
const {StudentAnalytics}=await import("../src/components/student-analytics.tsx");
const {ProgressFocus}=await import("../src/components/progress-focus.tsx");
hooks.deregister();
const question={question_id:"q",order_index:0,question:"Hitung 2²",question_type:"spoken",options:[],difficulty:"easy"};
const base={quiz_session_id:"session",kind:"assessment",status:"in_progress",total_questions:1,answered_questions:1,score_summary:{points_earned:0,points_possible:100,points_per_question:100,answered_questions:1,total_questions:1,skipped_questions:0,assisted_questions:0},policy_version:2,question_state:"review",available_actions:["advance"],current_question:null,review_question:question,last_review:"Jawaban benar: 4.",last_result:{score:0,is_correct:false,cumulative_score:0}};
test("assessment restores final review before summary without retry or hints",()=>{
 const html=renderToStaticMarkup(React.createElement(StudentQuiz,{initialSession:base}));
 assert.match(html,/Jawaban benar: 4/);assert.match(html,/Selesaikan latihan/);
 assert.doesNotMatch(html,/Coba jawab lagi|Petunjuk|Coba lagi|quiz-complete-summary/);
});
test("Tutor can request help or directly continue before submitting",()=>{
 const html=renderToStaticMarkup(React.createElement(StudentQuiz,{embedded:true,initialSession:{...base,kind:"tutor",question_state:"answering",current_question:question,review_question:null,last_review:null,available_actions:["answer","hint","advance"]}}));
 assert.match(html,/Petunjuk/);assert.match(html,/Lanjut soal/);assert.match(html,/Kirim jawaban/);
});

test("session header uses points while lesson percentages remain readable",()=>{
 const html=renderToStaticMarkup(React.createElement(StudentQuiz,{initialSession:{...base,review_question:{...question,question:"Hitung 25% dari 80"}}}));
 assert.match(html,/0 \/ 100 poin/);assert.match(html,/25%/);
 assert.doesNotMatch(html,/Skor sementara|persen/);
});

test("Progress distinguishes unassessed concepts and finished material from failure",()=>{
 const data={student_name:"Siswa",window:"all",n_sessions:1,n_quiz_attempts:0,n_official_questions:0,total_minutes:10,interaction_count:2,
  quiz_accuracy:0,overall_mastery:0,mastery_available:false,weak_concepts:[],strong_concepts:[],engagement_index:0,active_recommendations:[],
  learning_materials:[],materials_completed:1,completed_units:3,total_units:3,assessed_concepts:0,mapped_concepts:0,timezone:"Asia/Jakarta"};
 const html=renderToStaticMarkup(React.createElement(StudentAnalytics,{initial:data,initialSpoken:"Selesai satu materi. Konsep belum dinilai."}));
 assert.match(html,/Penguasaan konsep belum tersedia/);assert.match(html,/Belum dinilai/);
 assert.match(html,/Progres bersama Tutor/);assert.match(html,/Asia\/Jakarta/);
 assert.doesNotMatch(html,/Penguasaan materi 0%/);
});

test("cold-start focus has a real class action and no invented mastery statistic",()=>{
 const initial={status:"no_available_material",updating:false,timezone:"UTC",as_of:"now",needs_refresh:false,focus:null,plan:null,insights:[{kind:"baseline",fact_ids:["coverage"],title:"Belum dinilai",body:"Mulai dari sumber yang tersedia."}],empty_action:{href:"/student/classes",label:"Pilih kelas atau hubungi guru"}};
 const html=renderToStaticMarkup(React.createElement(ProgressFocus,{initial}));
 assert.match(html,/href="\/student\/classes"/);assert.match(html,/Belum dinilai/);
 assert.doesNotMatch(html,/0%|0 persen|konsep lemah/);
});

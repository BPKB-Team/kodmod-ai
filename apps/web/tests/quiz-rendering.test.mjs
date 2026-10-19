import test from "node:test";
import assert from "node:assert/strict";
import {registerHooks} from "node:module";
import {readFileSync,existsSync} from "node:fs";
import ts from "typescript";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
const stubs=new Map([
 ["@/components/ui/native-select",`export const NativeSelect=({children})=>children;`],
 ["@/components/ui/textarea",`export const Textarea=()=>null;`],
 ["@/components/language-provider",`export const UiText=({children})=>children; export const useI18n=()=>({t:x=>x,language:"id"});`],
 ["./voice-controls",`export const VoiceControls=()=>null;`],
 ["./use-quiz-exit-guard",`export const useQuizExitGuard=()=>{};`],
 ["@/lib/dialogs",`export const confirmAction=async()=>true;export const notifyResult=async()=>{};`],
 ["./loading-feedback",`export const LoadingStatus=()=>null;`],
]);
const hooks=registerHooks({
 resolve(specifier,context,next){
  if(stubs.has(specifier))return{shortCircuit:true,url:"data:text/javascript,"+encodeURIComponent(stubs.get(specifier))};
  if(specifier.startsWith("@/")){
   let url=new URL("../src/"+specifier.slice(2),import.meta.url);
   if(!existsSync(url))url=new URL(url.href+(existsSync(new URL(url.href+".tsx"))?".tsx":".ts"));
   return{shortCircuit:true,url:url.href};
  }
  return next(specifier,context);
 },
 load(url,context,next){
  if(/\.tsx?$/.test(url))return{shortCircuit:true,format:"module",source:ts.transpileModule(readFileSync(new URL(url),"utf8"),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText};
  return next(url,context);
 }
});
const {StudentQuiz}=await import("../src/components/student-quiz.tsx");
hooks.deregister();
const question={question_id:"q",order_index:0,question:"Hitung 2²",question_type:"spoken",options:[],difficulty:"easy"};
const base={quiz_session_id:"session",kind:"assessment",status:"in_progress",total_questions:1,answered_questions:1,policy_version:2,question_state:"review",available_actions:["advance"],current_question:null,review_question:question,last_review:"Jawaban benar: 4.",last_result:{score:0,is_correct:false,cumulative_score:0}};
test("assessment restores final review before summary without retry or hints",()=>{
 const html=renderToStaticMarkup(React.createElement(StudentQuiz,{initialSession:base}));
 assert.match(html,/Jawaban benar: 4/);assert.match(html,/Selesaikan latihan/);
 assert.doesNotMatch(html,/Coba jawab lagi|Petunjuk|Coba lagi|quiz-complete-summary/);
});
test("Tutor can request help or directly continue before submitting",()=>{
 const html=renderToStaticMarkup(React.createElement(StudentQuiz,{embedded:true,initialSession:{...base,kind:"tutor",question_state:"answering",current_question:question,review_question:null,last_review:null,available_actions:["answer","hint","advance"]}}));
 assert.match(html,/Petunjuk/);assert.match(html,/Lanjut soal/);assert.match(html,/Kirim jawaban/);
});

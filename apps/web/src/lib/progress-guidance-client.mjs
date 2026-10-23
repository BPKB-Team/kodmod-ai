import {createQuizSubmissionId} from "./quiz-submission.mjs";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class ProgressRequestError extends Error {
  constructor(message,status=null){super(message);this.status=status;}
}
export function parseProgressRequest(input,action){
  if(!["refresh","start","skip"].includes(action))throw new ProgressRequestError("Tindakan tidak valid.",400);
  const fields=action==="refresh"?["request_id","expected_revision","timezone"]:["request_id","expected_revision"];
  if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).some(k=>!fields.includes(k))||!UUID.test(input.request_id)||!Number.isSafeInteger(input.expected_revision)||input.expected_revision<0)throw new ProgressRequestError("Tindakan tidak valid.",400);
  const body={request_id:input.request_id,expected_revision:input.expected_revision};
  if(action==="refresh"){
    if(typeof input.timezone!=="string"||input.timezone.length>80)throw new ProgressRequestError("Zona waktu tidak valid.",422);
    try{new Intl.DateTimeFormat("en",{timeZone:input.timezone});}catch{throw new ProgressRequestError("Zona waktu tidak valid.",422);}
    body.timezone=input.timezone;
  }
  return body;
}
export function prepareProgressIntent(pending,input,createId=createQuizSubmissionId){
  if(!["refresh","start","skip"].includes(input.action))throw new ProgressRequestError("Tindakan tidak valid.",400);
  const scope=input.action==="refresh"?"refresh":`${input.action}:${input.planId}:${input.stepId}`;
  if(pending){if(pending.scope!==scope)throw new ProgressRequestError("Tindakan sedang menunggu hasil.",409);return pending;}
  if(input.action!=="refresh"&&(!UUID.test(input.planId)||!UUID.test(input.stepId)))throw new ProgressRequestError("Langkah tidak valid.",400);
  const path=input.action==="refresh"?"/api/analytics/me/guidance/refresh":`/api/analytics/me/plans/${input.planId}/steps/${input.stepId}/${input.action}`;
  const body=parseProgressRequest({request_id:createId(),expected_revision:input.revision,...(input.action==="refresh"?{timezone:input.timezone}:{})},input.action);
  return Object.freeze({scope,path,body:Object.freeze(body)});
}
export function safePlanDestination(value){
  return typeof value==="string"&&/^\/student\/(tutor|practice)\?session_id=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
export async function readProgressMutation(response){
  let data;try{data=await response.json();}catch{throw new ProgressRequestError("Hasil tindakan belum dapat dipastikan.");}
  if(!response.ok)throw new ProgressRequestError(data?.message??"Tindakan belum dapat dipastikan.",response.status);
  if(!data||!["updating","ready","in_progress","skipped"].includes(data.status)||!Number.isSafeInteger(data.revision)||data.revision<0||(data.status==="in_progress"&&!safePlanDestination(data.destination)))throw new ProgressRequestError("Respons tindakan tidak valid.");
  return data;
}
export async function readGuidanceResponse(response){
  let data;try{data=await response.json();}catch{throw new ProgressRequestError("Respons Progres tidak valid.");}
  if(!response.ok)throw new ProgressRequestError(data?.message??"Progres belum dapat dimuat.",response.status);
  if(!data||!["idle","updating","ready","stale","completed","no_available_material"].includes(data.status)||typeof data.updating!=="boolean"||typeof data.needs_refresh!=="boolean"||!Array.isArray(data.insights)||data.insights.length>3||data.insights.some(i=>typeof i.title!=="string"||typeof i.body!=="string")||(data.plan&&(!UUID.test(data.plan.id)||!Number.isSafeInteger(data.plan.revision)||!Array.isArray(data.plan.steps)||data.plan.steps.length>3||data.plan.steps.some(s=>!UUID.test(s.id)||!["pending","in_progress","completed","skipped","invalidated"].includes(s.status))))||!data.empty_action||typeof data.empty_action.label!=="string")throw new ProgressRequestError("Respons Progres tidak valid.");
  return data;
}

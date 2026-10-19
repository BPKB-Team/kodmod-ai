import "server-only";
import {NextResponse} from "next/server";
import {forwardQuiz} from "@/lib/quiz-proxy";
import {parseProgressRequest} from "@/lib/progress-guidance-client.mjs";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function readProgressGuidance(request:Request){
  const timezone=new URL(request.url).searchParams.get("timezone")||"UTC";
  try{if(timezone.length>80)throw new Error();new Intl.DateTimeFormat("en",{timeZone:timezone});}
  catch{return NextResponse.json({message:"Zona waktu tidak valid."},{status:422});}
  return forwardQuiz(`/analytics/me/guidance?${new URLSearchParams({timezone})}`);
}
export async function mutateProgressGuidance(request:Request,segments:string[]){
  const refresh=segments.length===1&&segments[0]==="refresh";
  if(!refresh&&!(segments.length===4&&UUID.test(segments[0])&&segments[1]==="steps"&&UUID.test(segments[2])&&["start","skip"].includes(segments[3])))return NextResponse.json({message:"Langkah belajar tidak ditemukan."},{status:404});
  let body;
  try{body=parseProgressRequest(await request.json(),refresh?"refresh":segments[3]);}
  catch{return NextResponse.json({message:"Tindakan tidak valid."},{status:400});}
  const path=refresh?"/analytics/me/guidance/refresh":`/analytics/me/plans/${segments[0]}/steps/${segments[2]}/${segments[3]}`;
  return forwardQuiz(path,{method:"POST",body:JSON.stringify(body)});
}

import "server-only";
import {NextResponse} from "next/server";
import {session} from "@/lib/session";
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export async function forwardMaterialAsset(request:Request,classId:string,assetId?:string){
 const current=await session();if(!current)return NextResponse.json({message:"Silakan masuk kembali."},{status:401});
 const writing=request.method==="POST";
 if(writing&&!["teacher","admin"].includes(current.user.role))return NextResponse.json({message:"Hanya guru atau admin dapat mengunggah gambar."},{status:403});
 if(!uuid.test(classId)||(assetId&&!uuid.test(assetId)))return NextResponse.json({message:"Gambar tidak ditemukan."},{status:404});
 try{
  let body:FormData|undefined;
  if(writing){const source=await request.formData();const file=source.get("file");if(!(file instanceof File)||file.size>10*1024*1024)return NextResponse.json({message:"Gunakan gambar hingga 10 MiB."},{status:422});body=new FormData();body.set("file",file);}
  const origin=(process.env.API_ORIGIN||"http://127.0.0.1:8109").replace(/\/$/,"");
  const result=await fetch(`${origin}/classes/${classId}/material-assets${assetId?`/${assetId}`:""}`,{method:writing?"POST":"GET",body,headers:{Authorization:`Bearer ${current.token}`},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(60_000)});
  if(!result.ok){const data=await result.json().catch(()=>null);return NextResponse.json({message:typeof data?.detail==="string"?data.detail:"Gambar belum dapat diakses."},{status:result.status});}
  if(writing)return NextResponse.json(await result.json(),{status:result.status});
  const mime=result.headers.get("Content-Type")?.split(";")[0];if(!mime||!["image/png","image/jpeg","image/webp"].includes(mime))return NextResponse.json({message:"Jenis gambar tidak valid."},{status:502});
  return new Response(result.body,{headers:{"Content-Type":mime,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
 }catch{return NextResponse.json({message:"Layanan gambar belum dapat dihubungi."},{status:503});}
}

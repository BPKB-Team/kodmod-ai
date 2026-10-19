import {mutateProgressGuidance} from "@/lib/progress-guidance-proxy";
export const runtime="nodejs";
export async function POST(request:Request,context:{params:Promise<{path:string[]}>}){
  const {path}=await context.params;
  return mutateProgressGuidance(request,path);
}

import {mutateProgressGuidance} from "@/lib/progress-guidance-proxy";
export const runtime="nodejs";
export async function POST(request:Request){return mutateProgressGuidance(request,["refresh"]);}

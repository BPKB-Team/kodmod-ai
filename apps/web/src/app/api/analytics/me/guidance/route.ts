import {readProgressGuidance} from "@/lib/progress-guidance-proxy";
export const runtime="nodejs";
export async function GET(request:Request){return readProgressGuidance(request);}

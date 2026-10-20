import {forwardMaterialAsset} from "@/lib/material-asset-proxy";
export const runtime="nodejs";
export async function POST(request:Request,{params}:{params:Promise<{classId:string}>}){return forwardMaterialAsset(request,(await params).classId);}

import {forwardMaterialAsset} from "@/lib/material-asset-proxy";
export const runtime="nodejs";
export async function GET(request:Request,{params}:{params:Promise<{classId:string;assetId:string}>}){const {classId,assetId}=await params;return forwardMaterialAsset(request,classId,assetId);}

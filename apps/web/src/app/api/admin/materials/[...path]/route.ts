import { NextResponse } from "next/server";
import { forwardAdmin, forwardAdminDownload } from "@/lib/admin-proxy";

export const runtime = "nodejs";
type Context = { params: Promise<{ path: string[] }> };
async function handler(request: Request, context: Context) {
  const { path } = await context.params;
  const tail = path.join("/");
  const id = "[0-9a-f-]{36}";
  const valid = new RegExp(request.method === "POST" ? `^${id}/index$` : request.method === "GET" ? `^${id}(?:/(?:source|original))?$` : `^${id}$`, "i").test(tail);
  if (!valid) return NextResponse.json({ message: "Materi tidak ditemukan." }, { status: 404 });
  let body: string | undefined;
  if (request.method === "PUT") {
    try { body = JSON.stringify(await request.json()); }
    catch { return NextResponse.json({ message: "Isian materi belum dapat dibaca." }, { status: 400 }); }
  }
  if (request.method === "GET" && path[1] === "original") return forwardAdminDownload(`/admin/materials/${tail}`, new URL(request.url).searchParams.get("preview") === "true");
  return forwardAdmin(`/admin/materials/${tail}`, { method: request.method, body });
}
export const GET = handler;
export const PUT = handler;
export const POST = handler;

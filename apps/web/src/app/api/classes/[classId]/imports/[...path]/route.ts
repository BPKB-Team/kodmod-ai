import { NextResponse } from "next/server";
import { teacherMaterialSession, forwardMaterial } from "@/lib/material-proxy";
export const runtime = "nodejs";
type Context = { params: Promise<{ classId: string; path: string[] }> };
async function handler(request: Request, { params }: Context) {
  const current = await teacherMaterialSession();
  if (current instanceof NextResponse) return current;
  const { classId, path } = await params;
  const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  const valid = uuid.test(classId) && uuid.test(path[0] ?? "") && (request.method === "GET" ?
    (path.length === 1 || (path.length === 2 && path[1] === "original")) : (path.length === 2 && ["retry", "pages"].includes(path[1])));
  if (!valid) return NextResponse.json({ message: "Dokumen tidak ditemukan." }, { status: 404 });
  let body: string | undefined;
  if (path[1] === "pages") {
    try { const data = await request.json(); body = JSON.stringify({ first_page: data.first_page, last_page: data.last_page }); }
    catch { return NextResponse.json({ message: "Pilihan halaman tidak valid." }, { status: 400 }); }
  }
  const preview = request.method === "GET" && path[1] === "original" && new URL(request.url).searchParams.get("preview") === "true";
  return forwardMaterial(current, `/classes/${classId}/imports/${path.join("/")}${preview ? "?preview=true" : ""}`, body, { method: request.method as "GET" | "POST", download: path[1] === "original" });
}
export const GET = handler;
export const POST = handler;

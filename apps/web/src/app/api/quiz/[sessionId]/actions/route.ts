import { NextResponse } from "next/server";
import { forwardQuiz } from "@/lib/quiz-proxy";
import { parseQuizAction } from "@/lib/quiz-actions.mjs";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) return NextResponse.json({message:"Latihan tidak ditemukan."},{status:404});
  try {
    const payload = parseQuizAction(await request.json());
    return await forwardQuiz(`/quiz/${sessionId}/actions`, {method:"POST",body:JSON.stringify(payload)});
  } catch {
    return NextResponse.json({message:"Aksi tidak valid."},{status:400});
  }
}

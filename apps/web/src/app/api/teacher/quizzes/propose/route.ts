import { forwardEditorial } from "@/lib/editorial-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return forwardEditorial(request, ["teacher", "quizzes", "propose"]);
}

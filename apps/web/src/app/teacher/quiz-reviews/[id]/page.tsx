import { QuizReviewDetail } from "@/components/editorial-pages";
export default async function Page({ params }: { params: Promise<{ id: string }> }) { return <QuizReviewDetail role="teacher" id={(await params).id} />; }

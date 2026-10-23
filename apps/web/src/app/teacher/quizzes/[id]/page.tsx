import { TeacherQuizEditor } from "@/components/editorial-pages";
export default async function Page({ params }: { params: Promise<{ id: string }> }) { return <TeacherQuizEditor id={(await params).id} />; }

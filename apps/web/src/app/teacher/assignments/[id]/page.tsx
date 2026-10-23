import { TeacherAssignmentPage } from "@/components/editorial-pages";
export default async function Page({ params }: { params: Promise<{ id: string }> }) { return <TeacherAssignmentPage id={(await params).id} />; }

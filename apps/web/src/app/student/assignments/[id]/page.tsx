import { StudentAssignmentPage } from "@/components/editorial-pages";
export default async function Page({ params }: { params: Promise<{ id: string }> }) { return <StudentAssignmentPage id={(await params).id} />; }

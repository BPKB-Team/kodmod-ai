import { StudentAssignmentIndex } from "@/components/editorial-pages";
export default async function Page({ searchParams }: { searchParams: Promise<{ page?: string }> }) { return <StudentAssignmentIndex page={(await searchParams).page} />; }

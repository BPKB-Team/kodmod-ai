import { requireSession } from "@/lib/session";
import { classroomData } from "@/lib/classrooms";
import type { Classroom, StudentMaterial } from "@/lib/class-types";
import { StudentGameHub } from "@/components/student-game-hub";

export default async function StudentPage() {
  const [{ user }, classes, materials] = await Promise.all([
    requireSession("student"),
    classroomData<Classroom[]>("student"),
    classroomData<StudentMaterial[]>("student", "/student/materials"),
  ]);

  return <StudentGameHub user={user} classes={classes} materials={materials} />;
}

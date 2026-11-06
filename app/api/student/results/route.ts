import { getStudentAccess } from "@/lib/student-auth";
import { studentServerError } from "@/lib/student-errors";
import { studentResults } from "@/lib/student-work";

export const dynamic = "force-dynamic";

export async function GET() {
  const student = await getStudentAccess();
  if (student instanceof Response) return student;

  try {
    return Response.json({ student, ...(await studentResults(student.id)) });
  } catch (error) {
    return studentServerError("GET /api/student/results", error);
  }
}

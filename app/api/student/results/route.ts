import { getStudentAccess } from "@/lib/student-auth";
import { studentResults } from "@/lib/student-work";

export const dynamic = "force-dynamic";

export async function GET() {
  const student = await getStudentAccess();
  if (student instanceof Response) return student;

  try {
    return Response.json({ student, ...(await studentResults(student.id)) });
  } catch (error) {
    return databaseError(error);
  }
}

function databaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected database error";
  const unavailable = message.includes("no such table") || message.includes("SQLITE");
  return Response.json({ error: unavailable ? "The student service is still being set up." : message }, { status: 500 });
}

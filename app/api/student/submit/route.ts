import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";
import { getStudentAccess } from "@/lib/student-auth";
import { studentServerError } from "@/lib/student-errors";
import { submitActivityWork } from "@/lib/student-work";

export const dynamic = "force-dynamic";

/** Hands in a class activity once; see submitActivityWork. */
export async function POST(request: Request) {
  const student = await getStudentAccess();
  if (student instanceof Response) return student;

  // Per student, not per address: a whole class may submit from one school network.
  const limit = checkRateLimit(`student-submit:${student.id}`, 60, 10 * 60 * 1000);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds, "student");

  try {
    const body = (await request.json().catch(() => ({}))) as { activityId?: unknown; answers?: unknown };
    const { status, body: answer } = await submitActivityWork(student.id, body.activityId, body.answers);
    return Response.json(answer, { status });
  } catch (error) {
    return studentServerError("POST /api/student/submit", error, "submit");
  }
}

import { getStudentAccess } from "@/lib/student-auth";
import { recordTopicProgress, topicErrorResponse } from "@/lib/curriculum-catalog";

/**
 * A student marks an approved topic as read, or finishes its quiz: the answers are
 * marked here, the topic counts as read and the best score is kept.
 */
export async function POST(request: Request) {
  const student = await getStudentAccess();
  if (student instanceof Response) return student;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return Response.json({ error: "Choose a valid learning topic." }, { status: 400 });
  try { return Response.json(await recordTopicProgress(student.id, body.topicId, body.answers)); }
  catch (error) { return topicErrorResponse(error); }
}

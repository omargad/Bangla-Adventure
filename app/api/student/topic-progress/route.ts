import { getStudentAccess } from "@/lib/student-auth";
import { recordTopicProgress, topicErrorResponse } from "@/lib/curriculum-catalog";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Topic progress saves (readings and quiz tries together) per student in 10 minutes, as for class work (POST /api/student/submit). */
const TOPIC_PROGRESS_PER_10_MINUTES = 60;

/**
 * A student marks an approved topic as read, or finishes its quiz: the answers are
 * marked here, the topic counts as read and the best score is kept (only the day's first
 * few tries at a quiz can raise it; see recordTopicProgress).
 */
export async function POST(request: Request) {
  const student = await getStudentAccess();
  if (student instanceof Response) return student;
  // Per student, not per address: a whole class may read from one school network.
  const limit = checkRateLimit(`student-topic-progress:${student.id}`, TOPIC_PROGRESS_PER_10_MINUTES, 10 * 60 * 1000);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds, "student");
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return Response.json({ error: "Choose a valid learning topic.", errorBn: "একটি সঠিক শেখার বিষয় বেছে নাও।" }, { status: 400 });
  try { return Response.json(await recordTopicProgress(student.id, body.topicId, body.answers)); }
  catch (error) { return topicErrorResponse(error); }
}

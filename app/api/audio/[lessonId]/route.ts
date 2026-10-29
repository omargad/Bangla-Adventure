import { getSessionAdult } from "@/lib/auth";
import { canTeach } from "@/lib/roles";
import { approvedRecordings, isLessonApproved, isLessonId, lessonUnavailable } from "@/lib/lesson-approval";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ lessonId: string }> };

/**
 * Which parts of one lesson have an approved human recording right now, keyed
 * `${lessonId}/${slot}` with the recording id (the same choice
 * /api/audio/<lesson>/<slot> makes). A learner page asks when a lesson opens,
 * so a recording a teacher approved after the page loaded plays, labelled as a
 * recording, without a reload.
 */
export async function GET(_request: Request, context: RouteContext) {
  const { lessonId } = await context.params;
  if (!isLessonId(lessonId)) return Response.json({ error: "Lesson not found." }, { status: 404 });
  // Learners only hear approved lessons; teachers and administrators preview any lesson.
  if (!(await isLessonApproved(lessonId)) && !canTeach(await getSessionAdult())) return lessonUnavailable();
  return Response.json({ recordings: await approvedRecordings([lessonId]) }, { headers: { "Cache-Control": "private, no-store" } });
}

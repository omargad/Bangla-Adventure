import { getStaffAccess } from "@/lib/auth";
import { lessonErrorResponse, readLessonBody, saveVideoReview } from "@/lib/lesson-approval";

export const dynamic = "force-dynamic";

/** Video decisions affect every learner, so only administrators may save them. */
export async function POST(request: Request) {
  const actor = await getStaffAccess("admin");
  if (actor instanceof Response) return actor;
  const body = await readLessonBody(request);
  if (body instanceof Response) return body;
  try {
    const { review, created } = await saveVideoReview(actor.id, body);
    return Response.json({ review }, { status: created ? 201 : 200 });
  } catch (error) { return lessonErrorResponse(error); }
}

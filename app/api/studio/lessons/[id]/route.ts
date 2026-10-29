import { getStaffAccess } from "@/lib/auth";
import { decideLesson, isLessonId, lessonErrorResponse, lessonStudioDetail, readLessonBody } from "@/lib/lesson-approval";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

const notFound = () => Response.json({ error: "Lesson not found.", errorBn: "পাঠটি পাওয়া যায়নি।" }, { status: 404 });

/** One lesson for the Studio: approval and history, recordings, the video check and specialist checks. */
export async function GET(_request: Request, context: RouteContext) {
  const actor = await getStaffAccess("teach");
  if (actor instanceof Response) return actor;
  const { id } = await context.params;
  if (!isLessonId(id)) return notFound();
  try { return Response.json(await lessonStudioDetail(id)); }
  catch (error) { return lessonErrorResponse(error); }
}

/** Approve a lesson for students, or withdraw it so students and parents no longer see it. */
export async function POST(request: Request, context: RouteContext) {
  const actor = await getStaffAccess("teach");
  if (actor instanceof Response) return actor;
  const { id } = await context.params;
  if (!isLessonId(id)) return notFound();
  const body = await readLessonBody(request);
  if (body instanceof Response) return body;
  try {
    await decideLesson(actor.id, id, body);
    return Response.json(await lessonStudioDetail(id));
  } catch (error) { return lessonErrorResponse(error); }
}

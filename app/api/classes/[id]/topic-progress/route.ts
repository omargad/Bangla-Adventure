import { getStaffAccess } from "@/lib/auth";
import { findManagedClass } from "@/lib/class-access";
import { classTopicProgress, topicErrorResponse } from "@/lib/curriculum-catalog";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

/** Topics read and topic-quiz results of the students allocated to a class this teacher manages. */
export async function GET(_request: Request, context: RouteContext) {
  const actor = await getStaffAccess("teach");
  if (actor instanceof Response) return actor;
  const { id } = await context.params;
  if (!(await findManagedClass(actor, id))) return Response.json({ error: "Class not found." }, { status: 404 });
  try { return Response.json(await classTopicProgress(id)); }
  catch (error) { return topicErrorResponse(error); }
}

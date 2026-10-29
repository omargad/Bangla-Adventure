import { getStaffAccess } from "@/lib/auth";
import { lessonErrorResponse, lessonStudioList } from "@/lib/lesson-approval";

export const dynamic = "force-dynamic";

/** The Studio lesson list: every lesson's shared approval state and every recording waiting for review. */
export async function GET() {
  const actor = await getStaffAccess("teach");
  if (actor instanceof Response) return actor;
  try { return Response.json(await lessonStudioList()); }
  catch (error) { return lessonErrorResponse(error); }
}

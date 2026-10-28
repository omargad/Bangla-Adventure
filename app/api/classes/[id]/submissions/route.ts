import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { activitySubmissions, classActivities, classes } from "@/db/schema";
import { getSessionAdult } from "@/lib/auth";
import { canTeach } from "@/lib/roles";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  const user = await getSessionAdult();
  if (user && !canTeach(user)) return Response.json({ error: "An approved teacher account is required." }, { status: 403 });
  if (!user) return Response.json({ error: "Sign in to manage grades." }, { status: 401 });

  try {
    const { id } = await context.params;
    const db = await getDb();
    const [ownedClass] = await db.select({ id: classes.id }).from(classes).where(and(eq(classes.id, id), eq(classes.teacherId, user.id))).limit(1);
    if (!ownedClass) return Response.json({ error: "Class not found." }, { status: 404 });

    const body = (await request.json().catch(() => ({}))) as { submissionId?: unknown };
    const submissionId = typeof body.submissionId === "string" ? body.submissionId : "";
    if (!submissionId) return Response.json({ error: "Choose a submission to reset." }, { status: 400 });

    const [submission] = await db
      .select({ id: activitySubmissions.id })
      .from(activitySubmissions)
      .innerJoin(classActivities, eq(activitySubmissions.activityId, classActivities.id))
      .where(and(eq(activitySubmissions.id, submissionId), eq(classActivities.classId, id)))
      .limit(1);
    if (!submission) return Response.json({ error: "Submission not found." }, { status: 404 });

    await db.delete(activitySubmissions).where(eq(activitySubmissions.id, submission.id));
    return Response.json({ ok: true });
  } catch (error) {
    return databaseError(error);
  }
}

function databaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected database error";
  const unavailable = message.includes("no such table") || message.includes("SQLITE");
  return Response.json({ error: unavailable ? "The grades service is still being set up." : message }, { status: 500 });
}

import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { adults, classes, classActivities, userAuditEvents } from "../../../../../db/schema";
import { getSessionAdult } from "@/lib/auth";
import { canTeach, canPublishContent } from "@/lib/roles";
import { findManagedClass, managedClass } from "@/lib/class-access";
import { validateQuizQuestions } from "@/lib/classroom";
import { findApprovedTopic } from "@/lib/curriculum-catalog";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };
type Db = Awaited<ReturnType<typeof getDb>>;
type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
class ActivityError extends Error { constructor(message: string, readonly status: number) { super(message); } }
function currentManager(tx: Transaction, actorId: string, classId: string) {
  const actor = tx.select().from(adults).where(eq(adults.id, actorId)).get();
  if (!actor || !canTeach(actor) || actor.approvalStatus !== "approved" || actor.mustChangePassword) throw new ActivityError("Approved staff access required.", 403);
  if (!tx.select({ id: classes.id }).from(classes).where(managedClass(actor, classId)).get()) throw new ActivityError("Class not found.", 404);
  return actor;
}
function audit(tx: Transaction, actorId: string, classId: string, action: string, details: Record<string, unknown>) {
  tx.insert(userAuditEvents).values({ id: crypto.randomUUID(), actorId, targetId: classId, targetType: "class", action, detailsJson: JSON.stringify(details) }).run();
}

export async function POST(request: Request, context: RouteContext) {
  const user = await getSessionAdult();
  if (user && !canTeach(user)) return Response.json({ error: "An approved teacher account is required." }, { status: 403 });
  if (!user) return Response.json({ error: "Sign in to create activities." }, { status: 401 });

  try {
    const { id } = await context.params;
    if (!(await findManagedClass(user, id))) return Response.json({ error: "Class not found." }, { status: 404 });

    const body = (await request.json().catch(() => ({}))) as {
      title?: unknown;
      instructions?: unknown;
      topicId?: unknown;
      questions?: unknown;
    };
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title || title.length > 120) return Response.json({ error: "Give the activity a title of 1–120 characters." }, { status: 400 });
    if (body.instructions !== undefined && (typeof body.instructions !== "string" || body.instructions.length > 1000)) return Response.json({ error: "Instructions must be text of at most 1000 characters." }, { status: 400 });
    // Activities link only to approved topics, so students never get a pointer to unapproved content.
    const linked = body.topicId === undefined || body.topicId === null || body.topicId === "" ? null : await findApprovedTopic(body.topicId);
    if (body.topicId !== undefined && body.topicId !== null && body.topicId !== "" && !linked) return Response.json({ error: "Choose a valid learning topic." }, { status: 400 });
    const instructions = typeof body.instructions === "string" ? body.instructions.trim().slice(0, 1000) : "";
    const topicId = linked?.id ?? null;

    const validated = validateQuizQuestions(body.questions);
    if ("error" in validated) return Response.json({ error: validated.error }, { status: 400 });

    const db = await getDb();
    const activity = db.transaction((tx) => {
      const actor = currentManager(tx, user.id, id);
      const approved = canPublishContent(actor);
      const now = new Date().toISOString();
      const row = tx.insert(classActivities).values({
        id: crypto.randomUUID(),
        classId: id,
        title,
        instructions,
        topicId,
        questionsJson: JSON.stringify(validated.questions),
        createdBy: actor.id, approvalStatus: approved ? "approved" : "pending",
        reviewedBy: approved ? actor.id : null, reviewedAt: approved ? now : null,
        createdAt: now, updatedAt: now,
      }).returning().get();
      audit(tx, actor.id, id, "class-activity-created", { activityId: row.id, approvalStatus: row.approvalStatus, revision: row.revision });
      return row;
    });
    return Response.json({ activity: { ...activity, questions: validated.questions } }, { status: 201 });
  } catch (error) {
    return databaseError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const user = await getSessionAdult();
  if (user && !canTeach(user)) return Response.json({ error: "An approved teacher account is required." }, { status: 403 });
  if (!user) return Response.json({ error: "Sign in to manage activities." }, { status: 401 });

  try {
    const { id } = await context.params;
    if (!(await findManagedClass(user, id))) return Response.json({ error: "Class not found." }, { status: 404 });

    const body = (await request.json().catch(() => ({}))) as { activityId?: unknown; status?: unknown; approvalStatus?: unknown; revision?: unknown; reviewNote?: unknown };
    const activityId = typeof body.activityId === "string" ? body.activityId : "";
    const status = body.status === "closed" ? "closed" : body.status === "open" ? "open" : null;
    const review = body.approvalStatus !== undefined;
    if (!activityId || (!review && !status)) return Response.json({ error: "Choose an activity and a status." }, { status: 400 });

    const db = await getDb();
    const updated = db.transaction((tx) => {
      const actor = currentManager(tx, user.id, id);
      if (review && !canPublishContent(actor)) throw new ActivityError("Only an administrator can approve or reject class activities.", 403);
      const before = tx.select().from(classActivities).where(and(eq(classActivities.id, activityId), eq(classActivities.classId, id))).get();
      if (!before) throw new ActivityError("Activity not found.", 404);
      const now = new Date().toISOString();
      if (review) {
        if (body.approvalStatus !== "approved" && body.approvalStatus !== "rejected") throw new ActivityError("Choose approved or rejected.", 400);
        if (!Number.isInteger(body.revision) || body.revision !== before.revision) throw new ActivityError("This activity changed. Reload it before reviewing.", 409);
        if (body.reviewNote !== undefined && typeof body.reviewNote !== "string") throw new ActivityError("Provide a text review note.", 400);
        const note = typeof body.reviewNote === "string" ? body.reviewNote.trim() : "";
        if (note.length > 1500 || (body.approvalStatus === "rejected" && !note)) throw new ActivityError("A rejection needs a note; review notes can be at most 1500 characters.", 400);
        const row = tx.update(classActivities).set({ approvalStatus: body.approvalStatus, reviewedBy: actor.id, reviewedAt: now, reviewNote: note, updatedAt: now, revision: before.revision + 1 }).where(and(eq(classActivities.id, activityId), eq(classActivities.revision, before.revision))).returning().get();
        if (!row) throw new ActivityError("This activity changed. Reload it before reviewing.", 409);
        audit(tx, actor.id, id, "class-activity-reviewed", { activityId, approvalStatus: row.approvalStatus, revision: row.revision, reviewNote: note });
        return row;
      }
      return tx.update(classActivities).set({ status: status!, updatedAt: now, revision: before.revision + 1 }).where(eq(classActivities.id, activityId)).returning().get();
    });
    return Response.json({ ok: true, status: updated.status, activity: { ...updated, questions: JSON.parse(updated.questionsJson), questionsJson: undefined } });
  } catch (error) {
    return databaseError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const user = await getSessionAdult();
  if (user && !canTeach(user)) return Response.json({ error: "An approved teacher account is required." }, { status: 403 });
  if (!user) return Response.json({ error: "Sign in to manage activities." }, { status: 401 });

  try {
    const { id } = await context.params;
    if (!(await findManagedClass(user, id))) return Response.json({ error: "Class not found." }, { status: 404 });

    const body = (await request.json().catch(() => ({}))) as { activityId?: unknown };
    const activityId = typeof body.activityId === "string" ? body.activityId : "";
    if (!activityId) return Response.json({ error: "Choose an activity to remove." }, { status: 400 });

    const db = await getDb();
    const removed = db.transaction((tx) => {
      const actor = currentManager(tx, user.id, id);
      const row = tx.delete(classActivities).where(and(eq(classActivities.id, activityId), eq(classActivities.classId, id))).returning().get();
      if (row) audit(tx, actor.id, id, "class-activity-removed", { activityId, approvalStatus: row.approvalStatus, revision: row.revision });
      return row;
    });
    if (!removed) return Response.json({ error: "Activity not found." }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    return databaseError(error);
  }
}

function databaseError(error: unknown) {
  if (error instanceof ActivityError) return Response.json({ error: error.message, errorBn: "কার্যক্রমের অনুমতি বা পর্যালোচনার তথ্য যাচাই করে আবার চেষ্টা করুন।" }, { status: error.status });
  const message = error instanceof Error ? error.message : "Unexpected database error";
  const unavailable = message.includes("no such table") || message.includes("SQLITE");
  return Response.json({ error: unavailable ? "The classroom service is still being set up." : message }, { status: 500 });
}

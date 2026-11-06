import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { classActivities } from "../../../../../db/schema";
import { getSessionAdult } from "@/lib/auth";
import { canTeach, canPublishContent } from "@/lib/roles";
import { findManagedClass } from "@/lib/class-access";
import { ActivityError, changeActivityStatus, currentActivityManager } from "@/lib/class-activities";
import { auditClass } from "@/lib/class-audit";
import { classServerError } from "@/lib/class-errors";
import { validateQuizQuestions } from "@/lib/classroom";
import { findApprovedTopic } from "@/lib/curriculum-catalog";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };
const refuse = (status: number, error: string, errorBn: string) => Response.json({ error, errorBn }, { status });
const notTeacher = () => refuse(403, "An approved teacher account is required.", "অনুমোদিত শিক্ষকের অ্যাকাউন্ট প্রয়োজন।");
const classNotFound = () => refuse(404, "Class not found.", "ক্লাসটি পাওয়া যায়নি।");
const activityChanged = () => new ActivityError("This activity changed. Reload it before reviewing.", 409, "কার্যক্রমটি বদলেছে। পর্যালোচনার আগে আবার লোড করুন।");

export async function POST(request: Request, context: RouteContext) {
  const user = await getSessionAdult();
  if (user && !canTeach(user)) return notTeacher();
  if (!user) return refuse(401, "Sign in to create activities.", "কার্যক্রম তৈরি করতে সাইন ইন করুন।");

  try {
    const { id } = await context.params;
    if (!(await findManagedClass(user, id))) return classNotFound();

    const body = ((await request.json().catch(() => ({}))) ?? {}) as {
      title?: unknown;
      instructions?: unknown;
      topicId?: unknown;
      questions?: unknown;
    };
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title || title.length > 120) return refuse(400, "Give the activity a title of 1–120 characters.", "কার্যক্রমের শিরোনাম ১–১২০ অক্ষরের মধ্যে দিন।");
    if (body.instructions !== undefined && (typeof body.instructions !== "string" || body.instructions.length > 1000)) return refuse(400, "Instructions must be text of at most 1000 characters.", "নির্দেশনা সর্বোচ্চ ১০০০ অক্ষরের লেখা হতে পারে।");
    // Activities link only to approved topics, so students never get a pointer to unapproved content.
    const linked = body.topicId === undefined || body.topicId === null || body.topicId === "" ? null : await findApprovedTopic(body.topicId);
    if (body.topicId !== undefined && body.topicId !== null && body.topicId !== "" && !linked) return refuse(400, "Choose a valid learning topic.", "একটি সঠিক শেখার বিষয় বেছে নিন।");
    const instructions = typeof body.instructions === "string" ? body.instructions.trim().slice(0, 1000) : "";
    const topicId = linked?.id ?? null;

    const validated = validateQuizQuestions(body.questions);
    if ("error" in validated) return refuse(400, validated.error, "প্রশ্নগুলো দেখে ঠিক করে আবার জমা দিন।");

    const db = await getDb();
    const activity = db.transaction((tx) => {
      const { actor, className } = currentActivityManager(tx, user.id, id);
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
      auditClass(tx, actor.id, id, "class-activity-created", { activityId: row.id, title: row.title, approvalStatus: row.approvalStatus, revision: row.revision }, className);
      return row;
    });
    return Response.json({ activity: { ...activity, questions: validated.questions } }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}

/** { activityId, status: "open" | "closed" } opens or closes an activity; { activityId, approvalStatus, revision, reviewNote } is an administrator's review. Both are audited. */
export async function PATCH(request: Request, context: RouteContext) {
  const user = await getSessionAdult();
  if (user && !canTeach(user)) return notTeacher();
  if (!user) return refuse(401, "Sign in to manage activities.", "কার্যক্রম পরিচালনা করতে সাইন ইন করুন।");

  try {
    const { id } = await context.params;
    if (!(await findManagedClass(user, id))) return classNotFound();

    const body = ((await request.json().catch(() => ({}))) ?? {}) as { activityId?: unknown; status?: unknown; approvalStatus?: unknown; revision?: unknown; reviewNote?: unknown };
    const activityId = typeof body.activityId === "string" ? body.activityId : "";
    const status = body.status === "closed" ? "closed" : body.status === "open" ? "open" : null;
    const review = body.approvalStatus !== undefined;
    if (!activityId || (!review && !status)) return refuse(400, "Choose an activity and a status.", "একটি কার্যক্রম ও তার অবস্থা বেছে নিন।");

    if (!review) {
      const updated = await changeActivityStatus(user.id, id, activityId, status!);
      return Response.json({ ok: true, status: updated.status, activity: { ...updated, questions: JSON.parse(updated.questionsJson), questionsJson: undefined } });
    }

    const db = await getDb();
    const updated = db.transaction((tx) => {
      const { actor, className } = currentActivityManager(tx, user.id, id);
      if (!canPublishContent(actor)) throw new ActivityError("Only an administrator can approve or reject class activities.", 403, "শুধু প্রশাসক ক্লাসের কার্যক্রম অনুমোদন বা প্রত্যাখ্যান করতে পারেন।");
      const before = tx.select().from(classActivities).where(and(eq(classActivities.id, activityId), eq(classActivities.classId, id))).get();
      if (!before) throw new ActivityError("Activity not found.", 404, "কার্যক্রমটি পাওয়া যায়নি।");
      const now = new Date().toISOString();
      if (body.approvalStatus !== "approved" && body.approvalStatus !== "rejected") throw new ActivityError("Choose approved or rejected.", 400, "অনুমোদিত বা প্রত্যাখ্যাত বেছে নিন।");
      if (!Number.isInteger(body.revision) || body.revision !== before.revision) throw activityChanged();
      if (body.reviewNote !== undefined && typeof body.reviewNote !== "string") throw new ActivityError("Provide a text review note.", 400, "পর্যালোচনার নোট লিখুন।");
      const note = typeof body.reviewNote === "string" ? body.reviewNote.trim() : "";
      if (note.length > 1500 || (body.approvalStatus === "rejected" && !note)) throw new ActivityError("A rejection needs a note; review notes can be at most 1500 characters.", 400, "প্রত্যাখ্যানের কারণ লিখুন। নোট সর্বোচ্চ ১৫০০ অক্ষরের হতে পারে।");
      const row = tx.update(classActivities).set({ approvalStatus: body.approvalStatus, reviewedBy: actor.id, reviewedAt: now, reviewNote: note, updatedAt: now, revision: before.revision + 1 }).where(and(eq(classActivities.id, activityId), eq(classActivities.revision, before.revision))).returning().get();
      if (!row) throw activityChanged();
      auditClass(tx, actor.id, id, "class-activity-reviewed", { activityId, title: row.title, approvalStatus: row.approvalStatus, revision: row.revision, reviewNote: note }, className);
      return row;
    });
    return Response.json({ ok: true, status: updated.status, activity: { ...updated, questions: JSON.parse(updated.questionsJson), questionsJson: undefined } });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const user = await getSessionAdult();
  if (user && !canTeach(user)) return notTeacher();
  if (!user) return refuse(401, "Sign in to manage activities.", "কার্যক্রম পরিচালনা করতে সাইন ইন করুন।");

  try {
    const { id } = await context.params;
    if (!(await findManagedClass(user, id))) return classNotFound();

    const body = ((await request.json().catch(() => ({}))) ?? {}) as { activityId?: unknown };
    const activityId = typeof body.activityId === "string" ? body.activityId : "";
    if (!activityId) return refuse(400, "Choose an activity to remove.", "মুছতে একটি কার্যক্রম বেছে নিন।");

    const db = await getDb();
    const removed = db.transaction((tx) => {
      const { actor, className } = currentActivityManager(tx, user.id, id);
      const row = tx.delete(classActivities).where(and(eq(classActivities.id, activityId), eq(classActivities.classId, id))).returning().get();
      if (row) auditClass(tx, actor.id, id, "class-activity-removed", { activityId, title: row.title, approvalStatus: row.approvalStatus, revision: row.revision }, className);
      return row;
    });
    if (!removed) return refuse(404, "Activity not found.", "কার্যক্রমটি পাওয়া যায়নি।");
    return Response.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}

function failure(error: unknown) {
  if (error instanceof ActivityError) return refuse(error.status, error.message, error.messageBn);
  return classServerError(error);
}

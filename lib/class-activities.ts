import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { adults, classActivities, classes } from "../db/schema";
import { managedClass } from "./class-access";
import { auditClass } from "./class-audit";
import type { Tx } from "./enrollments";
import { canTeach } from "./roles";

/** A refused activity change, in English and Bangla. */
export class ActivityError extends Error {
  constructor(message: string, readonly status: number, readonly messageBn: string) { super(message); }
}

export type ActivityManager = typeof adults.$inferSelect;

/**
 * The actor, read again inside the transaction, if they may still manage activities in this class:
 * an approved teacher who owns it or an administrator, without a temporary password. Returns the
 * actor and the class name (for the audit row).
 */
export function currentActivityManager(tx: Tx, actorId: string, classId: string): { actor: ActivityManager; className: string } {
  const actor = tx.select().from(adults).where(eq(adults.id, actorId)).get();
  if (!actor || !canTeach(actor) || actor.approvalStatus !== "approved" || actor.mustChangePassword) throw new ActivityError("Approved staff access required.", 403, "অনুমোদিত শিক্ষক বা প্রশাসকের অ্যাকাউন্ট প্রয়োজন।");
  const classroom = tx.select({ name: classes.name }).from(classes).where(managedClass(actor, classId)).get();
  if (!classroom) throw new ActivityError("Class not found.", 404, "ক্লাসটি পাওয়া যায়নি।");
  return { actor, className: classroom.name };
}

/**
 * Open or close an activity in a class the actor manages. A change is audited as class-activity-opened
 * or class-activity-closed (with the activity title); asking for the status it already has changes and
 * audits nothing.
 */
export async function changeActivityStatus(actorId: string, classId: string, activityId: string, status: "open" | "closed") {
  const db = await getDb();
  return db.transaction((tx) => {
    const { actor, className } = currentActivityManager(tx, actorId, classId);
    const before = tx.select().from(classActivities).where(and(eq(classActivities.id, activityId), eq(classActivities.classId, classId))).get();
    if (!before) throw new ActivityError("Activity not found.", 404, "কার্যক্রমটি পাওয়া যায়নি।");
    if (before.status === status) return before;
    const row = tx.update(classActivities).set({ status, updatedAt: new Date().toISOString(), revision: before.revision + 1 }).where(eq(classActivities.id, activityId)).returning().get();
    auditClass(tx, actor.id, classId, status === "open" ? "class-activity-opened" : "class-activity-closed", { activityId, title: row.title, revision: row.revision }, className);
    return row;
  });
}

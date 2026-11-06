import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { classes } from "../db/schema";
import { auditClass } from "./class-audit";
import { canManageUsers, type AccountAccess } from "./roles";

export type Staff = AccountAccess & { id: string };

/**
 * Which class a staff member may manage: administrators any class, teachers
 * only the classes they own. Callers check canTeach first.
 */
export function managedClass(actor: Staff, classId: string) {
  return canManageUsers(actor) ? eq(classes.id, classId) : and(eq(classes.id, classId), eq(classes.teacherId, actor.id));
}

/** The class if this actor manages it, otherwise null (routes answer 404 either way). */
export async function findManagedClass(actor: Staff, classId: string) {
  const db = await getDb();
  const [row] = await db.select().from(classes).where(managedClass(actor, classId)).limit(1);
  return row ?? null;
}

/**
 * Delete a class this actor manages, with its roster, activities and submissions,
 * and audit the deletion with the class name, so Recent changes can still name it.
 * Returns null when the actor does not manage the class.
 */
export async function deleteClass(actor: Staff, classId: string) {
  const db = await getDb();
  return db.transaction((tx) => {
    const removed = tx.delete(classes).where(managedClass(actor, classId)).returning().get();
    if (!removed) return null;
    auditClass(tx, actor.id, removed.id, "class-deleted", { classId: removed.id, name: removed.name, teacherId: removed.teacherId }, removed.name);
    return removed;
  });
}

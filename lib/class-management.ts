import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { adults, classes, userAuditEvents } from "../db/schema";
import { generateJoinCode } from "./classroom";
import type { Tx } from "./enrollments";
import { canManageUsers } from "./roles";
import { UserManagementError } from "./user-management";

/**
 * Administrators set classes up for teachers: create a class owned by a chosen teacher, or give a
 * class to another teacher. The class keeps its students, activities, announcements, results and
 * attendance; only who may teach it changes. Teachers still create their own classes in /teach.
 */

/** Teachers a class can be given to: approved, active teacher accounts. */
const approvedTeacher = and(eq(adults.role, "teacher"), eq(adults.teacherStatus, "approved"), eq(adults.status, "active"), eq(adults.approvalStatus, "approved"))!;
const teacherFields = { id: adults.id, displayName: adults.displayName, email: adults.email };

function requireAdministrator(tx: Tx, actorId: string) {
  const actor = tx.select({ role: adults.role, status: adults.status, teacherStatus: adults.teacherStatus }).from(adults).where(eq(adults.id, actorId)).get();
  if (!actor || !canManageUsers(actor)) throw new UserManagementError("Administrator access required.", 403, "প্রশাসকের অ্যাকাউন্ট প্রয়োজন।");
}
function findTeacher(tx: Tx, teacherId: string) {
  const teacher = tx.select(teacherFields).from(adults).where(and(eq(adults.id, teacherId), approvedTeacher)).get();
  if (!teacher) throw new UserManagementError("Choose an approved teacher.", 404, "একজন অনুমোদিত শিক্ষক বেছে নিন।");
  return teacher;
}
function audit(tx: Tx, actorId: string, classId: string, action: string, details: object) {
  tx.insert(userAuditEvents).values({ id: crypto.randomUUID(), actorId, targetId: classId, targetType: "class", action, detailsJson: JSON.stringify(details) }).run();
}

/** The class name rule shared with teachers' own classes. */
export function className(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > 60) throw new UserManagementError("Give the class a name of 1–60 characters.", 400, "ক্লাসের নাম ১–৬০ অক্ষরের মধ্যে দিন।");
  return name;
}

/** Approved teachers, A–Z, for an administrator choosing who teaches a class. */
export async function listTeachers(actorId: string) {
  const db = await getDb();
  return db.transaction((tx) => {
    requireAdministrator(tx, actorId);
    return tx.select(teacherFields).from(adults).where(approvedTeacher).orderBy(adults.displayName, adults.email).all();
  });
}

/** Create a class owned by an approved teacher, audited as class-created-for-teacher. */
export async function createClassForTeacher(actorId: string, name: unknown, teacherId: string) {
  const title = className(name);
  const db = await getDb();
  return db.transaction((tx) => {
    requireAdministrator(tx, actorId);
    const teacher = findTeacher(tx, teacherId);
    // Regenerate on the (vanishingly rare) join-code collision.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const created = tx.insert(classes).values({ id: crypto.randomUUID(), teacherId: teacher.id, name: title, joinCode: generateJoinCode() })
        .onConflictDoNothing().returning().get();
      if (!created) continue;
      audit(tx, actorId, created.id, "class-created-for-teacher", { classId: created.id, name: created.name, teacherId: teacher.id });
      return { ...created, teacherName: teacher.displayName };
    }
    throw new UserManagementError("Could not allocate a join code. Try again.", 500, "যোগদান কোড তৈরি করা যায়নি। আবার চেষ্টা করুন।");
  });
}

/**
 * Give a class to another approved teacher, audited as class-teacher-changed. The previous teacher
 * loses access at once; everything in the class stays with it. Choosing the current teacher changes
 * nothing and is not audited.
 */
export async function changeClassTeacher(actorId: string, classId: string, teacherId: string) {
  const db = await getDb();
  return db.transaction((tx) => {
    requireAdministrator(tx, actorId);
    const classroom = tx.select().from(classes).where(eq(classes.id, classId)).get();
    if (!classroom) throw new UserManagementError("Class not found.", 404, "ক্লাসটি পাওয়া যায়নি।");
    const teacher = findTeacher(tx, teacherId);
    if (classroom.teacherId === teacher.id) return { class: { ...classroom, teacherName: teacher.displayName }, changed: false };
    const updated = tx.update(classes).set({ teacherId: teacher.id }).where(eq(classes.id, classroom.id)).returning().get();
    audit(tx, actorId, classroom.id, "class-teacher-changed", { classId: classroom.id, name: classroom.name, fromTeacherId: classroom.teacherId, toTeacherId: teacher.id });
    return { class: { ...updated, teacherName: teacher.displayName }, changed: true };
  });
}

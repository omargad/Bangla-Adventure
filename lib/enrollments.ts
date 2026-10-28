import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { adults, classes, students, classStudents, studentClassEnrollments, userAuditEvents } from "../db/schema";
import { canTeach } from "./roles";
import { createSessionToken, hashSessionToken } from "./password";
import { UserManagementError } from "./user-management";

type Tx = Parameters<Parameters<Awaited<ReturnType<typeof getDb>>["transaction"]>[0]>[0];
function authorize(tx: Tx, actorId: string, classId: string) {
  const actor = tx.select().from(adults).where(eq(adults.id, actorId)).get();
  if (!actor || !canTeach(actor)) throw new UserManagementError("Approved teacher access required.", 403);
  const classroom = tx.select().from(classes).where(eq(classes.id, classId)).get();
  if (!classroom || (actor.role !== "admin" && classroom.teacherId !== actor.id)) throw new UserManagementError("Class not found.", 404);
}
export async function roster(actorId: string, classId: string) {
  const db = await getDb();
  return db.transaction((tx) => {
    authorize(tx, actorId, classId);
    return tx.select({ id: studentClassEnrollments.id, studentId: students.id, username: students.username, displayName: students.displayName, active: studentClassEnrollments.active })
      .from(studentClassEnrollments).innerJoin(students, eq(students.id, studentClassEnrollments.studentId))
      .where(eq(studentClassEnrollments.classId, classId)).orderBy(students.displayName).all();
  });
}
export async function allocateStudent(actorId: string, classId: string, username: string) {
  if (!/^[a-z0-9._-]{3,40}$/i.test(username.trim())) throw new UserManagementError("Enter the student's registered username (3–40 characters).");
  const db = await getDb();
  return db.transaction((tx) => {
    authorize(tx, actorId, classId);
    const student = tx.select().from(students).where(and(eq(students.username, username.trim().toLowerCase()), eq(students.status, "active"))).get();
    if (!student) throw new UserManagementError("No active student has that username.", 404);
    const existing = tx.select().from(studentClassEnrollments).where(and(eq(studentClassEnrollments.studentId, student.id), eq(studentClassEnrollments.classId, classId))).get();
    if (existing?.active) return { allocated: true };
    if (existing) tx.update(studentClassEnrollments).set({ active: true }).where(eq(studentClassEnrollments.id, existing.id)).run();
    else {
      const rosterId = crypto.randomUUID();
      tx.insert(classStudents).values({ id: rosterId, classId, displayName: student.displayName, tokenHash: hashSessionToken(createSessionToken()) }).run();
      tx.insert(studentClassEnrollments).values({ id: crypto.randomUUID(), studentId: student.id, classId, classStudentId: rosterId }).run();
    }
    tx.insert(userAuditEvents).values({ id: crypto.randomUUID(), actorId, targetId: student.id, targetType: "student", action: "class-allocated", detailsJson: JSON.stringify({ classId }) }).run();
    return { allocated: true };
  });
}
export async function removeAllocation(actorId: string, classId: string, studentId: string) {
  const db = await getDb();
  return db.transaction((tx) => {
    authorize(tx, actorId, classId);
    const updated = tx.update(studentClassEnrollments).set({ active: false })
      .where(and(eq(studentClassEnrollments.classId, classId), eq(studentClassEnrollments.studentId, studentId), eq(studentClassEnrollments.active, true))).returning().get();
    if (!updated) throw new UserManagementError("Active allocation not found.", 404);
    tx.insert(userAuditEvents).values({ id: crypto.randomUUID(), actorId, targetId: studentId, targetType: "student", action: "class-allocation-removed", detailsJson: JSON.stringify({ classId }) }).run();
    return { removed: true };
  });
}

import { randomInt } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { adults, classes, students, classStudents, studentClassEnrollments, userAuditEvents } from "../db/schema";
import { canTeach } from "./roles";
import { createSessionToken, generateTemporaryPassword, hashPasswordAsync, hashSessionToken } from "./password";
import { parseStudentCsv, usernameSlug, type SignInSheetRow, type StudentImportIssue } from "./student-import";
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

/**
 * Name slug plus a short random number, unique in the database and in this upload; widens to six
 * digits when the four-digit names are crowded. `random` is replaceable so tests can force collisions.
 */
export function generateUsername(tx: Tx, displayName: string, used: Set<string>, random: (min: number, max: number) => number = randomInt) {
  const base = usernameSlug(displayName);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = `${base}${attempt < 10 ? random(1000, 10000) : random(100000, 1000000)}`;
    if (used.has(candidate) || tx.select({ id: students.id }).from(students).where(eq(students.username, candidate)).get()) continue;
    used.add(candidate);
    return candidate;
  }
  throw new UserManagementError("Could not generate unique usernames. Please try again.", 503);
}
/**
 * Create a student account, roster row and enrollment for every row of a teacher's CSV.
 * All or nothing: any invalid row or username clash creates nothing and returns every row error.
 * Temporary passwords are returned once and only their hashes are stored.
 */
export async function importStudents(actorId: string, classId: string, csv: string): Promise<{ created: SignInSheetRow[] } | { errors: StudentImportIssue[] }> {
  const parsed = parseStudentCsv(csv);
  const db = await getDb();
  const plan = db.transaction((tx) => {
    authorize(tx, actorId, classId);
    const requested = parsed.rows.flatMap((row) => row.username ? [row.username] : []);
    const taken = new Set(requested.length ? tx.select({ username: students.username }).from(students).where(inArray(students.username, requested)).all().map((row) => row.username) : []);
    const errors = [...parsed.errors, ...parsed.rows.filter((row) => row.username && taken.has(row.username))
      .map((row) => ({ line: row.line, message: `The username "${row.username}" is already taken. Choose another or leave it blank to generate one.` }))];
    if (errors.length) return { errors: errors.sort((a, b) => a.line - b.line) };
    const used = new Set(requested);
    return { rows: parsed.rows.map((row) => ({ displayName: row.displayName, username: row.username ?? generateUsername(tx, row.displayName, used) })) };
  });
  if (plan.errors) return { errors: plan.errors };
  // scrypt is deliberately slow: hash outside the write transaction, off the main thread.
  const accounts = await Promise.all(plan.rows.map(async (row) => {
    const temporaryPassword = generateTemporaryPassword();
    return { ...row, temporaryPassword, passwordHash: await hashPasswordAsync(temporaryPassword) };
  }));
  db.transaction((tx) => {
    authorize(tx, actorId, classId);
    for (const account of accounts) {
      const id = crypto.randomUUID();
      const created = tx.insert(students).values({ id, username: account.username, displayName: account.displayName, passwordHash: account.passwordHash, mustChangePassword: true })
        .onConflictDoNothing({ target: students.username }).returning({ id: students.id }).get();
      if (!created) throw new UserManagementError(`The username "${account.username}" was taken during the upload. Nothing was created; upload the file again.`, 409);
      const rosterId = crypto.randomUUID();
      tx.insert(classStudents).values({ id: rosterId, classId, displayName: account.displayName, tokenHash: hashSessionToken(createSessionToken()) }).run();
      tx.insert(studentClassEnrollments).values({ id: crypto.randomUUID(), studentId: id, classId, classStudentId: rosterId }).run();
      tx.insert(userAuditEvents).values({ id: crypto.randomUUID(), actorId, targetId: id, targetType: "student", action: "student-provisioned", detailsJson: JSON.stringify({ classId }) }).run();
    }
  });
  return { created: accounts.map(({ displayName, username, temporaryPassword }) => ({ displayName, username, temporaryPassword })) };
}

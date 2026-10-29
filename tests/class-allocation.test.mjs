import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { and, count, eq } from "drizzle-orm";

const dir = mkdtempSync(path.join(os.tmpdir(), "bangla-class-allocation-"));
process.env.DATABASE_PATH = path.join(dir, "allocation.db");
const { getDb } = await import("../db/index.ts");
const { adults, students, classes, classStudents, studentClassEnrollments, userAuditEvents } = await import("../db/schema.ts");
const { allocateStudents, availableStudents, removeAllocation, AVAILABLE_STUDENTS_LIMIT, MAX_BULK_ALLOCATION } = await import("../lib/enrollments.ts");
const db = await getDb();
db.insert(adults).values([
  { id: "teacher-a", email: "a@example.com", displayName: "Teacher A", passwordHash: "fixture", role: "teacher", teacherStatus: "approved" },
  { id: "teacher-b", email: "b@example.com", displayName: "Teacher B", passwordHash: "fixture", role: "teacher", teacherStatus: "approved" },
  { id: "pending-teacher", email: "p@example.com", displayName: "Pending", passwordHash: "fixture", teacherStatus: "pending" },
  { id: "admin", email: "admin@example.com", displayName: "Admin", passwordHash: "fixture", role: "admin" },
]).run();
db.insert(classes).values([
  { id: "class-a", teacherId: "teacher-a", name: "Class A", joinCode: "AAA234" },
  { id: "class-b", teacherId: "teacher-b", name: "Class B", joinCode: "BBB234" },
]).run();
db.insert(students).values([
  { id: "maya", username: "maya.r", displayName: "Maya Rahman", passwordHash: "fixture" },
  { id: "arif", username: "arif.h", displayName: "arif Hossain", passwordHash: "fixture" },
  { id: "nadia", username: "nadia_100", displayName: "Nadia Islam", passwordHash: "fixture" },
  { id: "bangla", username: "student1234", displayName: "মায়া", passwordHash: "fixture" },
  { id: "in-b", username: "zara.b", displayName: "Zara in B", passwordHash: "fixture" },
  { id: "pending", username: "pending.kid", displayName: "Pending Kid", passwordHash: "fixture", approvalStatus: "pending" },
  { id: "declined", username: "declined.kid", displayName: "Declined Kid", passwordHash: "fixture", approvalStatus: "declined" },
  { id: "suspended", username: "suspended.kid", displayName: "Suspended Kid", passwordHash: "fixture", status: "suspended" },
  { id: "member", username: "member.a", displayName: "Member of A", passwordHash: "fixture" },
  { id: "removed", username: "removed.a", displayName: "Removed from A", passwordHash: "fixture" },
]).run();
for (const [student, classId, active] of [["in-b", "class-b", true], ["member", "class-a", true], ["removed", "class-a", false]]) {
  db.insert(classStudents).values({ id: `roster-${student}`, classId, displayName: student, tokenHash: `token-${student}` }).run();
  db.insert(studentClassEnrollments).values({ id: `enrollment-${student}`, studentId: student, classId, classStudentId: `roster-${student}`, active }).run();
}
after(() => rmSync(dir, { recursive: true, force: true }));

const usernames = (result) => result.students.map((student) => student.username);
const allocations = (classId) => db.select({ studentId: studentClassEnrollments.studentId, active: studentClassEnrollments.active }).from(studentClassEnrollments).where(eq(studentClassEnrollments.classId, classId)).all();

test("a teacher sees every active, approved student not in the class, A–Z, names and usernames only", async () => {
  const result = await availableStudents("teacher-a", "class-a");
  assert.deepEqual(usernames(result), ["arif.h", "maya.r", "nadia_100", "removed.a", "zara.b", "student1234"], "students from other classes too; a removed student can be added again");
  assert.equal(result.more, false);
  assert.deepEqual(Object.keys(result.students[0]).sort(), ["displayName", "id", "username"], "no status, parents or records");
  for (const hidden of ["pending.kid", "declined.kid", "suspended.kid", "member.a"]) assert.ok(!usernames(result).includes(hidden), hidden);
  assert.deepEqual(usernames(await availableStudents("admin", "class-b")), ["arif.h", "maya.r", "member.a", "nadia_100", "removed.a", "student1234"], "administrators search for any class");
});

test("search matches part of a name or username, ignores case and treats wildcards literally", async () => {
  assert.deepEqual(usernames(await availableStudents("teacher-a", "class-a", "  MAYA ")), ["maya.r"]);
  assert.deepEqual(usernames(await availableStudents("teacher-a", "class-a", "hossain")), ["arif.h"]);
  assert.deepEqual(usernames(await availableStudents("teacher-a", "class-a", "ARIF.")), ["arif.h"]);
  assert.deepEqual(usernames(await availableStudents("teacher-a", "class-a", "মায়া")), ["student1234"]);
  assert.deepEqual(usernames(await availableStudents("teacher-a", "class-a", "_1")), ["nadia_100"], "_ is not a single-character wildcard");
  assert.deepEqual(usernames(await availableStudents("teacher-a", "class-a", "%")), [], "% is not a wildcard");
  assert.deepEqual(usernames(await availableStudents("teacher-a", "class-a", "pending")), [], "waiting accounts are never listed");
});

test("the list is limited and says when more students match", async () => {
  db.insert(students).values(Array.from({ length: AVAILABLE_STUDENTS_LIMIT + 5 }, (_, index) => ({ id: `bulk-${index}`, username: `bulk.${String(index).padStart(3, "0")}`, displayName: `Bulk ${String(index).padStart(3, "0")}`, passwordHash: "fixture" }))).run();
  const all = await availableStudents("teacher-a", "class-a", "bulk");
  assert.equal(all.students.length, AVAILABLE_STUDENTS_LIMIT);
  assert.equal(all.more, true);
  assert.equal(all.students[0].username, "bulk.000");
  const narrow = await availableStudents("teacher-a", "class-a", "bulk.05");
  assert.deepEqual(usernames(narrow), ["bulk.050", "bulk.051", "bulk.052", "bulk.053", "bulk.054"]);
  assert.equal(narrow.more, false);
});

test("only the class's teacher or an administrator may search or allocate for it", async () => {
  await assert.rejects(availableStudents("teacher-a", "class-b"), (error) => error.status === 404 && error.messageBn === "ক্লাসটি পাওয়া যায়নি।");
  await assert.rejects(availableStudents("pending-teacher", "class-a"), (error) => error.status === 403);
  await assert.rejects(allocateStudents("teacher-a", "class-b", ["maya"]), (error) => error.status === 404);
  await assert.rejects(allocateStudents("pending-teacher", "class-a", ["maya"]), (error) => error.status === 403);
  assert.deepEqual(allocations("class-b"), [{ studentId: "in-b", active: true }]);
});

test("ticked students are allocated together and each allocation is audited", async () => {
  const result = await allocateStudents("teacher-a", "class-a", ["maya", "arif", "removed", "member", "maya"]);
  assert.deepEqual(result, { allocated: 3, alreadyAllocated: 1 });
  assert.deepEqual(allocations("class-a").filter((row) => row.active).map((row) => row.studentId).sort(), ["arif", "maya", "member", "removed"]);
  assert.equal(db.select({ n: count() }).from(classStudents).where(eq(classStudents.classId, "class-a")).get().n, 4, "a removed student keeps their roster row");
  const audit = db.select().from(userAuditEvents).where(eq(userAuditEvents.action, "class-allocated")).all();
  assert.deepEqual(audit.map((event) => [event.actorId, event.targetId, JSON.parse(event.detailsJson).classId]).sort(), [["teacher-a", "arif", "class-a"], ["teacher-a", "maya", "class-a"], ["teacher-a", "removed", "class-a"]]);
  assert.ok(!usernames(await availableStudents("teacher-a", "class-a", "maya")).length, "allocated students leave the list");
  await removeAllocation("teacher-a", "class-a", "maya");
  assert.deepEqual(usernames(await availableStudents("teacher-a", "class-a", "maya")), ["maya.r"]);
});

test("a selection that includes a student who cannot be added allocates nobody", async () => {
  const before = allocations("class-a");
  for (const id of ["suspended", "pending", "declined", "no-such-student"]) {
    await assert.rejects(allocateStudents("teacher-a", "class-a", ["nadia", id]), (error) => error.status === 409 && /no longer be added/.test(error.message), id);
  }
  await assert.rejects(allocateStudents("teacher-a", "class-a", []), (error) => error.status === 400);
  await assert.rejects(allocateStudents("teacher-a", "class-a", Array.from({ length: MAX_BULK_ALLOCATION + 1 }, (_, index) => `bulk-${index}`)), (error) => error.status === 400);
  assert.deepEqual(allocations("class-a"), before);
  assert.equal(db.select({ n: count() }).from(studentClassEnrollments).where(and(eq(studentClassEnrollments.studentId, "nadia"))).get().n, 0);
  assert.deepEqual(await allocateStudents("admin", "class-b", ["nadia"]), { allocated: 1, alreadyAllocated: 0 }, "administrators allocate into any class");
});

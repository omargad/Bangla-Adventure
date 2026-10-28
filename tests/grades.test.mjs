import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(path.join(os.tmpdir(), "bangla-grades-test-"));
process.env.DATABASE_PATH = path.join(dir, "grades.db");
const { getDb } = await import("../db/index.ts");
const { adults, students, classes, classStudents, studentClassEnrollments, classActivities, activitySubmissions, userAuditEvents } = await import("../db/schema.ts");
const { listClassResults, resetSubmission } = await import("../lib/grades.ts");
const db = await getDb();
const admin = { id: "admin", role: "admin", status: "active", teacherStatus: "none" };
const teacherA = { id: "teacher-a", role: "teacher", status: "active", teacherStatus: "approved" };
const teacherB = { id: "teacher-b", role: "teacher", status: "active", teacherStatus: "approved" };
db.insert(adults).values([
  { ...admin, email: "admin@example.com", displayName: "Admin", passwordHash: "test-only" },
  { ...teacherA, email: "a@example.com", displayName: "Teacher A", passwordHash: "test-only" },
  { ...teacherB, email: "b@example.com", displayName: "Teacher B", passwordHash: "test-only" },
]).run();
db.insert(students).values([
  { id: "child-a", username: "child-a", displayName: "Maya", passwordHash: "test-only" },
  { id: "child-b", username: "child-b", displayName: "Arif", passwordHash: "test-only" },
]).run();
db.insert(classes).values([
  { id: "class-a", teacherId: "teacher-a", name: "Sunday Class", joinCode: "ABC234", createdAt: "2026-01-01 09:00:00" },
  { id: "class-b", teacherId: "teacher-b", name: "Monday Class", joinCode: "DEF567", createdAt: "2026-02-01 09:00:00" },
  { id: "class-empty", teacherId: "teacher-b", name: "New Class", joinCode: "GHJ789", createdAt: "2026-03-01 09:00:00" },
]).run();
db.insert(classStudents).values([
  { id: "roster-a", classId: "class-a", displayName: "Maya", tokenHash: "secret-a" },
  { id: "roster-legacy", classId: "class-a", displayName: "Old class-code learner", tokenHash: "secret-legacy" },
  { id: "roster-b", classId: "class-b", displayName: "Arif", tokenHash: "secret-b" },
]).run();
db.insert(studentClassEnrollments).values([
  { id: "enrollment-a", studentId: "child-a", classId: "class-a", classStudentId: "roster-a" },
  { id: "enrollment-b", studentId: "child-b", classId: "class-b", classStudentId: "roster-b" },
]).run();
db.insert(classActivities).values([
  { id: "quiz-1", classId: "class-a", title: "Festival quiz" },
  { id: "quiz-2", classId: "class-a", title: "Numbers quiz" },
  { id: "quiz-b", classId: "class-b", title: "Alphabet quiz" },
]).run();
db.insert(activitySubmissions).values([
  { id: "s1", activityId: "quiz-1", studentId: "roster-a", score: 1, total: 2 },
  { id: "s2", activityId: "quiz-2", studentId: "roster-a", score: 3, total: 3 },
  { id: "s-legacy", activityId: "quiz-1", studentId: "roster-legacy", score: 0, total: 2 },
  { id: "sb", activityId: "quiz-b", studentId: "roster-b", score: 2, total: 4 },
]).run();
after(() => rmSync(dir, { recursive: true, force: true }));

const submissionExists = (id) => Boolean(db.select().from(activitySubmissions).where(eq(activitySubmissions.id, id)).get());
const resetAudits = () => db.select().from(userAuditEvents).where(eq(userAuditEvents.action, "submission-reset")).all();

test("the administrator listing covers every class with its teacher, counts and a score-weighted average", async () => {
  const listing = await listClassResults();
  assert.deepEqual(listing.map((item) => item.id), ["class-empty", "class-b", "class-a"], "newest first");
  const byId = Object.fromEntries(listing.map((item) => [item.id, item]));
  assert.deepEqual(
    { ...byId["class-a"], createdAt: undefined },
    { id: "class-a", name: "Sunday Class", createdAt: undefined, teacherName: "Teacher A", teacherEmail: "a@example.com", studentCount: 2, activityCount: 2, submissionCount: 3, averagePercent: 57 },
    "4 of 7 marks, not the 50% mean of per-quiz percentages",
  );
  assert.equal(byId["class-b"].teacherName, "Teacher B");
  assert.equal(byId["class-b"].averagePercent, 50);
  assert.equal(byId["class-empty"].submissionCount, 0);
  assert.equal(byId["class-empty"].studentCount, 0);
  assert.equal(byId["class-empty"].averagePercent, null, "no submissions is not 0%");
  assert.ok(!JSON.stringify(listing).includes("test-only"), "no password hashes");
});

test("teachers reset submissions only in their own classes", async () => {
  assert.equal(await resetSubmission(teacherB, "class-a", "s1"), false, "another teacher's class");
  assert.equal(await resetSubmission(teacherB, "class-b", "s1"), false, "a submission from a different class");
  assert.ok(submissionExists("s1"));
  assert.equal(await resetSubmission(teacherA, "class-a", "s1"), true);
  assert.ok(!submissionExists("s1"));
  assert.equal(await resetSubmission(teacherA, "class-a", "s1"), false, "already reset");
});

test("administrators reset submissions in any class and every reset is audited", async () => {
  assert.equal(await resetSubmission(admin, "class-a", "sb"), false, "the class must match the submission");
  assert.ok(submissionExists("sb"));
  assert.equal(await resetSubmission(admin, "class-b", "sb"), true);
  assert.ok(!submissionExists("sb"));
  assert.equal(await resetSubmission(admin, "class-a", "s-legacy"), true);
  const audits = resetAudits();
  assert.equal(audits.length, 2, "only the administrator's resets");
  const [account, legacy] = ["sb", "s-legacy"].map((id) => audits.find((event) => JSON.parse(event.detailsJson).submissionId === id));
  assert.equal(account.actorId, "admin");
  assert.equal(account.targetType, "student");
  assert.equal(account.targetId, "child-b");
  assert.deepEqual(JSON.parse(account.detailsJson), { classId: "class-b", submissionId: "sb" });
  assert.equal(legacy.targetType, "class-student", "a learner without an account is identified by the roster row");
  assert.equal(legacy.targetId, "roster-legacy");
  assert.deepEqual(JSON.parse(legacy.detailsJson), { classId: "class-a", submissionId: "s-legacy" });

  const listing = Object.fromEntries((await listClassResults()).map((item) => [item.id, item]));
  assert.equal(listing["class-a"].submissionCount, 1);
  assert.equal(listing["class-a"].averagePercent, 100);
  assert.equal(listing["class-b"].averagePercent, null);
});

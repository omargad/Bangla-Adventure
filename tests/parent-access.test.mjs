import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(path.join(os.tmpdir(), "bangla-parent-test-"));
process.env.DATABASE_PATH = path.join(dir, "test.db");
const { getDb } = await import("../db/index.ts");
const { adults, students, classes, classStudents, studentClassEnrollments, classActivities, activitySubmissions, userAuditEvents } = await import("../db/schema.ts");
const { getParentOverview, linkParent, listParents, unlinkParent } = await import("../lib/parent-access.ts");
const db = await getDb();
db.insert(adults).values([
  { id: "admin", email: "admin@example.com", displayName: "Admin", passwordHash: "test-only", role: "admin" },
  { id: "parent-a", email: "a@example.com", displayName: "Parent A", passwordHash: "test-only" },
  { id: "parent-b", email: "b@example.com", displayName: "Parent B", passwordHash: "test-only" },
  { id: "teacher", email: "teacher@example.com", displayName: "Teacher", passwordHash: "test-only", role: "teacher", teacherStatus: "approved" },
]).run();
db.insert(students).values([
  { id: "child-a", username: "child-a", displayName: "Maya", passwordHash: "test-only" },
  { id: "child-b", username: "child-b", displayName: "Maya", passwordHash: "test-only" },
]).run();
db.insert(classes).values({ id: "class", teacherId: "teacher", name: "Sunday Class", joinCode: "ABC234" }).run();
for (const suffix of ["a", "b"]) {
  db.insert(classStudents).values({ id: `roster-${suffix}`, classId: "class", displayName: "Maya", tokenHash: `secret-${suffix}` }).run();
  db.insert(studentClassEnrollments).values({ id: `enrollment-${suffix}`, studentId: `child-${suffix}`, classId: "class", classStudentId: `roster-${suffix}` }).run();
}
db.insert(classActivities).values([
  { id: "quiz", classId: "class", title: "Festival quiz", questionsJson: '[{"answer":1}]' },
  { id: "pending", classId: "class", title: "Reading task" },
]).run();
db.insert(activitySubmissions).values([
  { id: "result-a", activityId: "quiz", studentId: "roster-a", answersJson: "[1,0]", score: 1, total: 2 },
  { id: "result-b", activityId: "quiz", studentId: "roster-b", answersJson: "[1,1]", score: 2, total: 2 },
]).run();
after(() => rmSync(dir, { recursive: true, force: true }));

test("parents start with no access and cannot claim children by name or username", async () => {
  assert.deepEqual((await getParentOverview("parent-a")).children, []);
  await assert.rejects(linkParent("parent-a", "child-a", "a@example.com"), /Administrator/);
  await assert.rejects(linkParent("teacher", "child-a", "a@example.com"), /Administrator/);
  await assert.rejects(listParents("parent-a", "child-a"), /Administrator/);
});

test("administrator linking is idempotent and audited", async () => {
  await linkParent("admin", "child-a", " A@EXAMPLE.COM ");
  await linkParent("admin", "child-a", "a@example.com");
  const links = await listParents("admin", "child-a");
  assert.equal(links.length, 1);
  assert.equal(links[0].parentEmail, "a@example.com");
  assert.equal(db.select().from(userAuditEvents).where(eq(userAuditEvents.action, "parent-linked")).all().length, 1);
});

test("parent sees only their child’s grades, even when another learner has the same name and class", async () => {
  const data = await getParentOverview("parent-a");
  assert.equal(data.children.length, 1);
  assert.equal(data.children[0].id, "child-a");
  assert.equal(data.children[0].metrics.completedActivities, 1);
  assert.equal(data.children[0].metrics.assignedActivities, 2);
  assert.equal(data.children[0].metrics.averagePercent, 50);
  const quiz = data.children[0].classes[0].activities.find((activity) => activity.id === "quiz");
  assert.equal(quiz.submission.score, 1);
  const json = JSON.stringify(data);
  for (const forbidden of ["child-b", "passwordHash", "tokenHash", "joinCode", "answersJson", "questionsJson", '"answer"']) assert.ok(!json.includes(forbidden), forbidden);
  assert.deepEqual((await getParentOverview("parent-b")).children, []);
});

test("several children and verified guardians can be linked without exposing sibling relationships", async () => {
  await linkParent("admin", "child-b", "a@example.com");
  await linkParent("admin", "child-b", "b@example.com");
  assert.equal((await getParentOverview("parent-a")).children.length, 2);
  assert.deepEqual((await getParentOverview("parent-b")).children.map((child) => child.id), ["child-b"]);
});

test("non-parent and suspended accounts cannot use parent monitoring", async () => {
  await assert.rejects(getParentOverview("teacher"), /Parent/);
  db.update(adults).set({ status: "suspended" }).where(eq(adults.id, "parent-b")).run();
  await assert.rejects(getParentOverview("parent-b"), /Parent/);
  await assert.rejects(linkParent("admin", "child-a", "b@example.com"), /active parent/);
  await assert.rejects(linkParent("admin", "child-a", "teacher@example.com"), /active parent/);
  db.update(adults).set({ status: "active" }).where(eq(adults.id, "parent-b")).run();
});

test("a child account no administrator has approved cannot be linked to a family", async () => {
  db.insert(students).values([
    { id: "child-waiting", username: "child-waiting", displayName: "Waiting", passwordHash: "test-only", approvalStatus: "pending" },
    { id: "child-declined", username: "child-declined", displayName: "Declined", passwordHash: "test-only", approvalStatus: "declined" },
  ]).run();
  for (const id of ["child-waiting", "child-declined"]) {
    await assert.rejects(linkParent("admin", id, "a@example.com"), (error) => error.status === 409 && /Approve this student/.test(error.message));
    assert.deepEqual(await listParents("admin", id), []);
  }
  await assert.rejects(linkParent("admin", "missing-child", "a@example.com"), (error) => error.status === 404);
  assert.ok(!(await getParentOverview("parent-a")).children.some((child) => child.id.startsWith("child-waiting") || child.id === "child-declined"));
});

test("only administration can unlink and revoked links stop exposing data immediately", async () => {
  await assert.rejects(unlinkParent("parent-a", "child-a", "parent-a"), /Administrator/);
  await unlinkParent("admin", "child-a", "parent-a");
  assert.deepEqual((await getParentOverview("parent-a")).children.map((child) => child.id), ["child-b"]);
  assert.ok(db.select().from(students).where(eq(students.id, "child-a")).get());
});

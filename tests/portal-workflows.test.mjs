import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(path.join(tmpdir(), "bangla-workflows-"));
process.env.DATABASE_PATH = path.join(dir, "test.db");
const { getDb } = await import("../db/index.ts");
const { adults, students, classes, studentClassEnrollments, classStudents, activitySubmissions, classActivities } = await import("../db/schema.ts");
const { allocateStudent, removeAllocation, roster } = await import("../lib/enrollments.ts");
const { getCatalog, submitTopicEdit, reviewTopicVersion } = await import("../lib/curriculum-catalog.ts");
const { validateTopicDraft } = await import("../lib/topic-model.ts");
const db = await getDb();
db.insert(adults).values([
  { id: "admin", email: "admin@example.com", displayName: "Admin", role: "admin", passwordHash: "fixture" },
  { id: "teacher", email: "teacher@example.com", displayName: "Teacher", role: "teacher", teacherStatus: "approved", passwordHash: "fixture" },
  { id: "other", email: "other@example.com", displayName: "Other", role: "teacher", teacherStatus: "approved", passwordHash: "fixture" },
  { id: "parent", email: "parent@example.com", displayName: "Parent", passwordHash: "fixture" },
]).run();
db.insert(students).values({ id: "student", username: "learner", displayName: "Learner", passwordHash: "fixture" }).run();
db.insert(classes).values({ id: "class", teacherId: "teacher", name: "Class", joinCode: "ABC234" }).run();
after(() => rmSync(dir, { recursive: true, force: true }));

test("only the owner teacher or administrator can allocate; duplicates do not create extra pupils", async () => {
  await assert.rejects(allocateStudent("parent", "class", "learner"), /teacher access/);
  await assert.rejects(allocateStudent("other", "class", "learner"), /not found/);
  await assert.rejects(allocateStudent("teacher", "class", ""), /username/);
  await assert.rejects(allocateStudent("teacher", "class", "missing"), /No active student/);
  await allocateStudent("teacher", "class", "LEARNER");
  await allocateStudent("admin", "class", "learner");
  assert.equal((await roster("teacher", "class")).length, 1);
  assert.equal(db.select().from(classStudents).all().length, 1);
});
test("removing and restoring allocation preserves submitted work", async () => {
  const enrollment = db.select().from(studentClassEnrollments).get();
  db.insert(classActivities).values({ id: "quiz", classId: "class", title: "Quiz" }).run();
  db.insert(activitySubmissions).values({ id: "result", activityId: "quiz", studentId: enrollment.classStudentId, score: 1, total: 1 }).run();
  await removeAllocation("admin", "class", "student");
  assert.deepEqual(await roster("teacher", "class"), [], "a removed student leaves the class list");
  assert.equal(db.select().from(activitySubmissions).all().length, 1);
  await allocateStudent("teacher", "class", "learner");
  assert.equal(db.select().from(studentClassEnrollments).get().classStudentId, enrollment.classStudentId);
  assert.deepEqual((await roster("teacher", "class")).map((row) => row.username), ["learner"], "and comes back when added again");
});
// Teachers now write topics too, and an edit reaches students only once someone approves it.
test("topic edits wait for approval, then reach the catalogue without changing source mappings", async () => {
  const initial = (await getCatalog())[0];
  const edit = { ...initial, title: { ...initial.title, en: "Updated learning title" }, baseVersion: 0 };
  await assert.rejects(submitTopicEdit("parent", initial.id, edit), /teacher or administrator/);
  const saved = await submitTopicEdit("teacher", initial.id, edit);
  assert.equal(saved.version, 1);
  assert.equal((await getCatalog())[0].title.en, initial.title.en, "students keep the approved version");
  await reviewTopicVersion("admin", initial.id, 1, { decision: "approve", confirmedRead: true });
  const current = (await getCatalog())[0];
  assert.equal(current.title.en, edit.title.en);
  assert.deepEqual(current.sources, initial.sources);
  assert.deepEqual(current.quiz, initial.quiz);
  await assert.rejects(submitTopicEdit("admin", initial.id, edit), /Reload it before saving/);
});
test("curriculum validation rejects missing fields and invalid reading time without changing stored content", async () => {
  const current = (await getCatalog())[0];
  for (const edit of [{ ...current, title: { en: "", bn: "বিষয়" } }, { ...current, sections: [] }, { ...current, minutes: 0 }, { ...current, sections: [{ heading: current.title, body: { en: "", bn: "" } }] }]) assert.throws(() => validateTopicDraft(edit));
  assert.equal((await getCatalog())[0].version, 1);
  db.update(adults).set({ status: "suspended" }).where(eq(adults.id, "teacher")).run();
  await assert.rejects(allocateStudent("teacher", "class", "learner"), /teacher access/);
});

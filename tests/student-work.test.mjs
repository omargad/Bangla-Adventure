import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const dir = mkdtempSync(path.join(os.tmpdir(), "bangla-student-work-"));
process.env.DATABASE_PATH = path.join(dir, "student-work.db");
const { getDb } = await import("../db/index.ts");
const { adults, students, classes, classStudents, studentClassEnrollments, classActivities, activitySubmissions } = await import("../db/schema.ts");
const { submitActivityWork, studentResults } = await import("../lib/student-work.ts");
const { resetSubmission } = await import("../lib/grades.ts");
const db = await getDb();
after(() => rmSync(dir, { recursive: true, force: true }));

const teacher = { id: "teacher", role: "teacher", status: "active", teacherStatus: "approved" };
db.insert(adults).values([
  { ...teacher, email: "teacher@example.com", displayName: "Teacher", passwordHash: "test-only" },
  { id: "admin", email: "admin@example.com", displayName: "Admin", role: "admin", passwordHash: "test-only" },
]).run();
db.insert(students).values([
  { id: "maya", username: "maya", displayName: "Maya", passwordHash: "test-only" },
  { id: "eve", username: "eve", displayName: "Eve", passwordHash: "test-only" },
]).run();
db.insert(classes).values([
  { id: "class-a", teacherId: "teacher", name: "Sunday Class", joinCode: "ABC234" },
  { id: "class-b", teacherId: "teacher", name: "Monday Class", joinCode: "DEF567" },
]).run();
db.insert(classStudents).values([
  { id: "roster-maya", classId: "class-a", displayName: "Maya", tokenHash: "t1" },
  { id: "roster-b-only", classId: "class-b", displayName: "Someone in class B", tokenHash: "t2" },
]).run();
db.insert(studentClassEnrollments).values([
  { id: "e-maya", studentId: "maya", classId: "class-a", classStudentId: "roster-maya" },
  // A damaged allocation: Eve is allocated to class A, but the roster row it points at is class B's.
  { id: "e-eve", studentId: "eve", classId: "class-a", classStudentId: "roster-b-only" },
]).run();
const questions = [
  { prompt: "Which month starts the Bengali year?", options: ["Poush", "Boishakh"], answer: 1 },
  { prompt: "What do shops open on Pohela Boishakh?", options: ["Halkhata", "Umbrellas"], answer: 0 },
];
db.insert(classActivities).values([
  { id: "quiz", classId: "class-a", title: "Festival quiz", questionsJson: JSON.stringify(questions), approvalStatus: "approved" },
  { id: "closed-quiz", classId: "class-a", title: "Closed quiz", questionsJson: JSON.stringify(questions), approvalStatus: "approved", status: "closed" },
  { id: "b-quiz", classId: "class-b", title: "Class B quiz", questionsJson: JSON.stringify(questions), approvalStatus: "approved" },
]).run();
const savedSubmission = () => db.select().from(activitySubmissions).all().find((row) => row.activityId === "quiz" && row.studentId === "roster-maya");

test("a submission is final: the second one is refused and the first score stays", async () => {
  const first = await submitActivityWork("maya", "quiz", [0, 0]);
  assert.equal(first.status, 200);
  assert.equal(first.body.score, 1);
  assert.deepEqual(first.body.review.map((item) => [item.picked, item.answer, item.correct]), [[0, 1, false], [0, 0, true]], "answers are shown once the submission is final");

  const again = await submitActivityWork("maya", "quiz", [1, 0]);
  assert.equal(again.status, 409);
  assert.equal(again.body.alreadySubmitted, true);
  assert.match(again.body.error, /already handed in/);
  assert.match(again.body.errorBn, /আগেই জমা দিয়েছ/);
  assert.equal(again.body.review, undefined, "a refused submission reveals no answers");
  assert.deepEqual({ score: again.body.submission.score, total: again.body.submission.total }, { score: 1, total: 2 });
  assert.equal(savedSubmission().score, 1);
  assert.equal(savedSubmission().answersJson, "[0,0]");
  assert.equal((await studentResults("maya")).results.find((item) => item.activityId === "quiz").score, 1);
});

test("after the teacher resets the submission the student can try again", async () => {
  assert.equal(await resetSubmission(teacher, "class-a", savedSubmission().id), true);
  const retry = await submitActivityWork("maya", "quiz", [1, 0]);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.score, 2);
  assert.equal(savedSubmission().score, 2);
});

test("refusals come in English and Bangla", async () => {
  for (const [activityId, answers, status] of [["", [0, 0], 400], ["missing", [0, 0], 404], ["closed-quiz", [0, 0], 409], ["b-quiz", [0, 0], 403], ["quiz", [5], 409]]) {
    const refused = await submitActivityWork("maya", activityId, answers);
    assert.equal(refused.status, status, activityId);
    assert.ok(refused.body.error && refused.body.errorBn, activityId);
  }
  assert.match((await submitActivityWork("maya", "closed-quiz", [0, 0])).body.error, /closed/);
});

test("a roster row from another class never stands in for the allocated class", async () => {
  const refused = await submitActivityWork("eve", "quiz", [1, 0]);
  assert.equal(refused.status, 403);
  assert.equal(db.select().from(activitySubmissions).all().some((row) => row.studentId === "roster-b-only"), false);
  // Work kept against that roster row (class B's) is not shown as Eve's class A result either.
  db.insert(activitySubmissions).values({ id: "stray", activityId: "b-quiz", studentId: "roster-b-only", score: 2, total: 2 }).run();
  assert.deepEqual((await studentResults("eve")).results, []);
});


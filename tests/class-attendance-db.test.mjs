import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { and, eq } from "drizzle-orm";

const dir = mkdtempSync(path.join(os.tmpdir(), "bangla-attendance-test-"));
process.env.DATABASE_PATH = path.join(dir, "attendance.db");
const { getDb } = await import("../db/index.ts");
const { adults, students, classes, classStudents, studentClassEnrollments, classActivities, activitySubmissions, classAttendance, parentStudentLinks } = await import("../db/schema.ts");
const { attendanceSheet, saveAttendance, classAttendanceSummaries, classAttendanceTotals, studentAttendance, attendanceKey } = await import("../lib/class-attendance.ts");
const { removeAllocation, roster } = await import("../lib/enrollments.ts");
const { listClassResults } = await import("../lib/grades.ts");
const { getParentOverview } = await import("../lib/parent-access.ts");
const db = await getDb();
const admin = { id: "admin", role: "admin", status: "active", teacherStatus: "none" };
const teacherA = { id: "teacher-a", role: "teacher", status: "active", teacherStatus: "approved" };
const teacherB = { id: "teacher-b", role: "teacher", status: "active", teacherStatus: "approved" };
db.insert(adults).values([
  { ...admin, email: "admin@example.com", displayName: "Admin", passwordHash: "test-only" },
  { ...teacherA, email: "a@example.com", displayName: "Teacher A", passwordHash: "test-only" },
  { ...teacherB, email: "b@example.com", displayName: "Teacher B", passwordHash: "test-only" },
  { id: "parent", email: "parent@example.com", displayName: "Parent", passwordHash: "test-only" },
]).run();
db.insert(students).values([
  { id: "maya", username: "maya", displayName: "Maya", passwordHash: "test-only" },
  { id: "arif", username: "arif", displayName: "Arif", passwordHash: "test-only" },
  { id: "nadia", username: "nadia", displayName: "Nadia", passwordHash: "test-only" },
]).run();
db.insert(classes).values([
  { id: "class-a", teacherId: "teacher-a", name: "Sunday Class", joinCode: "ABC234" },
  { id: "class-b", teacherId: "teacher-b", name: "Monday Class", joinCode: "DEF567" },
]).run();
db.insert(classStudents).values([
  { id: "roster-maya", classId: "class-a", displayName: "Maya", tokenHash: "t1" },
  { id: "roster-arif", classId: "class-a", displayName: "Arif", tokenHash: "t2" },
  { id: "roster-nadia", classId: "class-a", displayName: "Nadia", tokenHash: "t3" },
  { id: "roster-legacy", classId: "class-a", displayName: "Class-code learner", tokenHash: "t4" },
  { id: "roster-maya-b", classId: "class-b", displayName: "Maya", tokenHash: "t5" },
]).run();
db.insert(studentClassEnrollments).values([
  { id: "e1", studentId: "maya", classId: "class-a", classStudentId: "roster-maya" },
  { id: "e2", studentId: "arif", classId: "class-a", classStudentId: "roster-arif" },
  { id: "e3", studentId: "nadia", classId: "class-a", classStudentId: "roster-nadia" },
  { id: "e4", studentId: "maya", classId: "class-b", classStudentId: "roster-maya-b" },
]).run();
db.insert(classActivities).values([{ id: "quiz", classId: "class-a", title: "Festival quiz" }]).run();
db.insert(activitySubmissions).values([
  { id: "s-maya", activityId: "quiz", studentId: "roster-maya", score: 1, total: 2 },
  { id: "s-nadia", activityId: "quiz", studentId: "roster-nadia", score: 2, total: 2 },
]).run();
db.insert(parentStudentLinks).values([{ id: "link", parentId: "parent", studentId: "maya" }]).run();
after(() => rmSync(dir, { recursive: true, force: true }));

const marks = (absent = []) => ["arif", "maya", "nadia"].map((studentId) => ({ studentId, present: !absent.includes(studentId) }));
const stored = (date) => db.select().from(classAttendance).where(and(eq(classAttendance.classId, "class-a"), eq(classAttendance.sessionDate, date))).all();

test("a new date lists every allocated student A–Z, ticked present, with nothing saved", async () => {
  const sheet = await attendanceSheet(teacherA, "class-a", "2026-10-21");
  assert.equal(sheet.saved, null);
  assert.deepEqual(sheet.sessions, []);
  assert.deepEqual(sheet.students.map((student) => [student.displayName, student.present, student.saved]), [["Arif", true, false], ["Maya", true, false], ["Nadia", true, false]], "a class-code learner without an account is not on the sheet");
  assert.deepEqual(sheet.students[0].attendance, { attended: 0, recorded: 0 });
});

test("saving marks the unticked student absent, and saving the date again updates it in place", async () => {
  assert.deepEqual(await saveAttendance(teacherA, "class-a", "2026-10-21", marks(["arif"])), { date: "2026-10-21", saved: 3, present: 2 });
  let sheet = await attendanceSheet(teacherA, "class-a", "2026-10-21");
  assert.deepEqual(sheet.students.map((student) => [student.studentId, student.present, student.saved]), [["arif", false, true], ["maya", true, true], ["nadia", true, true]]);
  assert.equal(sheet.saved.recordedBy, "Teacher A");
  assert.match(sheet.saved.recordedAt, /^\d{4}-\d{2}-\d{2}T/);
  const firstSave = sheet.saved.recordedAt;

  await saveAttendance(admin, "class-a", "2026-10-21", marks(["maya"]));
  assert.equal(stored("2026-10-21").length, 3, "one mark per student per date, never duplicated");
  sheet = await attendanceSheet(teacherA, "class-a", "2026-10-21");
  assert.deepEqual(sheet.students.map((student) => student.present), [true, false, true]);
  assert.equal(sheet.saved.recordedBy, "Admin", "an administrator can take attendance in any class");
  assert.ok(sheet.saved.recordedAt >= firstSave);
  assert.ok(stored("2026-10-21").every((row) => row.recordedBy === "admin"));

  await saveAttendance(teacherA, "class-a", "2026-10-28", marks(["arif"]));
  sheet = await attendanceSheet(teacherA, "class-a", "2026-10-28");
  assert.deepEqual(sheet.sessions, [{ date: "2026-10-28", present: 2, marked: 3 }, { date: "2026-10-21", present: 2, marked: 3 }]);
  assert.deepEqual(Object.fromEntries(sheet.students.map((student) => [student.studentId, student.attendance])), {
    arif: { attended: 1, recorded: 2 }, maya: { attended: 1, recorded: 2 }, nadia: { attended: 2, recorded: 2 },
  });
});

test("a teacher cannot read or write another teacher's class attendance", async () => {
  await assert.rejects(attendanceSheet(teacherB, "class-a", "2026-10-21"), (error) => error.status === 404 && error.messageBn === "ক্লাসটি পাওয়া যায়নি।");
  await assert.rejects(saveAttendance(teacherB, "class-a", "2026-10-29", marks()), (error) => error.status === 404);
  await assert.rejects(saveAttendance({ ...admin, status: "suspended" }, "class-a", "2026-10-29", marks()), (error) => error.status === 404, "a suspended administrator is not an administrator");
  assert.equal(stored("2026-10-29").length, 0);
});

test("a save must cover exactly the students now in the class", async () => {
  for (const wrong of [marks().slice(1), [...marks(), { studentId: "stranger", present: true }], [...marks().slice(1), { studentId: "stranger", present: true }]]) {
    await assert.rejects(saveAttendance(teacherA, "class-a", "2026-10-29", wrong), (error) => error.status === 409 && /class list has changed/.test(error.message));
  }
  assert.equal(stored("2026-10-29").length, 0, "a refused save writes nothing");
});

test("a removed student leaves the sheet, roster, counts and averages but keeps their own records", async () => {
  await removeAllocation("teacher-a", "class-a", "nadia");
  const sheet = await attendanceSheet(teacherA, "class-a", "2026-10-28");
  assert.deepEqual(sheet.students.map((student) => student.studentId), ["arif", "maya"]);
  assert.deepEqual(sheet.sessions, [{ date: "2026-10-28", present: 1, marked: 2 }, { date: "2026-10-21", present: 1, marked: 2 }]);
  await assert.rejects(saveAttendance(teacherA, "class-a", "2026-10-29", marks()), (error) => error.status === 409, "nor can they be marked");
  assert.deepEqual((await roster("teacher-a", "class-a")).map((row) => row.displayName), ["Arif", "Class-code learner", "Maya"]);
  assert.equal(classAttendanceSummaries(db, "class-a").has("nadia"), false);
  assert.deepEqual(classAttendanceTotals(db).get("class-a"), { attended: 2, recorded: 4 });

  const listing = (await listClassResults()).find((item) => item.id === "class-a");
  assert.equal(listing.studentCount, 3, "Arif, Maya and the class-code learner");
  assert.equal(listing.submissionCount, 1);
  assert.equal(listing.averagePercent, 50, "Nadia's 2/2 no longer counts");
  assert.equal(listing.attendancePercent, 50);
  assert.equal((await listClassResults()).find((item) => item.id === "class-b").attendancePercent, null);
  assert.equal(db.select().from(classAttendance).where(eq(classAttendance.studentId, "nadia")).all().length, 2, "her marks are kept");
  assert.ok(db.select().from(activitySubmissions).where(eq(activitySubmissions.id, "s-nadia")).get(), "and her work");
});

test("parents and students see attended-of-recorded per class for linked, allocated classes only", async () => {
  const [child] = (await getParentOverview("parent")).children;
  const byClass = Object.fromEntries(child.classes.map((item) => [item.id, item.attendance]));
  assert.deepEqual(byClass, { "class-a": { attended: 1, recorded: 2 }, "class-b": { attended: 0, recorded: 0 } });
  assert.equal(child.metrics.attendedSessions, 1);
  assert.equal(child.metrics.recordedSessions, 2);
  const own = studentAttendance(db, ["maya"]);
  assert.deepEqual(own.get(attendanceKey("maya", "class-a")), { attended: 1, recorded: 2 });
  assert.equal(own.has(attendanceKey("arif", "class-a")), false, "only the students asked for");
  assert.equal(studentAttendance(db, ["nadia"]).size, 0, "a removed allocation is not reported");
  assert.equal(studentAttendance(db, []).size, 0);
});

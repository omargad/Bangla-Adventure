import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(path.join(os.tmpdir(), "bangla-announcements-test-"));
process.env.DATABASE_PATH = path.join(dir, "test.db");
const { getDb } = await import("../db/index.ts");
const { adults, students, classes, classStudents, studentClassEnrollments, classAnnouncements, parentStudentLinks } = await import("../db/schema.ts");
const { ANNOUNCEMENT_MAX_LENGTH, audiencesFor, isVisibleTo, parseAnnouncement } = await import("../lib/announcements.ts");
const { listAnnouncements } = await import("../lib/class-announcements.ts");
const { getParentOverview } = await import("../lib/parent-access.ts");
after(() => rmSync(dir, { recursive: true, force: true }));

test("students never see parents-only posts and parents never see students-only posts", () => {
  assert.deepEqual(audiencesFor("student"), ["all", "students"]);
  assert.deepEqual(audiencesFor("parent"), ["all", "parents"]);
  assert.deepEqual(["all", "students", "parents"].map((audience) => isVisibleTo(audience, "student")), [true, true, false]);
  assert.deepEqual(["all", "students", "parents"].map((audience) => isVisibleTo(audience, "parent")), [true, false, true]);
  assert.equal(isVisibleTo("teachers", "student"), false);
  assert.equal(isVisibleTo("teachers", "parent"), false);
});

test("a new announcement is trimmed, keeps its line breaks, is for everyone by default and is at most 2000 characters", () => {
  assert.deepEqual(parseAnnouncement({ body: "  Bring a festival photo.\r\nWear red!  " }), { body: "Bring a festival photo.\nWear red!", audience: "all" });
  assert.deepEqual(parseAnnouncement({ body: "Parents' evening is on Friday.", audience: "parents" }), { body: "Parents' evening is on Friday.", audience: "parents" });
  assert.equal(parseAnnouncement({ body: "x".repeat(ANNOUNCEMENT_MAX_LENGTH), audience: "students" }).body.length, 2000);
  for (const payload of [null, "text", {}, { body: "   " }, { body: 42 }]) assert.match(parseAnnouncement(payload).error, /Write the announcement/);
  const tooLong = parseAnnouncement({ body: "x".repeat(ANNOUNCEMENT_MAX_LENGTH + 1) });
  assert.match(tooLong.error, /2000 characters/);
  assert.ok(tooLong.errorBn);
  for (const audience of ["teachers", "", null, 1, ["all"]]) assert.match(parseAnnouncement({ body: "Hello", audience }).error, /Choose who/);
});

const db = await getDb();
db.insert(adults).values([
  { id: "teacher", email: "teacher@example.com", displayName: "Teacher Rahman", passwordHash: "test-only", role: "teacher", teacherStatus: "approved" },
  { id: "admin", email: "admin@example.com", displayName: "Admin Akter", passwordHash: "test-only", role: "admin" },
  { id: "parent", email: "parent@example.com", displayName: "Parent", passwordHash: "test-only" },
  { id: "unlinked", email: "unlinked@example.com", displayName: "Unlinked Parent", passwordHash: "test-only" },
]).run();
db.insert(students).values([
  { id: "maya", username: "maya", displayName: "Maya", passwordHash: "test-only" },
  { id: "arif", username: "arif", displayName: "Arif", passwordHash: "test-only" },
  { id: "other", username: "other", displayName: "Other", passwordHash: "test-only" },
]).run();
db.insert(classes).values([
  { id: "sunday", teacherId: "teacher", name: "Sunday Class", joinCode: "SUN234" },
  { id: "monday", teacherId: "teacher", name: "Monday Class", joinCode: "MON234" },
  { id: "left", teacherId: "teacher", name: "Left Class", joinCode: "LEF234" },
]).run();
const enrol = (studentId, classId, active = true) => {
  db.insert(classStudents).values({ id: `roster-${studentId}-${classId}`, classId, displayName: studentId, tokenHash: `token-${studentId}-${classId}` }).run();
  db.insert(studentClassEnrollments).values({ id: `enrol-${studentId}-${classId}`, studentId, classId, classStudentId: `roster-${studentId}-${classId}`, active }).run();
};
enrol("maya", "sunday"); enrol("arif", "sunday"); enrol("arif", "monday"); enrol("other", "monday");
// Maya was removed from Left Class: its posts no longer reach her family.
enrol("maya", "left", false);
db.insert(parentStudentLinks).values([{ id: "link-maya", parentId: "parent", studentId: "maya" }, { id: "link-arif", parentId: "parent", studentId: "arif" }]).run();
db.insert(classAnnouncements).values([
  { id: "everyone", classId: "sunday", body: "Festival day on Sunday.", audience: "all", authorId: "teacher", createdAt: "2026-10-20 09:00:00" },
  { id: "students", classId: "sunday", body: "Read the Pohela Boishakh topic.", audience: "students", authorId: "teacher", createdAt: "2026-10-21 09:00:00" },
  { id: "parents", classId: "sunday", body: "Parents' evening on Friday.", audience: "parents", authorId: "admin", createdAt: "2026-10-22 09:00:00" },
  { id: "old", classId: "monday", body: "Posted by an account that is gone.", audience: "students", createdAt: "2026-10-01 09:00:00" },
  { id: "monday-parents", classId: "monday", body: "Monday pick-up is at 4.", audience: "parents", authorId: "teacher", createdAt: "2026-10-23 09:00:00" },
  { id: "left-all", classId: "left", body: "Left Class news.", audience: "all", authorId: "teacher", createdAt: "2026-10-24 09:00:00" },
]).run();

test("staff see every audience in a class, newest first, with who wrote each post", () => {
  const rows = listAnnouncements(db, ["sunday"]);
  assert.deepEqual(rows.map((row) => [row.id, row.audience, row.authorName]), [["parents", "parents", "Admin Akter"], ["students", "students", "Teacher Rahman"], ["everyone", "all", "Teacher Rahman"]]);
  assert.deepEqual(listAnnouncements(db, []), []);
});

test("a student reader gets everyone and students-only posts; a post with no author on record names no one", () => {
  assert.deepEqual(listAnnouncements(db, ["sunday", "monday"], "student").map((row) => [row.id, row.authorName]), [["students", "Teacher Rahman"], ["everyone", "Teacher Rahman"], ["old", null]]);
});

test("posts written in the same second keep the order they were written in", () => {
  db.insert(classAnnouncements).values([
    { id: "first", classId: "monday", body: "First", audience: "all", authorId: "teacher", createdAt: "2026-10-30 09:00:00" },
    { id: "second", classId: "monday", body: "Second", audience: "all", authorId: "teacher", createdAt: "2026-10-30 09:00:00" },
  ]).run();
  assert.deepEqual(listAnnouncements(db, ["monday"]).slice(0, 2).map((row) => row.id), ["second", "first"]);
  db.delete(classAnnouncements).where(eq(classAnnouncements.classId, "monday")).run();
  db.insert(classAnnouncements).values([
    { id: "old", classId: "monday", body: "Posted by an account that is gone.", audience: "students", createdAt: "2026-10-01 09:00:00" },
    { id: "monday-parents", classId: "monday", body: "Monday pick-up is at 4.", audience: "parents", authorId: "teacher", createdAt: "2026-10-23 09:00:00" },
  ]).run();
});

test("a parent sees everyone and parents-only posts from their linked children's current classes, one entry per post", async () => {
  const { announcements } = await getParentOverview("parent");
  assert.deepEqual(announcements.map((notice) => [notice.id, notice.className, notice.children.map((child) => child.displayName), notice.authorName]), [
    ["monday-parents", "Monday Class", ["Arif"], "Teacher Rahman"],
    ["parents", "Sunday Class", ["Arif", "Maya"], "Admin Akter"],
    ["everyone", "Sunday Class", ["Arif", "Maya"], "Teacher Rahman"],
  ]);
  const json = JSON.stringify(announcements);
  for (const hidden of ["Read the Pohela Boishakh topic.", "Posted by an account that is gone.", "Left Class news.", "Other", "authorId", "teacher@example.com"]) assert.ok(!json.includes(hidden), hidden);
});

test("a parent with no linked children gets no announcements, and unlinking stops them at once", async () => {
  assert.deepEqual((await getParentOverview("unlinked")).announcements, []);
  db.delete(parentStudentLinks).where(eq(parentStudentLinks.id, "link-arif")).run();
  const { announcements } = await getParentOverview("parent");
  assert.deepEqual(announcements.map((notice) => [notice.id, notice.children.map((child) => child.displayName)]), [["parents", ["Maya"]], ["everyone", ["Maya"]]]);
});

test("the retired class-code feed also leaves parents-only posts out and names each author", async () => {
  const { GET } = await import("../app/api/classroom/feed/route.ts");
  const { hashSessionToken } = await import("../lib/password.ts");
  db.insert(classStudents).values({ id: "code-learner", classId: "sunday", displayName: "Code learner", tokenHash: hashSessionToken("class-code-token") }).run();
  const response = await GET(new Request("http://localhost/api/classroom/feed", { headers: { "x-student-token": "class-code-token" } }));
  assert.equal(response.status, 200);
  const { announcements } = await response.json();
  assert.deepEqual(announcements.map((item) => [item.id, item.authorName]), [["students", "Teacher Rahman"], ["everyone", "Teacher Rahman"]]);
});

test("a post whose author's account is deleted stays, but is never credited to whoever teaches the class now", () => {
  // The class moves to another teacher, then the administrator who wrote the parents' note leaves.
  db.insert(adults).values({ id: "bashir", email: "bashir@example.com", displayName: "Teacher Bashir", passwordHash: "test-only", role: "teacher", teacherStatus: "approved" }).run();
  db.update(classes).set({ teacherId: "bashir" }).where(eq(classes.id, "sunday")).run();
  db.delete(adults).where(eq(adults.id, "admin")).run();
  const post = db.select().from(classAnnouncements).where(eq(classAnnouncements.id, "parents")).get();
  assert.equal(post.authorId, null);
  assert.deepEqual(listAnnouncements(db, ["sunday"]).map((row) => [row.id, row.authorName]), [["parents", null], ["students", "Teacher Rahman"], ["everyone", "Teacher Rahman"]]);
});

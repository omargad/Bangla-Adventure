import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(path.join(os.tmpdir(), "bangla-class-access-test-"));
process.env.DATABASE_PATH = path.join(dir, "class-access.db");
const { getDb } = await import("../db/index.ts");
const { adults, classes, classStudents, classActivities, classAnnouncements, activitySubmissions, userAuditEvents } = await import("../db/schema.ts");
const { deleteClass, findManagedClass, managedClass } = await import("../lib/class-access.ts");
const db = await getDb();
const admin = { id: "admin", role: "admin", status: "active", teacherStatus: "none" };
const teacherA = { id: "teacher-a", role: "teacher", status: "active", teacherStatus: "approved" };
const teacherB = { id: "teacher-b", role: "teacher", status: "active", teacherStatus: "approved" };
db.insert(adults).values([
  { ...admin, email: "admin@example.com", displayName: "Admin", passwordHash: "test-only" },
  { ...teacherA, email: "a@example.com", displayName: "Teacher A", passwordHash: "test-only" },
  { ...teacherB, email: "b@example.com", displayName: "Teacher B", passwordHash: "test-only" },
]).run();
db.insert(classes).values([
  { id: "class-a", teacherId: "teacher-a", name: "Sunday Class", joinCode: "ABC234" },
  { id: "class-b", teacherId: "teacher-b", name: "সোমবারের ক্লাস", joinCode: "DEF567" },
]).run();
db.insert(classStudents).values([{ id: "roster-a", classId: "class-a", displayName: "Maya", tokenHash: "secret-a" }]).run();
db.insert(classActivities).values([{ id: "quiz-a", classId: "class-a", title: "Festival quiz" }]).run();
db.insert(classAnnouncements).values([{ id: "note-a", classId: "class-a", body: "Read the Pohela Boishakh topic." }]).run();
db.insert(activitySubmissions).values([{ id: "s1", activityId: "quiz-a", studentId: "roster-a", score: 1, total: 2 }]).run();
after(() => rmSync(dir, { recursive: true, force: true }));

const managedIds = (actor) => db.select({ id: classes.id }).from(classes).where(managedClass(actor, "class-a")).all()
  .concat(db.select({ id: classes.id }).from(classes).where(managedClass(actor, "class-b")).all()).map((row) => row.id);
const deletions = () => db.select().from(userAuditEvents).where(eq(userAuditEvents.action, "class-deleted")).all();
const classExists = (id) => Boolean(db.select().from(classes).where(eq(classes.id, id)).get());

test("administrators manage any class and teachers only the classes they own", async () => {
  assert.deepEqual(managedIds(admin), ["class-a", "class-b"]);
  assert.deepEqual(managedIds(teacherA), ["class-a"]);
  assert.deepEqual(managedIds(teacherB), ["class-b"]);
  assert.deepEqual(managedIds({ ...admin, status: "suspended" }), [], "a suspended administrator is not an administrator");
  assert.deepEqual(managedIds({ ...teacherA, role: "admin", status: "suspended" }), ["class-a"], "and keeps only owner access");
  assert.equal(db.select().from(classes).where(managedClass(admin, "missing")).all().length, 0, "an unknown class matches nothing");

  assert.equal((await findManagedClass(admin, "class-a")).name, "Sunday Class");
  assert.equal((await findManagedClass(teacherA, "class-a")).teacherId, "teacher-a");
  assert.equal(await findManagedClass(teacherB, "class-a"), null);
  assert.equal(await findManagedClass(teacherA, "missing"), null);
});

test("a teacher cannot delete another teacher's class and the refusal is not audited", async () => {
  assert.equal(await deleteClass(teacherB, "class-a"), null);
  assert.equal(await deleteClass(teacherA, "missing"), null);
  assert.ok(classExists("class-a"));
  assert.equal(deletions().length, 0);
});

test("a teacher deletes their own class with its work, and the deletion is audited", async () => {
  const removed = await deleteClass(teacherA, "class-a");
  assert.equal(removed.id, "class-a");
  assert.ok(!classExists("class-a"));
  assert.equal(db.select().from(classActivities).all().length, 0, "activities go with the class");
  assert.equal(db.select().from(classAnnouncements).all().length, 0, "announcements go with the class");
  assert.equal(db.select().from(activitySubmissions).all().length, 0, "submissions go with the class");
  const [audit] = deletions();
  assert.equal(audit.actorId, "teacher-a");
  assert.equal(audit.targetType, "class");
  assert.equal(audit.targetId, "class-a");
  assert.deepEqual(JSON.parse(audit.detailsJson), { classId: "class-a", name: "Sunday Class", teacherId: "teacher-a" });
  assert.equal(await deleteClass(teacherA, "class-a"), null, "already deleted");
  assert.equal(deletions().length, 1);
});

test("an administrator deletes another teacher's class and the audit names the owner", async () => {
  assert.equal((await deleteClass(admin, "class-b")).id, "class-b");
  assert.ok(!classExists("class-b"));
  const audit = deletions().find((event) => event.targetId === "class-b");
  assert.equal(audit.actorId, "admin");
  assert.deepEqual(JSON.parse(audit.detailsJson), { classId: "class-b", name: "সোমবারের ক্লাস", teacherId: "teacher-b" });
  assert.equal(deletions().length, 2);
});

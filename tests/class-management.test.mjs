import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(path.join(os.tmpdir(), "bangla-class-management-test-"));
process.env.DATABASE_PATH = path.join(dir, "classes.db");
const { getDb } = await import("../db/index.ts");
const { adults, classes, classActivities, userAuditEvents } = await import("../db/schema.ts");
const { changeClassTeacher, createClassForTeacher, listTeachers } = await import("../lib/class-management.ts");
const { findManagedClass } = await import("../lib/class-access.ts");
const db = await getDb();
db.insert(adults).values([
  { id: "admin", email: "admin@example.com", displayName: "Admin", passwordHash: "test-only", role: "admin" },
  { id: "rina", email: "rina@example.com", displayName: "Rina", passwordHash: "test-only", role: "teacher", teacherStatus: "approved" },
  { id: "karim", email: "karim@example.com", displayName: "Karim", passwordHash: "test-only", role: "teacher", teacherStatus: "approved" },
  { id: "waiting", email: "waiting@example.com", displayName: "Waiting", passwordHash: "test-only", role: "teacher", teacherStatus: "pending" },
  { id: "suspended", email: "suspended@example.com", displayName: "Suspended", passwordHash: "test-only", role: "teacher", teacherStatus: "approved", status: "suspended" },
  { id: "declined", email: "declined@example.com", displayName: "Declined", passwordHash: "test-only", role: "teacher", teacherStatus: "approved", approvalStatus: "declined" },
  { id: "parent", email: "parent@example.com", displayName: "Parent", passwordHash: "test-only" },
]).run();
after(() => rmSync(dir, { recursive: true, force: true }));

const audits = (action) => db.select().from(userAuditEvents).where(eq(userAuditEvents.action, action)).all();
const staff = (id) => ({ id, role: "teacher", status: "active", teacherStatus: "approved" });
let classId;

test("only approved, active teachers can be chosen, A–Z, and only by an administrator", async () => {
  assert.deepEqual((await listTeachers("admin")).map((teacher) => teacher.id), ["karim", "rina"]);
  assert.ok(!JSON.stringify(await listTeachers("admin")).includes("test-only"), "no password hashes");
  await assert.rejects(listTeachers("rina"), (error) => error.status === 403);
  await assert.rejects(listTeachers("parent"), (error) => error.status === 403);
});

test("an administrator creates a class for a teacher, who then manages it; it is audited", async () => {
  const created = await createClassForTeacher("admin", "  Sunday 11:30  ", "rina");
  classId = created.id;
  assert.equal(created.name, "Sunday 11:30");
  assert.equal(created.teacherId, "rina");
  assert.equal(created.teacherName, "Rina");
  assert.match(created.joinCode, /^[A-Z2-9]{6}$/);
  assert.ok(await findManagedClass(staff("rina"), classId));
  assert.equal(await findManagedClass(staff("karim"), classId), null);
  const [audit] = audits("class-created-for-teacher");
  assert.equal(audit.actorId, "admin");
  assert.equal(audit.targetType, "class");
  assert.equal(audit.targetId, classId);
  assert.deepEqual(JSON.parse(audit.detailsJson), { classId, name: "Sunday 11:30", teacherId: "rina" });
});

test("classes cannot be created for anyone but an approved teacher, nor by anyone but an administrator", async () => {
  for (const teacherId of ["waiting", "suspended", "declined", "parent", "admin", "missing"]) {
    await assert.rejects(createClassForTeacher("admin", "Class", teacherId), (error) => error.status === 404 && error.messageBn === "একজন অনুমোদিত শিক্ষক বেছে নিন।", teacherId);
  }
  await assert.rejects(createClassForTeacher("rina", "Class", "karim"), (error) => error.status === 403);
  for (const name of ["", "   ", "x".repeat(61), 42, undefined]) await assert.rejects(createClassForTeacher("admin", name, "rina"), (error) => error.status === 400);
  assert.equal(db.select().from(classes).all().length, 1);
  assert.equal(audits("class-created-for-teacher").length, 1);
});

test("an administrator gives the class to another teacher: the old teacher loses it, the work stays", async () => {
  db.insert(classActivities).values({ id: "quiz", classId, title: "Festival quiz" }).run();
  await assert.rejects(changeClassTeacher("rina", classId, "karim"), (error) => error.status === 403);
  await assert.rejects(changeClassTeacher("admin", classId, "waiting"), (error) => error.status === 404);
  await assert.rejects(changeClassTeacher("admin", "missing", "karim"), (error) => error.status === 404);
  assert.equal(audits("class-teacher-changed").length, 0, "refusals are not audited");

  const result = await changeClassTeacher("admin", classId, "karim");
  assert.equal(result.changed, true);
  assert.equal(result.class.teacherId, "karim");
  assert.equal(result.class.teacherName, "Karim");
  assert.equal(await findManagedClass(staff("rina"), classId), null, "the previous teacher loses access");
  assert.ok(await findManagedClass(staff("karim"), classId), "the new teacher gains it");
  assert.equal(db.select().from(classActivities).where(eq(classActivities.classId, classId)).all().length, 1, "activities stay with the class");
  const [audit] = audits("class-teacher-changed");
  assert.equal(audit.actorId, "admin");
  assert.deepEqual(JSON.parse(audit.detailsJson), { classId, name: "Sunday 11:30", fromTeacherId: "rina", toTeacherId: "karim" });

  assert.equal((await changeClassTeacher("admin", classId, "karim")).changed, false, "choosing the current teacher changes nothing");
  assert.equal(audits("class-teacher-changed").length, 1);
});

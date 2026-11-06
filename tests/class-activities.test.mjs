import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { eq, sql } from "drizzle-orm";

const dir = mkdtempSync(path.join(os.tmpdir(), "bangla-class-activities-test-"));
process.env.DATABASE_PATH = path.join(dir, "activities.db");
const { getDb } = await import("../db/index.ts");
const { adults, classes, classActivities, userAuditEvents } = await import("../db/schema.ts");
const { ActivityError, changeActivityStatus } = await import("../lib/class-activities.ts");
const db = await getDb();
db.insert(adults).values([
  { id: "admin", email: "admin@example.com", displayName: "Admin", passwordHash: "test-only", role: "admin" },
  { id: "rina", email: "rina@example.com", displayName: "Rina", passwordHash: "test-only", role: "teacher", teacherStatus: "approved" },
  { id: "karim", email: "karim@example.com", displayName: "Karim", passwordHash: "test-only", role: "teacher", teacherStatus: "approved" },
  { id: "suspended", email: "suspended@example.com", displayName: "Suspended", passwordHash: "test-only", role: "teacher", teacherStatus: "approved", status: "suspended" },
  { id: "temporary", email: "temporary@example.com", displayName: "Temporary", passwordHash: "test-only", role: "teacher", teacherStatus: "approved", mustChangePassword: true },
]).run();
db.insert(classes).values([
  { id: "sunday", teacherId: "rina", name: "রবিবার ১১:৩০", joinCode: "SUN234" },
  { id: "temporary-class", teacherId: "temporary", name: "Temporary class", joinCode: "TMP234" },
]).run();
db.insert(classActivities).values([{ id: "quiz", classId: "sunday", title: "Festival quiz", approvalStatus: "approved" }]).run();
after(() => rmSync(dir, { recursive: true, force: true }));

const audits = () => db.select().from(userAuditEvents).where(sql`${userAuditEvents.action} in ('class-activity-opened', 'class-activity-closed')`).orderBy(sql`rowid`).all();
const status = () => db.select({ status: classActivities.status, revision: classActivities.revision }).from(classActivities).where(eq(classActivities.id, "quiz")).get();

test("closing and reopening an activity are audited with the activity title and the class name", async () => {
  assert.equal(status().status, "open");
  const closed = await changeActivityStatus("rina", "sunday", "quiz", "closed");
  assert.equal(closed.status, "closed");
  const reopened = await changeActivityStatus("admin", "sunday", "quiz", "open");
  assert.equal(reopened.status, "open");
  const [close, open] = audits();
  assert.deepEqual([close.action, close.actorId, close.targetType, close.targetId], ["class-activity-closed", "rina", "class", "sunday"]);
  assert.deepEqual([open.action, open.actorId], ["class-activity-opened", "admin"]);
  const label = { en: "রবিবার ১১:৩০", bn: "রবিবার ১১:৩০" };
  assert.deepEqual(JSON.parse(close.detailsJson), { activityId: "quiz", title: "Festival quiz", revision: closed.revision, targetLabel: label });
  assert.deepEqual(JSON.parse(open.detailsJson), { activityId: "quiz", title: "Festival quiz", revision: reopened.revision, targetLabel: label });
});

test("asking for the status an activity already has changes and audits nothing", async () => {
  const before = status();
  assert.equal((await changeActivityStatus("rina", "sunday", "quiz", "open")).status, "open");
  assert.deepEqual(status(), before);
  assert.equal(audits().length, 2);
});

test("only a current manager of the class can open or close its activities, in English and Bangla", async () => {
  const refused = (status, messageBn) => (error) => error instanceof ActivityError && error.status === status && error.messageBn === messageBn;
  await assert.rejects(changeActivityStatus("karim", "sunday", "quiz", "closed"), refused(404, "ক্লাসটি পাওয়া যায়নি।"), "another teacher's class");
  await assert.rejects(changeActivityStatus("suspended", "sunday", "quiz", "closed"), refused(403, "অনুমোদিত শিক্ষক বা প্রশাসকের অ্যাকাউন্ট প্রয়োজন।"));
  await assert.rejects(changeActivityStatus("temporary", "temporary-class", "quiz", "closed"), refused(403, "অনুমোদিত শিক্ষক বা প্রশাসকের অ্যাকাউন্ট প্রয়োজন।"), "a temporary password must be changed first");
  await assert.rejects(changeActivityStatus("rina", "sunday", "missing", "closed"), refused(404, "কার্যক্রমটি পাওয়া যায়নি।"));
  assert.equal(status().status, "open");
  assert.equal(audits().length, 2, "refusals are not audited");
});

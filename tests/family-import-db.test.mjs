import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { and, count, eq } from "drizzle-orm";

const dir = mkdtempSync(path.join(os.tmpdir(), "bangla-family-import-db-"));
process.env.DATABASE_PATH = path.join(dir, "families.db");
const { getDb } = await import("../db/index.ts");
const { adults, students, classes, classStudents, studentClassEnrollments, parentStudentLinks, recoveryCodes, userAuditEvents } = await import("../db/schema.ts");
const { importFamilies } = await import("../lib/families.ts");
const { getParentOverview } = await import("../lib/parent-access.ts");
const { verifyPassword } = await import("../lib/password.ts");
const db = await getDb();
db.insert(adults).values([
  { id: "admin", email: "admin@example.com", displayName: "Admin", passwordHash: "fixture", role: "admin" },
  { id: "teacher", email: "teacher@example.com", displayName: "Teacher", passwordHash: "fixture", role: "teacher", teacherStatus: "approved" },
  { id: "karim", email: "karim@example.com", displayName: "Karim Islam", passwordHash: "karim-own-hash" },
  { id: "suspended", email: "suspended@example.com", displayName: "Sam Suspended", passwordHash: "fixture", status: "suspended" },
  { id: "waiting", email: "waiting@example.com", displayName: "Wendy Waiting", passwordHash: "fixture", approvalStatus: "pending" },
  { id: "declined", email: "declined@example.com", displayName: "Dina Declined", passwordHash: "fixture", approvalStatus: "declined" },
]).run();
db.insert(students).values({ id: "taken", username: "taken.name", displayName: "Taken", passwordHash: "fixture" }).run();
db.insert(classes).values({ id: "class", teacherId: "teacher", name: "Sunday Class", joinCode: "FAM234" }).run();
after(() => rmSync(dir, { recursive: true, force: true }));

const total = (table, where) => db.select({ n: count() }).from(table).where(where).get().n;
const counts = () => ({ adults: total(adults), students: total(students), links: total(parentStudentLinks), enrollments: total(studentClassEnrollments), audit: total(userAuditEvents) });
const header = "student name,parent name,parent email";

test("new parents are created once for siblings, linked, approved and must change their password", async () => {
  const result = await importFamilies("admin", `${header}\nMaya Rahman,Farida Rahman,Farida@Example.com\nArif Rahman,farida rahman,farida@example.com\nমায়া,Salma Begum,salma@example.com\n`);
  assert.ok("families" in result, JSON.stringify(result));
  assert.equal(result.className, null);
  const [maya, arif, mithila] = result.families;
  assert.deepEqual(result.families.map((row) => [row.studentName, row.parentName, row.parentEmail]), [
    ["Maya Rahman", "Farida Rahman", "farida@example.com"], ["Arif Rahman", "Farida Rahman", "farida@example.com"], ["মায়া", "Salma Begum", "salma@example.com"]]);
  assert.match(maya.username, /^maya\.rahman\d{4}$/);
  assert.match(mithila.username, /^student\d{4}$/);
  assert.equal(maya.parentTemporaryPassword, arif.parentTemporaryPassword, "siblings share one parent account");
  assert.notEqual(maya.parentTemporaryPassword, mithila.parentTemporaryPassword);
  for (const row of result.families) {
    assert.match(row.temporaryPassword, /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{2}$/);
    assert.match(row.parentTemporaryPassword, /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{2}$/);
  }

  const farida = db.select().from(adults).where(eq(adults.email, "farida@example.com")).get();
  assert.deepEqual({ role: farida.role, status: farida.status, approvalStatus: farida.approvalStatus, teacherStatus: farida.teacherStatus, mustChangePassword: farida.mustChangePassword, displayName: farida.displayName },
    { role: "parent", status: "active", approvalStatus: "approved", teacherStatus: "none", mustChangePassword: true, displayName: "Farida Rahman" });
  assert.ok(verifyPassword(maya.parentTemporaryPassword, farida.passwordHash));
  assert.equal(total(recoveryCodes, eq(recoveryCodes.adultId, farida.id)), 0, "the parent gets codes of their own at the first password change");
  for (const row of result.families) {
    const student = db.select().from(students).where(eq(students.username, row.username)).get();
    assert.equal(student.approvalStatus, "approved");
    assert.equal(student.mustChangePassword, true);
    assert.ok(verifyPassword(row.temporaryPassword, student.passwordHash));
    const parent = db.select().from(adults).where(eq(adults.email, row.parentEmail)).get();
    assert.equal(total(parentStudentLinks, and(eq(parentStudentLinks.parentId, parent.id), eq(parentStudentLinks.studentId, student.id))), 1);
    assert.equal(total(userAuditEvents, and(eq(userAuditEvents.targetId, student.id), eq(userAuditEvents.action, "parent-linked"))), 1);
    assert.equal(total(studentClassEnrollments, eq(studentClassEnrollments.studentId, student.id)), 0, "no class unless one is chosen");
  }
  assert.equal(total(adults, eq(adults.email, "farida@example.com")), 1);
  const created = db.select().from(userAuditEvents).where(eq(userAuditEvents.targetId, farida.id)).all();
  assert.deepEqual(created.map((event) => [event.actorId, event.action, JSON.parse(event.detailsJson)]), [["admin", "created", { role: "parent", source: "family-import" }]]);
  const everything = JSON.stringify(db.select().from(userAuditEvents).all());
  for (const row of result.families) assert.ok(!everything.includes(row.temporaryPassword) && !everything.includes(row.parentTemporaryPassword), "audit never stores a password");

  const overview = await getParentOverview(farida.id);
  assert.deepEqual(overview.children.map((child) => child.displayName).sort(), ["Arif Rahman", "Maya Rahman"]);
});

test("an existing approved parent with the same name is reused and keeps their password", async () => {
  const before = counts();
  const result = await importFamilies("admin", `Student,Parent,E-mail,Student username\nNadia Islam,KARIM ISLAM,karim@example.com,nadia.islam\nRafi Islam,Karim Islam,karim@example.com,\n`, "class");
  assert.ok("families" in result, JSON.stringify(result));
  assert.equal(result.className, "Sunday Class");
  assert.deepEqual(result.families.map((row) => [row.username.replace(/\d+$/, ""), row.parentName, row.parentTemporaryPassword]), [["nadia.islam", "Karim Islam", null], ["rafi.islam", "Karim Islam", null]]);
  const karim = db.select().from(adults).where(eq(adults.id, "karim")).get();
  assert.equal(karim.passwordHash, "karim-own-hash");
  assert.equal(karim.mustChangePassword, false);
  assert.equal(counts().adults, before.adults, "no new adult");
  assert.deepEqual((await getParentOverview("karim")).children.map((child) => [child.displayName, child.classes.map((item) => item.name)]), [["Nadia Islam", ["Sunday Class"]], ["Rafi Islam", ["Sunday Class"]]]);
  for (const row of result.families) {
    const student = db.select().from(students).where(eq(students.username, row.username)).get();
    const enrollment = db.select().from(studentClassEnrollments).where(eq(studentClassEnrollments.studentId, student.id)).get();
    assert.equal(enrollment.classId, "class");
    assert.equal(enrollment.active, true);
    assert.equal(db.select().from(classStudents).where(eq(classStudents.id, enrollment.classStudentId)).get().displayName, row.studentName);
    assert.equal(total(userAuditEvents, and(eq(userAuditEvents.targetId, student.id), eq(userAuditEvents.action, "class-allocated"))), 1);
  }
});

test("rows whose e-mail cannot be used are refused with their line and nothing is created", async () => {
  const before = counts();
  const result = await importFamilies("admin", [
    header,
    "Fresh Child,Fresh Parent,fresh@example.com",
    "Child One,Teacher,teacher@example.com",
    "Child Two,Admin,ADMIN@example.com",
    "Child Three,Sam Suspended,suspended@example.com",
    "Child Four,Wendy Waiting,waiting@example.com",
    "Child Five,Dina Declined,declined@example.com",
    "Child Six,Kareem Islam,karim@example.com",
    `Child Seven,Fresh Parent,fresh@example.com`,
  ].join("\n") + "\nChild Eight,Fresh Parent,fresh@example.com\n");
  assert.ok("errors" in result);
  assert.deepEqual(result.errors.map((error) => error.line), [3, 4, 5, 6, 7, 8]);
  const messages = result.errors.map((error) => error.message);
  assert.match(messages[0], /"teacher@example\.com" belongs to a teacher or administrator account/);
  assert.match(messages[1], /"admin@example\.com" belongs to a teacher or administrator account/);
  assert.match(messages[2], /suspended account/);
  assert.match(messages[3], /waiting for approval/);
  assert.match(messages[4], /declined account/);
  assert.equal(messages[5], 'The e-mail "karim@example.com" belongs to an existing parent account named "Karim Islam", not "Kareem Islam". Check the e-mail address, or use the name on the account.');
  for (const error of result.errors) assert.match(error.messageBn, /[ঀ-৿]/);
  assert.deepEqual(counts(), before, "all or nothing");
});

test("a taken username, an unknown class and a non-administrator create nothing", async () => {
  const before = counts();
  const taken = await importFamilies("admin", `${header},student username\nChild,Parent,parent@example.com,Taken.Name\n`);
  assert.deepEqual(taken.errors.map((error) => [error.line, error.message]), [[2, 'The username "taken.name" is already taken. Choose another or leave it blank to generate one.']]);
  await assert.rejects(importFamilies("admin", `${header}\nChild,Parent,parent@example.com\n`, "no-such-class"), (error) => error.status === 404);
  await assert.rejects(importFamilies("teacher", `${header}\nChild,Parent,parent@example.com\n`), (error) => error.status === 403);
  await assert.rejects(importFamilies("karim", "nonsense"), (error) => error.status === 403, "row errors are not revealed to non-administrators");
  const invalid = await importFamilies("admin", "student name,parent name\nChild,Parent\n");
  assert.equal(invalid.errors[0].line, 1);
  assert.deepEqual(counts(), before);
});

test("an e-mail registered while passwords are hashed rolls the whole upload back", async () => {
  const before = counts();
  const pending = importFamilies("admin", `${header}\nFirst Child,Racing Parent,race@example.com\nSecond Child,Other Parent,other@example.com\n`);
  // E-mails are checked before the slow hashing and written after it: register one in between.
  await new Promise((resolve) => setImmediate(resolve));
  db.insert(adults).values({ id: "racer", email: "race@example.com", displayName: "Someone else", passwordHash: "fixture" }).run();
  await assert.rejects(pending, (error) => error.status === 409 && /registered during the upload/.test(error.message) && /[ঀ-৿]/.test(error.messageBn));
  assert.deepEqual(counts(), { ...before, adults: before.adults + 1 }, "only the racing account exists; no partial upload");
});

test("a reused parent suspended while passwords are hashed rolls the whole upload back", async () => {
  const before = counts();
  const pending = importFamilies("admin", `${header}\nLate Child,Karim Islam,karim@example.com\n`);
  await new Promise((resolve) => setImmediate(resolve));
  db.update(adults).set({ status: "suspended" }).where(eq(adults.id, "karim")).run();
  await assert.rejects(pending, (error) => error.status === 409 && /changed during the upload/.test(error.message));
  db.update(adults).set({ status: "active" }).where(eq(adults.id, "karim")).run();
  assert.deepEqual(counts(), before);
});

import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const dir = mkdtempSync(path.join(tmpdir(), "bangla-class-sources-"));
process.env.DATABASE_PATH = path.join(dir, "test.db");
const { getDb } = await import("../db/index.ts");
const { adults, students, classes, classStudents, studentClassEnrollments, parentStudentLinks, userAuditEvents } = await import("../db/schema.ts");
const { bootstrapSql } = await import("../db/bootstrap.ts");
const { migrateAccessControl } = await import("../db/access-migration.ts");
const { migrateContent } = await import("../db/content-migration.ts");
const sources = await import("../lib/class-sources.ts");
const { eq } = await import("drizzle-orm");
const db = await getDb();
db.insert(adults).values([
  { id: "admin", email: "admin@example.com", displayName: "Admin Ayesha", role: "admin", passwordHash: "fixture" },
  { id: "rina", email: "rina@example.com", displayName: "Teacher Rina", role: "teacher", teacherStatus: "approved", passwordHash: "fixture" },
  { id: "karim", email: "karim@example.com", displayName: "Teacher Karim", role: "teacher", teacherStatus: "approved", passwordHash: "fixture" },
  { id: "parent", email: "parent@example.com", displayName: "Parent Nila", passwordHash: "fixture" },
  { id: "other-parent", email: "other@example.com", displayName: "Parent Other", passwordHash: "fixture" },
]).run();
db.insert(students).values([
  { id: "maya", username: "maya", displayName: "Maya", passwordHash: "fixture" },
  { id: "rohan", username: "rohan", displayName: "Rohan", passwordHash: "fixture" },
  { id: "tuli", username: "tuli", displayName: "Tuli", passwordHash: "fixture" },
]).run();
db.insert(classes).values([
  { id: "sunday", teacherId: "rina", name: "Sunday 11:30", joinCode: "SUN111" },
  { id: "saturday", teacherId: "karim", name: "Saturday 10:00", joinCode: "SAT100" },
]).run();
const allocate = (studentId, classId, active = true) => {
  const rosterId = `${classId}-${studentId}`;
  db.insert(classStudents).values({ id: rosterId, classId, displayName: studentId, tokenHash: `token-${rosterId}` }).run();
  db.insert(studentClassEnrollments).values({ id: `enrol-${rosterId}`, studentId, classId, classStudentId: rosterId, active }).run();
};
allocate("maya", "sunday");
allocate("rohan", "sunday", false); // allocation removed
allocate("tuli", "saturday");
db.insert(parentStudentLinks).values({ id: "link-maya", parentId: "parent", studentId: "maya" }).run();
after(() => rmSync(dir, { recursive: true, force: true }));

const staff = (id, role = "teacher") => ({ id, role, status: "active", teacherStatus: role === "teacher" ? "approved" : "none" });
const rina = staff("rina"), karim = staff("karim"), admin = staff("admin", "admin");
const story = { titleEn: "Pohela Boishakh story", titleBn: "পহেলা বৈশাখের গল্প", url: "https://example.org/boishakh", note: "Read before Sunday." };

test("the class_sources table is created on start and the migration is safe to repeat", () => {
  const sqlite = new Database(process.env.DATABASE_PATH);
  try {
    sqlite.exec(bootstrapSql);
    migrateAccessControl(sqlite);
    migrateContent(sqlite);
    migrateContent(sqlite);
    const columns = sqlite.prepare("PRAGMA table_info(class_sources)").all().map((column) => column.name);
    assert.deepEqual(columns, ["id", "class_id", "title_en", "title_bn", "url", "note", "created_by", "created_at"]);
  } finally { sqlite.close(); }
});

test("a class source needs a title in one language and a public HTTPS link, within limits", () => {
  assert.deepEqual(sources.validateClassSource({ titleEn: "  Video ", url: " https://example.org/v ", note: "" }), { titleEn: "Video", titleBn: "", url: "https://example.org/v", note: "" });
  assert.equal(sources.validateClassSource({ titleBn: "ভিডিও", url: "https://example.org/v" }).titleBn, "ভিডিও");
  for (const [bad, message] of [
    [{ url: "https://example.org/v" }, /title/],
    [{ titleEn: "x".repeat(121), url: "https://example.org/v" }, /120/],
    [{ titleEn: "Video" }, /link/],
    [{ titleEn: "Video", url: "http://example.org/v" }, /HTTPS/],
    [{ titleEn: "Video", url: "javascript:alert(1)" }, /https/],
    [{ titleEn: "Video", url: "https://example.org/v", note: "n".repeat(301) }, /300/],
  ]) {
    assert.throws(() => sources.validateClassSource(bad), (error) => message.test(error.message) && Boolean(error.messageBn) && error.status === 400);
  }
});

test("only the class's teacher or an administrator manages its sources", async () => {
  const added = await sources.addClassSource(rina, "sunday", story);
  assert.equal(added.host, "example.org");
  assert.equal(await sources.addClassSource(karim, "sunday", story), null, "another teacher cannot add");
  assert.equal(await sources.listClassSources(karim, "sunday"), null, "another teacher cannot list");
  assert.equal(await sources.updateClassSource(karim, "sunday", added.id, { ...story, url: "https://evil.example/x" }), null, "another teacher cannot edit");
  assert.equal(await sources.removeClassSource(karim, "sunday", added.id), false, "another teacher cannot remove");
  assert.equal(await sources.updateClassSource(karim, "saturday", added.id, story), null, "a source cannot be edited through another class");
  assert.equal((await sources.listClassSources(rina, "sunday"))[0].url, "https://example.org/boishakh");

  const byAdmin = await sources.addClassSource(admin, "saturday", { titleEn: "Saturday map", url: "https://nctb.gov.bd/map" });
  assert.equal(byAdmin.classId, "saturday");
  const edited = await sources.updateClassSource(admin, "sunday", added.id, { ...story, url: "https://example.org/boishakh-2" });
  assert.equal(edited.url, "https://example.org/boishakh-2");

  const audit = db.select().from(userAuditEvents).where(eq(userAuditEvents.targetId, "sunday")).all();
  assert.deepEqual(audit.map((row) => row.action), ["class-source-added", "class-source-updated"]);
  assert.deepEqual(JSON.parse(audit[1].detailsJson), { sourceId: added.id, oldUrl: "https://example.org/boishakh", newUrl: "https://example.org/boishakh-2" });
  assert.equal(audit[1].actorId, "admin");
});

test("students see the sources of the classes they are actively allocated to, and nothing else", async () => {
  const maya = await sources.studentClassSources("maya");
  assert.deepEqual(maya.map((row) => [row.className, row.teacherName, row.sources.map((source) => source.titleEn)]), [["Sunday 11:30", "Teacher Rina", ["Pohela Boishakh story"]]]);
  assert.deepEqual(await sources.studentClassSources("rohan"), [], "a removed allocation shows nothing");
  const tuli = await sources.studentClassSources("tuli");
  assert.deepEqual(tuli.map((row) => row.sources.map((source) => source.titleEn)), [["Saturday map"]]);
  assert.deepEqual(await sources.studentClassSources("nobody"), []);
});

test("parents see the sources of their linked children's classes only", async () => {
  const linked = await sources.parentClassSources("parent");
  assert.deepEqual(Object.keys(linked), ["sunday"]);
  assert.deepEqual(linked.sunday.map((source) => source.titleBn), ["পহেলা বৈশাখের গল্প"]);
  assert.deepEqual(await sources.parentClassSources("other-parent"), {});
  await assert.rejects(sources.parentClassSources("rina"), (error) => error.status === 403);

  // Removing the child's allocation removes the class from the parent's view too.
  db.update(studentClassEnrollments).set({ active: false }).where(eq(studentClassEnrollments.studentId, "maya")).run();
  assert.deepEqual(await sources.parentClassSources("parent"), {});
  assert.deepEqual(await sources.studentClassSources("maya"), []);
  db.update(studentClassEnrollments).set({ active: true }).where(eq(studentClassEnrollments.studentId, "maya")).run();
});

test("a class keeps at most 50 sources, and removing a source is audited", async () => {
  for (let index = (await sources.listClassSources(rina, "sunday")).length; index < sources.CLASS_SOURCE_LIMITS.perClass; index++) {
    await sources.addClassSource(rina, "sunday", { titleEn: `Link ${index}`, url: `https://example.org/${index}` });
  }
  await assert.rejects(sources.addClassSource(rina, "sunday", story), (error) => error.status === 400 && /at most 50/.test(error.message));
  const [first] = await sources.listClassSources(rina, "sunday");
  assert.equal(await sources.removeClassSource(rina, "sunday", first.id), true);
  assert.equal(await sources.removeClassSource(rina, "sunday", first.id), false);
  const removed = db.select().from(userAuditEvents).where(eq(userAuditEvents.action, "class-source-removed")).all();
  assert.equal(JSON.parse(removed[0].detailsJson).sourceId, first.id);
});

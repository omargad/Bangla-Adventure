import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { count, eq } from "drizzle-orm";

const dir = mkdtempSync(path.join(os.tmpdir(), "bangla-student-import-db-"));
process.env.DATABASE_PATH = path.join(dir, "import.db");
const { getDb } = await import("../db/index.ts");
const { adults, students, classes, classStudents, studentClassEnrollments, userAuditEvents } = await import("../db/schema.ts");
const { generateUsername, importStudents } = await import("../lib/enrollments.ts");
const db = await getDb();
db.insert(adults).values({ id: "teacher", email: "teacher@example.com", displayName: "Teacher", role: "teacher", teacherStatus: "approved", passwordHash: "fixture" }).run();
db.insert(classes).values({ id: "class", teacherId: "teacher", name: "Class", joinCode: "ABC234" }).run();
// Every four-digit "student" username is taken, so names generated from Bangla-only names must widen to six digits.
db.transaction((tx) => {
  for (let start = 1000; start < 10000; start += 500) {
    tx.insert(students).values(Array.from({ length: 500 }, (_, index) => ({ id: `seeded-${start + index}`, username: `student${start + index}`, displayName: "Seeded", passwordHash: "fixture" }))).run();
  }
});
db.insert(students).values({ id: "nadia", username: "nadia1234", displayName: "Nadia", passwordHash: "fixture" }).run();
after(() => rmSync(dir, { recursive: true, force: true }));

const total = (table) => db.select({ n: count() }).from(table).get().n;
const counts = () => ({
  students: total(students),
  roster: total(classStudents),
  enrollments: total(studentClassEnrollments),
  provisioned: db.select({ n: count() }).from(userAuditEvents).where(eq(userAuditEvents.action, "student-provisioned")).get().n,
});
/** A random source that returns the given values in order and records the ranges it was asked for. */
function scripted(values) {
  const ranges = [];
  const random = (min, max) => { ranges.push([min, max]); assert.ok(values.length, "no scripted value left"); return values.shift(); };
  return { random, ranges };
}

test("generated usernames skip names taken in the database or earlier in the upload", () => {
  const used = new Set(["nadia2345"]);
  const { random } = scripted([1234, 2345, 3456]);
  assert.equal(db.transaction((tx) => generateUsername(tx, "Nadia", used, random)), "nadia3456");
  assert.ok(used.has("nadia3456"), "the batch remembers it for the next row");
});

test("generated usernames widen to six digits when the four-digit names are taken", () => {
  const used = new Set(["student123456"]);
  const { random, ranges } = scripted([...Array(10).fill(1000), 123456, 654321]);
  assert.equal(db.transaction((tx) => generateUsername(tx, "মায়া", used, random)), "student654321", "a username requested in the file is never reused");
  assert.deepEqual(ranges, [...Array(10).fill([1000, 10000]), [100000, 1000000], [100000, 1000000]]);
  const { random: stuck } = scripted(Array(20).fill(1234));
  assert.throws(() => db.transaction((tx) => generateUsername(tx, "Nadia", new Set(), stuck)), (error) => error.status === 503);
});

test("an upload's generated usernames are unique, avoid existing accounts and every requested name", async () => {
  const before = counts();
  const names = ["মায়া", "আরিফ", "নাদিয়া", "রাহেলা", "সুমন", "তানিয়া", "ফারহান", "জারা", "ইমরান", "লাবিবা", "সাকিব", "নুসরাত", "রাফি", "তাসনিম", "আয়ান", "মীম", "সাদিয়া", "রিয়াদ", "অর্পা", "তুহিন"];
  const csv = `name,username\n${names.map((name) => `${name},`).join("\n")}\nনাদিয়া রহমান,student123456\n`;
  const result = await importStudents("teacher", "class", csv);
  assert.ok("created" in result, JSON.stringify(result));
  const usernames = result.created.map((row) => row.username);
  assert.equal(usernames.length, 21);
  assert.equal(new Set(usernames).size, 21, "unique within the upload");
  assert.equal(usernames.filter((username) => username === "student123456").length, 1, "only the row that asked for it");
  for (const username of usernames.slice(0, 20)) assert.match(username, /^student\d{6}$/);
  assert.equal(usernames[20], "student123456");
  assert.deepEqual(counts(), { students: before.students + 21, roster: before.roster + 21, enrollments: before.enrollments + 21, provisioned: before.provisioned + 21 });
  for (const username of usernames) {
    const student = db.select().from(students).where(eq(students.username, username)).get();
    assert.ok(!student.id.startsWith("seeded-"), `${username} belongs to an existing account`);
    assert.equal(student.mustChangePassword, true);
  }
});

test("a requested username that already exists creates nothing and names the line", async () => {
  const before = counts();
  const result = await importStudents("teacher", "class", "name,username\nFresh Student,\nNadia Again,NADIA1234\nAnother Student,\n");
  assert.deepEqual(result.errors.map((error) => error.line), [3]);
  assert.match(result.errors[0].message, /"nadia1234" is already taken/);
  assert.deepEqual(counts(), before, "all or nothing");
});

test("a username claimed while passwords are hashed rolls the whole upload back", async () => {
  const before = counts();
  const pending = importStudents("teacher", "class", "name,username\nFirst Student,\nRacing Student,race.user\n");
  // Usernames are checked before the slow hashing and written after it: claim one in between.
  await new Promise((resolve) => setImmediate(resolve));
  db.insert(students).values({ id: "racer", username: "race.user", displayName: "Someone else", passwordHash: "fixture" }).run();
  await assert.rejects(pending, (error) => error.status === 409 && /taken during the upload/.test(error.message));
  assert.deepEqual(counts(), { ...before, students: before.students + 1 }, "only the racing account exists; no partial upload");
});

const enrolled = (studentId) => db.select().from(studentClassEnrollments).where(eq(studentClassEnrollments.studentId, studentId)).all();

test("a row with an existing student's username and name puts that student in the class", async () => {
  db.insert(students).values({ id: "rina", username: "rina.k", displayName: "Rina Khan", passwordHash: "rina-own-hash" }).run();
  const before = counts();
  const result = await importStudents("teacher", "class", "name,username\nrina  KHAN,Rina.K\nBrand New Pupil,\n");
  assert.ok("created" in result, JSON.stringify(result));
  assert.deepEqual(result.created.map((row) => row.displayName), ["Brand New Pupil"]);
  assert.deepEqual(result.existing, [{ displayName: "Rina Khan", username: "rina.k", alreadyInClass: false }]);
  assert.deepEqual(counts(), { students: before.students + 1, roster: before.roster + 2, enrollments: before.enrollments + 2, provisioned: before.provisioned + 1 });
  assert.deepEqual(enrolled("rina").map((row) => [row.classId, row.active]), [["class", true]]);
  const rina = db.select().from(students).where(eq(students.id, "rina")).get();
  assert.equal(rina.passwordHash, "rina-own-hash", "an existing student keeps their password");
  assert.equal(rina.mustChangePassword, false);
  assert.equal(db.select({ n: count() }).from(userAuditEvents).where(eq(userAuditEvents.targetId, "rina")).get().n, 1, "the allocation is audited");

  const again = await importStudents("teacher", "class", "name,username\nRina Khan,rina.k\n");
  assert.deepEqual(again, { created: [], existing: [{ displayName: "Rina Khan", username: "rina.k", alreadyInClass: true }] });
  assert.equal(enrolled("rina").length, 1);
});

test("the username of a suspended or unapproved student is still taken", async () => {
  db.insert(students).values([
    { id: "suspended-kid", username: "sus.kid", displayName: "Sus Kid", passwordHash: "fixture", status: "suspended" },
    { id: "waiting-kid", username: "wait.kid", displayName: "Wait Kid", passwordHash: "fixture", approvalStatus: "pending" },
  ]).run();
  const before = counts();
  const result = await importStudents("teacher", "class", "name,username\nSus Kid,sus.kid\nWait Kid,wait.kid\n");
  assert.deepEqual(result.errors.map((error) => [error.line, error.message]), [
    [2, 'The username "sus.kid" is already taken. Choose another or leave it blank to generate one.'],
    [3, 'The username "wait.kid" is already taken. Choose another or leave it blank to generate one.'],
  ]);
  assert.equal(result.sameNames, false);
  assert.deepEqual(counts(), before);
  assert.deepEqual(enrolled("suspended-kid"), []);
});

test("a name-only row whose name already has an account needs confirmation before a second account", async () => {
  db.insert(students).values([
    { id: "omar", username: "omar.f", displayName: "Omar Faruk", passwordHash: "fixture" },
    { id: "omar-waiting", username: "omar.p", displayName: "Omar Faruk", passwordHash: "fixture", approvalStatus: "pending" },
    ...["twin.a", "twin.b", "twin.c", "twin.d"].map((username) => ({ id: username, username, displayName: "Twin Name", passwordHash: "fixture" })),
  ]).run();
  const before = counts();
  const refused = await importStudents("teacher", "class", "name\nomar  faruk\nUnique Pupil Name\nTwin Name\n");
  assert.equal(refused.sameNames, true);
  assert.deepEqual(refused.errors.map((error) => error.line), [2, 4]);
  assert.equal(refused.errors[0].message, 'A student named "omar  faruk" already has an account (omar.f). To add them, write their username in the "username" column. If this is a different child, tick "Create new accounts for matching names too" and upload again.');
  assert.match(refused.errors[0].messageBn, /অ্যাকাউন্ট আছে \(omar\.f\)/);
  assert.match(refused.errors[1].message, /\(twin\.a, twin\.b, twin\.c and 1 more\)/);
  assert.deepEqual(counts(), before, "nothing is created");

  const confirmed = await importStudents("teacher", "class", "name\nomar  faruk\nUnique Pupil Name\nTwin Name\n", { createSameNames: true });
  assert.deepEqual(confirmed.created.map((row) => row.displayName), ["omar  faruk", "Unique Pupil Name", "Twin Name"]);
  assert.deepEqual(confirmed.existing, []);
});

test("a row whose username matches no account but whose name does is refused as a likely typo", async () => {
  db.insert(students).values({ id: "laila", username: "laila.h2522", displayName: "Laila Hossain", passwordHash: "fixture" }).run();
  const before = counts();
  const refused = await importStudents("teacher", "class", "name,username\nLaila Hossain,laila.h2521\nUnrelated Pupil,unrelated.pupil\n");
  assert.equal(refused.sameNames, true);
  assert.deepEqual(refused.errors.map((error) => [error.line, error.message]), [[2,
    'No student has the username "laila.h2521", but a student named "Laila Hossain" already has an account (laila.h2522). To add them, check the username and upload again. If this is a different child, tick "Create new accounts for matching names too" and upload again.']]);
  assert.match(refused.errors[0].messageBn, /"laila\.h2521" ব্যবহারকারীর নামে কোনো শিক্ষার্থী নেই/);
  assert.deepEqual(counts(), before, "no second account for Laila");
  assert.deepEqual(enrolled("laila"), []);

  const fixed = await importStudents("teacher", "class", "name,username\nLaila Hossain,laila.h2522\n");
  assert.deepEqual(fixed, { created: [], existing: [{ displayName: "Laila Hossain", username: "laila.h2522", alreadyInClass: false }] });

  const confirmed = await importStudents("teacher", "class", "name,username\nLaila Hossain,laila.h2521\n", { createSameNames: true });
  assert.deepEqual(confirmed.created.map((row) => [row.displayName, row.username]), [["Laila Hossain", "laila.h2521"]], "a different child with the same name, once confirmed");
});

test("an existing student suspended while passwords are hashed rolls the whole upload back", async () => {
  db.insert(students).values({ id: "late", username: "late.kid", displayName: "Late Kid", passwordHash: "fixture" }).run();
  const before = counts();
  const pending = importStudents("teacher", "class", "name,username\nLate Kid,late.kid\nNew Kid Two,\n");
  await new Promise((resolve) => setImmediate(resolve));
  db.update(students).set({ status: "suspended" }).where(eq(students.id, "late")).run();
  await assert.rejects(pending, (error) => error.status === 409 && /changed during the upload/.test(error.message));
  assert.deepEqual(counts(), before, "no partial upload");
  assert.deepEqual(enrolled("late"), []);
});

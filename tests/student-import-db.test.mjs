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

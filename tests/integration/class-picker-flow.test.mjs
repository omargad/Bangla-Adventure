import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import Database from "better-sqlite3";

/**
 * Click-to-add allocation: an approved teacher searches every active, approved student (names and
 * usernames only), ticks several and adds them in one request, only into classes they manage. The
 * class CSV puts students who already have an account into the class instead of duplicating them.
 */

const PORT = 3233;
const BASE = `http://127.0.0.1:${PORT}`;
const stateDir = mkdtempSync(path.join(tmpdir(), "bangla-picker-"));
const password = "integration-picker-password";
let server, adminCookie, teacherCookie, otherTeacherCookie, parentCookie, classId, otherClassId;
const ids = {};

const cookieFrom = (response, name = "ba_adult_session") => response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`))?.split(";")[0];
const send = (route, method = "GET", body, cookie, headers = {}) => fetch(`${BASE}${route}`, { method, redirect: "manual", headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const fixture = (callback) => { const db = new Database(path.join(stateDir, "test.db")); try { return callback(db); } finally { db.close(); } };
const device = (name) => ({ "x-forwarded-for": `picker-${name}` });
const search = (cookie, q = "", target = classId) => send(`/api/classes/${target}/students?${new URLSearchParams({ available: "1", q })}`, "GET", undefined, cookie);
const enrolledIn = (target) => fixture((db) => db.prepare("SELECT s.username FROM student_class_enrollments e JOIN students s ON s.id = e.student_id WHERE e.class_id = ? AND e.active = 1 ORDER BY s.username").all(target).map((row) => row.username));

async function adult(email, role) {
  const signUp = await send("/api/auth/sign-up", "POST", { email, displayName: email.split("@")[0], password }, undefined, device(email));
  assert.equal(signUp.status, 201);
  // Self sign-ups wait for an administrator: approve directly, then sign in.
  fixture((db) => db.prepare({
    admin: "UPDATE adults SET role = 'admin', approval_status = 'approved' WHERE email = ?",
    teacher: "UPDATE adults SET role = 'teacher', teacher_status = 'approved', approval_status = 'approved' WHERE email = ?",
    parent: "UPDATE adults SET approval_status = 'approved' WHERE email = ?",
  }[role]).run(email));
  const signIn = await send("/api/auth/sign-in", "POST", { email, password }, undefined, device(email));
  assert.equal(signIn.status, 200);
  return cookieFrom(signIn);
}
async function createStudent(username, displayName) {
  const created = await send("/api/admin/users", "POST", { kind: "student", username, displayName }, adminCookie);
  assert.equal(created.status, 201);
  ids[username] = (await created.json()).user.id;
}
async function createClass(cookie, name) {
  const created = await send("/api/classes", "POST", { name }, cookie);
  assert.equal(created.status, 201);
  return (await created.json()).class.id;
}

before(async () => {
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(PORT)], {
    cwd: new URL("../..", import.meta.url).pathname,
    env: { ...process.env, NODE_ENV: "production", PLATFORM_MODE: "legacy", DATABASE_PATH: path.join(stateDir, "test.db"), MEDIA_ROOT: path.join(stateDir, "media") }, stdio: "ignore",
  });
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch (error) { if (server.exitCode !== null) throw error; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  adminCookie = await adult("picker-admin@example.com", "admin");
  teacherCookie = await adult("picker-teacher@example.com", "teacher");
  otherTeacherCookie = await adult("picker-other@example.com", "teacher");
  parentCookie = await adult("picker-parent@example.com", "parent");
  classId = await createClass(teacherCookie, "Picker class");
  otherClassId = await createClass(otherTeacherCookie, "Other class");
  await createStudent("maya.picker", "Maya Picker");
  await createStudent("arif.picker", "Arif Picker");
  await createStudent("nadia.picker", "Nadia Picker");
  await createStudent("zara.other", "Zara Other");
  // Zara is only in the other teacher's class; a self-registered student waits for approval.
  assert.equal((await send(`/api/classes/${otherClassId}/students`, "POST", { username: "zara.other" }, otherTeacherCookie)).status, 200);
  assert.equal((await send("/api/student/sign-up", "POST", { username: "waiting.picker", displayName: "Waiting Picker", password }, undefined, device("waiting"))).status, 201);
});
after(async () => {
  if (server && server.exitCode === null) { const closed = once(server, "exit"); server.kill("SIGTERM"); await closed; }
  rmSync(stateDir, { recursive: true, force: true });
});

test("a teacher finds students outside their own classes by name or username, but only names and usernames", async () => {
  const response = await search(teacherCookie);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/);
  const text = await response.text();
  assert.ok(!/passwordHash|password_hash|scrypt:|approval|status|parent|email/i.test(text), "no credentials, statuses or family details");
  const body = JSON.parse(text);
  assert.deepEqual(body.students.map((row) => row.username), ["arif.picker", "maya.picker", "nadia.picker", "zara.other"], "includes a student from another teacher's class; never a waiting account");
  assert.equal(body.more, false);
  assert.deepEqual(Object.keys(body.students[0]).sort(), ["displayName", "id", "username"]);
  assert.deepEqual((await (await search(teacherCookie, "ZARA")).json()).students.map((row) => row.displayName), ["Zara Other"]);
  assert.deepEqual((await (await search(teacherCookie, "nadia.p")).json()).students.map((row) => row.username), ["nadia.picker"]);
  assert.deepEqual((await (await search(teacherCookie, "waiting")).json()).students, []);
  // Results, rosters and families of other classes stay closed.
  assert.equal((await send(`/api/classes/${otherClassId}/students`, "GET", undefined, teacherCookie)).status, 404);
  assert.equal((await send(`/api/classes/${otherClassId}`, "GET", undefined, teacherCookie)).status, 404);
});

test("a teacher adds the students they ticked in one request, each allocation audited", async () => {
  const response = await send(`/api/classes/${classId}/students`, "POST", { studentIds: [ids["maya.picker"], ids["zara.other"]] }, teacherCookie);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { allocated: 2, alreadyAllocated: 0 });
  assert.deepEqual(enrolledIn(classId), ["maya.picker", "zara.other"]);
  assert.deepEqual(enrolledIn(otherClassId), ["zara.other"], "a student may be in several classes");
  fixture((db) => {
    const actor = db.prepare("SELECT id FROM adults WHERE email = 'picker-teacher@example.com'").get().id;
    for (const username of ["maya.picker", "zara.other"]) {
      const audit = db.prepare("SELECT * FROM user_audit_events WHERE target_id = ? AND action = 'class-allocated' AND actor_id = ?").get(ids[username], actor);
      assert.deepEqual(JSON.parse(audit.details_json), { classId });
    }
  });
  assert.deepEqual((await (await search(teacherCookie)).json()).students.map((row) => row.username), ["arif.picker", "nadia.picker"], "added students leave the list");
  const roster = await (await send(`/api/classes/${classId}/students`, "GET", undefined, teacherCookie)).json();
  assert.deepEqual(roster.students.map((row) => row.username).sort(), ["maya.picker", "zara.other"]);
});

test("a teacher cannot search or allocate into another teacher's class, and nobody else can", async () => {
  const before = enrolledIn(otherClassId);
  assert.equal((await search(teacherCookie, "", otherClassId)).status, 404);
  const denied = await send(`/api/classes/${otherClassId}/students`, "POST", { studentIds: [ids["arif.picker"]] }, teacherCookie);
  assert.equal(denied.status, 404);
  assert.equal((await denied.json()).errorBn, "ক্লাসটি পাওয়া যায়নি।");
  assert.equal((await send(`/api/classes/${otherClassId}/students`, "POST", { username: "arif.picker" }, teacherCookie)).status, 404);
  assert.equal((await search(parentCookie)).status, 403);
  assert.equal((await search(null)).status, 401);
  assert.equal((await send(`/api/classes/${classId}/students`, "POST", { studentIds: [ids["arif.picker"]] }, teacherCookie, { Origin: "https://other.example" })).status, 403);
  assert.deepEqual(enrolledIn(otherClassId), before);
  assert.equal((await send(`/api/classes/${otherClassId}/students`, "POST", { studentIds: [ids["arif.picker"]] }, adminCookie)).status, 200, "administrators allocate into any class");
});

test("a selection with an unknown or waiting student, or no students, allocates nobody", async () => {
  const before = enrolledIn(classId);
  const waiting = fixture((db) => db.prepare("SELECT id FROM students WHERE username = 'waiting.picker'").get().id);
  const refused = await send(`/api/classes/${classId}/students`, "POST", { studentIds: [ids["nadia.picker"], waiting] }, teacherCookie);
  assert.equal(refused.status, 409);
  assert.match((await refused.json()).error, /no longer be added/);
  assert.equal((await send(`/api/classes/${classId}/students`, "POST", { studentIds: [] }, teacherCookie)).status, 400);
  assert.equal((await send(`/api/classes/${classId}/students`, "POST", { studentIds: [42] }, teacherCookie)).status, 400);
  assert.deepEqual(enrolledIn(classId), before);
});

test("the class CSV adds students who already have an account and asks before a second account", async () => {
  const before = fixture((db) => db.prepare("SELECT count(*) AS n FROM students").get().n);
  const existing = await send(`/api/classes/${classId}/students/import`, "POST", { csv: "name,username\nArif Picker,Arif.Picker\nMaya Picker,maya.picker\n" }, teacherCookie);
  assert.equal(existing.status, 201);
  assert.deepEqual(await existing.json(), { created: [], existing: [{ displayName: "Arif Picker", username: "arif.picker", alreadyInClass: false }, { displayName: "Maya Picker", username: "maya.picker", alreadyInClass: true }] });
  assert.ok(enrolledIn(classId).includes("arif.picker"));

  const duplicate = await send(`/api/classes/${classId}/students/import`, "POST", { csv: "name\nNadia Picker\nBrand New Picker\n" }, teacherCookie);
  assert.equal(duplicate.status, 400);
  const refused = await duplicate.json();
  assert.equal(refused.sameNames, true);
  assert.deepEqual(refused.errors.map((error) => error.line), [2]);
  assert.match(refused.errors[0].message, /already has an account \(nadia\.picker\)/);
  assert.equal(fixture((db) => db.prepare("SELECT count(*) AS n FROM students").get().n), before, "nothing is created");

  const confirmed = await send(`/api/classes/${classId}/students/import`, "POST", { csv: "name\nNadia Picker\nBrand New Picker\n", createSameNames: true }, teacherCookie);
  assert.equal(confirmed.status, 201);
  assert.deepEqual((await confirmed.json()).created.map((row) => row.displayName), ["Nadia Picker", "Brand New Picker"]);
  assert.equal(fixture((db) => db.prepare("SELECT count(*) AS n FROM students").get().n), before + 2);
});

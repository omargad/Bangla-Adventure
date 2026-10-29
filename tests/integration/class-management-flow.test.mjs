import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import Database from "better-sqlite3";

/**
 * Administrators set classes up for teachers: they list approved teachers, create a class for one
 * and give a class to another teacher (both audited). The old teacher loses access at once and the
 * new teacher gains it, with the class's students, activities, results and attendance.
 */

const PORT = 3235;
const BASE = `http://127.0.0.1:${PORT}`;
const stateDir = mkdtempSync(path.join(tmpdir(), "bangla-class-management-"));
const password = "integration-classes-admin-password";
const today = new Date().toISOString().slice(0, 10);
let server, adminCookie, rinaCookie, karimCookie, waitingCookie, classId, studentId;
const ids = {};

const cookieFrom = (response, name = "ba_adult_session") => response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`))?.split(";")[0];
const send = (route, method = "GET", body, cookie, headers = {}) => fetch(`${BASE}${route}`, { method, redirect: "manual", headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const fixture = (callback) => { const db = new Database(path.join(stateDir, "test.db")); try { return callback(db); } finally { db.close(); } };
const device = (name) => ({ "x-forwarded-for": `class-admin-${name}` });
const audits = (action) => fixture((db) => db.prepare("SELECT * FROM user_audit_events WHERE action = ?").all(action));

async function adult(email, role) {
  const signUp = await send("/api/auth/sign-up", "POST", { email, displayName: email.split("@")[0], password }, undefined, device(email));
  assert.equal(signUp.status, 201);
  ids[email.split("@")[0]] = (await signUp.json()).adult.id;
  // Self sign-ups wait for an administrator: approve directly, then sign in.
  fixture((db) => db.prepare({
    admin: "UPDATE adults SET role = 'admin', approval_status = 'approved' WHERE email = ?",
    teacher: "UPDATE adults SET role = 'teacher', teacher_status = 'approved', approval_status = 'approved' WHERE email = ?",
    pending: "UPDATE adults SET teacher_status = 'pending', approval_status = 'approved' WHERE email = ?",
  }[role]).run(email));
  const signIn = await send("/api/auth/sign-in", "POST", { email, password }, undefined, device(email));
  assert.equal(signIn.status, 200);
  return cookieFrom(signIn);
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
  adminCookie = await adult("setup-admin@example.com", "admin");
  rinaCookie = await adult("rina@example.com", "teacher");
  karimCookie = await adult("karim@example.com", "teacher");
  waitingCookie = await adult("waiting-teacher@example.com", "pending");
  const student = await send("/api/student/sign-up", "POST", { username: "setup.maya", displayName: "Maya", password }, undefined, device("maya"));
  assert.equal(student.status, 201);
  studentId = (await student.json()).student.id;
  fixture((db) => db.prepare("UPDATE students SET approval_status = 'approved' WHERE id = ?").run(studentId));
});
after(async () => {
  if (server && server.exitCode === null) { const closed = once(server, "exit"); server.kill("SIGTERM"); await closed; }
  rmSync(stateDir, { recursive: true, force: true });
});

test("administrators list approved teachers only; nobody else can", async () => {
  const response = await send("/api/admin/teachers", "GET", undefined, adminCookie);
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.ok(!/passwordHash|password_hash|scrypt:/.test(text));
  assert.deepEqual(JSON.parse(text).teachers.map((teacher) => teacher.email), ["karim@example.com", "rina@example.com"], "not the waiting teacher or the administrator");
  assert.equal((await send("/api/admin/teachers", "GET", undefined, rinaCookie)).status, 403);
  assert.equal((await send("/api/admin/teachers", "GET", undefined, waitingCookie)).status, 403);
  assert.equal((await send("/api/admin/teachers")).status, 401);
});

test("an administrator creates a class for a teacher, who sees and manages it; it is audited", async () => {
  const created = await send("/api/classes", "POST", { name: "রবিবার ১১:৩০", teacherId: ids.rina }, adminCookie);
  assert.equal(created.status, 201);
  const { class: classroom } = await created.json();
  classId = classroom.id;
  assert.equal(classroom.teacherId, ids.rina);
  assert.equal(classroom.teacherName, "rina");
  assert.equal(classroom.studentCount, 0);
  const listing = await (await send("/api/classes", "GET", undefined, rinaCookie)).json();
  assert.deepEqual(listing.classes.map((item) => item.name), ["রবিবার ১১:৩০"]);
  assert.equal((await send(`/api/classes/${classId}`, "GET", undefined, rinaCookie)).status, 200);
  assert.equal((await send(`/api/classes/${classId}`, "GET", undefined, karimCookie)).status, 404);
  const [audit] = audits("class-created-for-teacher");
  assert.equal(audit.actor_id, ids["setup-admin"]);
  assert.equal(audit.target_type, "class");
  assert.equal(audit.target_id, classId);
  assert.deepEqual(JSON.parse(audit.details_json), { classId, name: "রবিবার ১১:৩০", teacherId: ids.rina });

  // The teacher works in it as in any class of their own.
  assert.equal((await send(`/api/classes/${classId}/students`, "POST", { studentIds: [studentId] }, rinaCookie)).status, 200);
  assert.equal((await send(`/api/classes/${classId}/activities`, "POST", { title: "Festivals check-in", questions: [{ prompt: "Which month starts the Bengali year?", options: ["Boishakh", "Poush"], answer: 0 }] }, rinaCookie)).status, 201);
  assert.equal((await send(`/api/classes/${classId}/attendance`, "PUT", { date: today, marks: [{ studentId, present: true }] }, rinaCookie)).status, 200);
});

test("only an administrator may create a class for another teacher, and only for an approved teacher", async () => {
  const refused = await send("/api/classes", "POST", { name: "Borrowed", teacherId: ids.karim }, rinaCookie);
  assert.equal(refused.status, 403);
  assert.ok((await refused.json()).errorBn);
  assert.equal((await send("/api/classes", "POST", { name: "Own class", teacherId: ids.rina }, rinaCookie)).status, 201, "naming themselves is their own class");
  for (const teacherId of [ids["waiting-teacher"], "missing"]) {
    const response = await send("/api/classes", "POST", { name: "Nobody's", teacherId }, adminCookie);
    assert.equal(response.status, 404, teacherId);
    assert.equal((await response.json()).errorBn, "একজন অনুমোদিত শিক্ষক বেছে নিন।");
  }
  assert.equal((await send("/api/classes", "POST", { name: "Bad", teacherId: 42 }, adminCookie)).status, 400);
  assert.equal((await send("/api/classes", "POST", { name: "", teacherId: ids.karim }, adminCookie)).status, 400);
  assert.equal(audits("class-created-for-teacher").length, 1);
  assert.equal(fixture((db) => db.prepare("SELECT count(*) AS n FROM classes WHERE name IN ('Borrowed', 'Nobody''s', 'Bad')").get().n), 0);
});

test("an administrator gives the class to another teacher: the old teacher loses access, the new teacher gains it", async () => {
  assert.equal((await send(`/api/classes/${classId}`, "PATCH", { teacherId: ids.karim }, rinaCookie)).status, 403, "teachers cannot hand classes over");
  assert.equal((await send(`/api/classes/${classId}`, "PATCH", { teacherId: ids["waiting-teacher"] }, adminCookie)).status, 404);
  assert.equal((await send(`/api/classes/${classId}`, "PATCH", {}, adminCookie)).status, 400);
  assert.equal((await send("/api/classes/missing", "PATCH", { teacherId: ids.karim }, adminCookie)).status, 404);
  assert.equal((await send(`/api/classes/${classId}`, "PATCH", { teacherId: ids.karim }, adminCookie, { Origin: "https://other.example" })).status, 403);
  assert.equal(audits("class-teacher-changed").length, 0);

  const changed = await send(`/api/classes/${classId}`, "PATCH", { teacherId: ids.karim }, adminCookie);
  assert.equal(changed.status, 200);
  const body = await changed.json();
  assert.equal(body.changed, true);
  assert.equal(body.class.teacherId, ids.karim);
  assert.equal(body.class.teacherName, "karim");

  for (const route of [`/api/classes/${classId}`, `/api/classes/${classId}/grades`, `/api/classes/${classId}/students`, `/api/classes/${classId}/attendance?date=${today}`]) {
    assert.equal((await send(route, "GET", undefined, rinaCookie)).status, 404, `old teacher: ${route}`);
    assert.equal((await send(route, "GET", undefined, karimCookie)).status, 200, `new teacher: ${route}`);
  }
  assert.ok(!(await (await send("/api/classes", "GET", undefined, rinaCookie)).json()).classes.some((item) => item.id === classId));
  const detail = await (await send(`/api/classes/${classId}`, "GET", undefined, karimCookie)).json();
  assert.deepEqual(detail.students.map((row) => row.displayName), ["Maya"], "students stay with the class");
  assert.deepEqual(detail.activities.map((row) => row.title), ["Festivals check-in"], "so do activities");
  const attendance = await (await send(`/api/classes/${classId}/attendance?date=${today}`, "GET", undefined, karimCookie)).json();
  assert.equal(attendance.saved.recordedBy, "rina", "and attendance");
  const listing = await (await send("/api/classes?scope=all", "GET", undefined, adminCookie)).json();
  assert.equal(listing.classes.find((item) => item.id === classId).teacherName, "karim");

  const [audit] = audits("class-teacher-changed");
  assert.equal(audit.actor_id, ids["setup-admin"]);
  assert.equal(audit.target_id, classId);
  assert.deepEqual(JSON.parse(audit.details_json), { classId, name: "রবিবার ১১:৩০", fromTeacherId: ids.rina, toTeacherId: ids.karim });
  assert.equal((await send(`/api/classes/${classId}`, "PATCH", { teacherId: ids.karim }, adminCookie)).status, 200);
  assert.equal(audits("class-teacher-changed").length, 1, "no change, no audit");
});

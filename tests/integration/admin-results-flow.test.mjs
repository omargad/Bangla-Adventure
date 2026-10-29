import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import Database from "better-sqlite3";

/**
 * Administrators manage grades and results across all classes: list every
 * class, read and export any class's grades and reset a submission (audited),
 * while teachers keep owner-only access.
 */

const PORT = 3222;
const BASE = `http://127.0.0.1:${PORT}`;
const stateDir = mkdtempSync(path.join(tmpdir(), "bangla-results-"));
const password = "integration-results-password";
let server, adminCookie, teacherCookie, otherTeacherCookie, classId, otherClassId, activityId, studentId, studentCookie, submissionId;

const cookieFrom = (response, name = "ba_adult_session") => response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`))?.split(";")[0];
const send = (route, method = "GET", body, cookie, headers = {}) => fetch(`${BASE}${route}`, { method, redirect: "manual", headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const fixture = (callback) => { const db = new Database(path.join(stateDir, "test.db")); try { return callback(db); } finally { db.close(); } };
const submissionExists = (id) => fixture((db) => Boolean(db.prepare("SELECT id FROM activity_submissions WHERE id = ?").get(id)));
const submit = () => send("/api/student/submit", "POST", { activityId, answers: [0, 1] }, studentCookie);

async function adult(email, role) {
  const signUp = await send("/api/auth/sign-up", "POST", { email, displayName: email.split("@")[0], password });
  assert.equal(signUp.status, 201);
  // Self sign-ups wait for an administrator: approve directly, then sign in.
  fixture((db) => db.prepare(role === "admin" ? "UPDATE adults SET role = 'admin', approval_status = 'approved' WHERE email = ?" : "UPDATE adults SET role = 'teacher', teacher_status = 'approved', approval_status = 'approved' WHERE email = ?").run(email));
  const signIn = await send("/api/auth/sign-in", "POST", { email, password });
  assert.equal(signIn.status, 200);
  return cookieFrom(signIn);
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
  teacherCookie = await adult("results-teacher@example.com", "teacher");
  otherTeacherCookie = await adult("other-results-teacher@example.com", "teacher");
  adminCookie = await adult("results-admin@example.com", "admin");
  classId = await createClass(teacherCookie, "Results class");
  otherClassId = await createClass(otherTeacherCookie, "Quiet class");

  const activity = await send(`/api/classes/${classId}/activities`, "POST", { title: "Festivals check-in", questions: [
    { prompt: "Which month starts the Bengali year?", options: ["Boishakh", "Poush"], answer: 0 },
    { prompt: "What do shops open on Pohela Boishakh?", options: ["Halkhata", "Umbrellas"], answer: 0 },
  ] }, teacherCookie);
  assert.equal(activity.status, 201);
  activityId = (await activity.json()).activity.id;
  const student = await send("/api/student/sign-up", "POST", { username: "results-maya", displayName: "Maya", password }, undefined, { "x-forwarded-for": "results-student" });
  assert.equal(student.status, 201);
  studentId = (await student.json()).student.id;
  fixture((db) => db.prepare("UPDATE students SET approval_status = 'approved' WHERE id = ?").run(studentId));
  studentCookie = cookieFrom(await send("/api/student/sign-in", "POST", { username: "results-maya", password }, undefined, { "x-forwarded-for": "results-student" }), "ba_student_session");
  assert.equal((await send(`/api/classes/${classId}/students`, "POST", { username: "results-maya" }, teacherCookie)).status, 200);
  const submitted = await submit();
  assert.equal(submitted.status, 200);
  assert.equal((await submitted.json()).score, 1);
  submissionId = fixture((db) => db.prepare("SELECT id FROM activity_submissions WHERE activity_id = ?").get(activityId).id);
});
after(async () => {
  if (server && server.exitCode === null) { const closed = once(server, "exit"); server.kill("SIGTERM"); await closed; }
  rmSync(stateDir, { recursive: true, force: true });
});

test("a teacher still cannot read or reset results in a class they do not own", async () => {
  assert.equal((await send(`/api/classes/${classId}/grades`, "GET", undefined, otherTeacherCookie)).status, 404);
  assert.equal((await send(`/api/classes/${classId}/grades?format=csv`, "GET", undefined, otherTeacherCookie)).status, 404);
  assert.equal((await send(`/api/classes/${classId}/submissions`, "DELETE", { submissionId }, otherTeacherCookie)).status, 404);
  assert.equal((await send(`/api/classes/${otherClassId}/submissions`, "DELETE", { submissionId }, otherTeacherCookie)).status, 404, "nor through their own class");
  assert.ok(submissionExists(submissionId));

  assert.equal((await send("/api/admin/results", "GET", undefined, teacherCookie)).status, 403);
  assert.equal((await send("/api/admin/results")).status, 401);
  const page = await send("/admin/results", "GET", undefined, teacherCookie);
  assert.equal(page.status, 307);
  assert.equal(new URL(page.headers.get("location"), BASE).pathname, "/teach");
});

test("an administrator lists every class with its teacher, counts and average", async () => {
  const response = await send("/api/admin/results", "GET", undefined, adminCookie);
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.ok(!/passwordHash|password_hash|tokenHash|scrypt:/.test(text));
  const listing = Object.fromEntries(JSON.parse(text).classes.map((item) => [item.id, item]));
  assert.equal(listing[classId].name, "Results class");
  assert.equal(listing[classId].teacherName, "results-teacher");
  assert.equal(listing[classId].teacherEmail, "results-teacher@example.com");
  assert.equal(listing[classId].studentCount, 1);
  assert.equal(listing[classId].submissionCount, 1);
  assert.equal(listing[classId].averagePercent, 50);
  assert.equal(listing[otherClassId].teacherName, "other-results-teacher");
  assert.equal(listing[otherClassId].submissionCount, 0);
  assert.equal(listing[otherClassId].averagePercent, null);
  assert.equal((await send("/admin/results", "GET", undefined, adminCookie)).status, 200);
});

test("an administrator reads and exports grades in another teacher's class", async () => {
  const response = await send(`/api/classes/${classId}/grades`, "GET", undefined, adminCookie);
  assert.equal(response.status, 200);
  const { class: classroom, rows } = await response.json();
  assert.equal(classroom.id, classId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].submissionId, submissionId);
  assert.equal(rows[0].studentName, "Maya");
  assert.equal(rows[0].activityTitle, "Festivals check-in");
  assert.equal(rows[0].percent, 50);

  const csv = await send(`/api/classes/${classId}/grades?format=csv`, "GET", undefined, adminCookie);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-type"), /text\/csv/);
  assert.match(csv.headers.get("content-disposition"), /results-class-grades\.csv/);
  const lines = (await csv.text()).split("\n");
  assert.equal(lines[0], '"Class","Activity","Student","Score","Total","Percent","Submitted At"');
  assert.match(lines[1], /^"Results class","Festivals check-in","Maya","1","2","50",/);
});

test("an administrator resets a submission in any class and the reset is audited", async () => {
  assert.equal((await send(`/api/classes/${classId}/submissions`, "DELETE", {}, adminCookie)).status, 400);
  assert.equal((await send(`/api/classes/${classId}/submissions`, "DELETE", { submissionId: "missing" }, adminCookie)).status, 404);
  assert.equal((await send(`/api/classes/${otherClassId}/submissions`, "DELETE", { submissionId }, adminCookie)).status, 404, "the class must match");
  assert.equal((await send(`/api/classes/${classId}/submissions`, "DELETE", { submissionId }, adminCookie, { Origin: "https://other.example" })).status, 403);
  assert.ok(submissionExists(submissionId));

  const reset = await send(`/api/classes/${classId}/submissions`, "DELETE", { submissionId }, adminCookie);
  assert.equal(reset.status, 200);
  assert.ok(!submissionExists(submissionId));
  fixture((db) => {
    const adminId = db.prepare("SELECT id FROM adults WHERE email = ?").get("results-admin@example.com").id;
    const audit = db.prepare("SELECT * FROM user_audit_events WHERE action = 'submission-reset'").all();
    assert.equal(audit.length, 1);
    assert.equal(audit[0].actor_id, adminId);
    assert.equal(audit[0].target_type, "student");
    assert.equal(audit[0].target_id, studentId);
    assert.deepEqual(JSON.parse(audit[0].details_json), { classId, submissionId });
  });
  const listing = await (await send("/api/admin/results", "GET", undefined, adminCookie)).json();
  assert.equal(listing.classes.find((item) => item.id === classId).submissionCount, 0);
  assert.deepEqual((await (await send(`/api/classes/${classId}/grades`, "GET", undefined, teacherCookie)).json()).rows, []);
});

test("the owning teacher keeps managing results after an administrator reset, also audited", async () => {
  assert.equal((await submit()).status, 200, "the student can submit again");
  const { rows } = await (await send(`/api/classes/${classId}/grades`, "GET", undefined, teacherCookie)).json();
  assert.equal(rows.length, 1);
  assert.equal((await send(`/api/classes/${classId}/submissions`, "DELETE", { submissionId: rows[0].submissionId }, teacherCookie)).status, 200);
  assert.ok(!submissionExists(rows[0].submissionId));
  fixture((db) => {
    const teacherId = db.prepare("SELECT id FROM adults WHERE email = ?").get("results-teacher@example.com").id;
    const audit = db.prepare("SELECT * FROM user_audit_events WHERE action = 'submission-reset' AND actor_id = ?").all(teacherId);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].target_type, "student");
    assert.equal(audit[0].target_id, studentId);
    assert.deepEqual(JSON.parse(audit[0].details_json), { classId, submissionId: rows[0].submissionId });
  });
});

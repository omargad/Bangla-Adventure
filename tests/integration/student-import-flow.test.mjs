import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import Database from "better-sqlite3";

/**
 * Teacher CSV upload → automatic accounts with temporary passwords → the
 * student must replace the temporary password before using learning APIs.
 */

const PORT = 3221;
const BASE = `http://127.0.0.1:${PORT}`;
const stateDir = mkdtempSync(path.join(tmpdir(), "bangla-import-"));
const password = "integration-import-password";
let server, teacherCookie, otherTeacherCookie, classId, otherClassId, provisioned;

const cookieFrom = (response, name = "ba_adult_session") => response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`))?.split(";")[0];
const send = (route, method = "GET", body, cookie, headers = {}) => fetch(`${BASE}${route}`, { method, redirect: "manual", headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const fixture = (callback) => { const db = new Database(path.join(stateDir, "test.db")); try { return callback(db); } finally { db.close(); } };
const studentCount = () => fixture((db) => db.prepare("SELECT count(*) AS n FROM students").get().n);
const signInStudent = (username, secret, device = "device-a") => send("/api/student/sign-in", "POST", { username, password: secret }, undefined, { "x-forwarded-for": `import-${device}` });

async function teacher(email, className) {
  const signUp = await send("/api/auth/sign-up", "POST", { email, displayName: email.split("@")[0], password });
  assert.equal(signUp.status, 201);
  fixture((db) => db.prepare("UPDATE adults SET role = 'teacher', teacher_status = 'approved' WHERE email = ?").run(email));
  const cookie = cookieFrom(signUp);
  const created = await send("/api/classes", "POST", { name: className }, cookie);
  assert.equal(created.status, 201);
  return { cookie, classId: (await created.json()).class.id };
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
  ({ cookie: teacherCookie, classId } = await teacher("import-teacher@example.com", "Import class"));
  ({ cookie: otherTeacherCookie, classId: otherClassId } = await teacher("other-teacher@example.com", "Other class"));
});
after(async () => {
  if (server && server.exitCode === null) { const closed = once(server, "exit"); server.kill("SIGTERM"); await closed; }
  rmSync(stateDir, { recursive: true, force: true });
});

test("a teacher's CSV creates accounts and enrollments and returns temporary passwords once", async () => {
  const response = await send(`/api/classes/${classId}/students/import`, "POST", { csv: '﻿Student Name,Username\r\n"Rahman, Maya",\r\nArif Hossain,Arif.Import\r\n\r\nমায়া,\r\n' }, teacherCookie);
  assert.equal(response.status, 201);
  assert.match(response.headers.get("cache-control"), /no-store/);
  const text = await response.text();
  assert.ok(!/passwordHash|password_hash|scrypt:/.test(text));
  provisioned = JSON.parse(text).created;
  assert.deepEqual(provisioned.map((row) => row.displayName), ["Rahman, Maya", "Arif Hossain", "মায়া"]);
  assert.match(provisioned[0].username, /^rahman\.maya\d{4}$/);
  assert.equal(provisioned[1].username, "arif.import");
  assert.match(provisioned[2].username, /^student\d{4}$/);
  for (const row of provisioned) assert.match(row.temporaryPassword, /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{2}$/);

  const roster = await send(`/api/classes/${classId}/students`, "GET", undefined, teacherCookie);
  const rosterText = await roster.text();
  assert.deepEqual(JSON.parse(rosterText).students.map((row) => row.username).sort(), provisioned.map((row) => row.username).sort());
  for (const row of provisioned) assert.ok(!rosterText.includes(row.temporaryPassword), "passwords are never shown again");
  const detail = await (await send(`/api/classes/${classId}`, "GET", undefined, teacherCookie)).json();
  assert.equal(detail.students.length, 3, "a roster row per student, as with allocation");

  fixture((db) => {
    for (const row of provisioned) {
      const student = db.prepare("SELECT * FROM students WHERE username = ?").get(row.username);
      assert.equal(student.must_change_password, 1);
      assert.ok(student.password_hash.startsWith("scrypt:") && !student.password_hash.includes(row.temporaryPassword));
      assert.equal(db.prepare("SELECT count(*) AS n FROM student_class_enrollments WHERE student_id = ? AND class_id = ? AND active = 1").get(student.id, classId).n, 1);
      const audit = db.prepare("SELECT * FROM user_audit_events WHERE target_id = ? AND action = 'student-provisioned'").get(student.id);
      assert.deepEqual(JSON.parse(audit.details_json), { classId });
    }
    const everything = JSON.stringify(db.prepare("SELECT * FROM user_audit_events").all());
    for (const row of provisioned) assert.ok(!everything.includes(row.temporaryPassword), "audit never stores the password");
  });
});

test("an invalid CSV creates nothing and reports every problem with its line", async () => {
  const before = studentCount();
  const csv = "name,username\nNadia Islam,nadia.ok\n,blank-name\nArif Again,arif.import\nNadia Twin,NADIA.OK\nBad User,a b\n";
  const response = await send(`/api/classes/${classId}/students/import`, "POST", { csv }, teacherCookie);
  assert.equal(response.status, 400);
  const { errors } = await response.json();
  assert.deepEqual(errors.map((error) => error.line), [3, 4, 5, 6]);
  assert.match(errors.find((error) => error.line === 4).message, /already taken/);
  assert.match(errors.find((error) => error.line === 5).message, /already used on line 2/);
  assert.equal(studentCount(), before, "all or nothing");

  const header = await send(`/api/classes/${classId}/students/import`, "POST", { csv: "pupil\nMaya\n" }, teacherCookie);
  assert.equal(header.status, 400);
  assert.match((await header.json()).errors[0].message, /header with a name column/);
  assert.equal((await send(`/api/classes/${classId}/students/import`, "POST", { csv: `name\n${"a".repeat(70 * 1024)}` }, teacherCookie)).status, 413);
  assert.equal((await send(`/api/classes/${classId}/students/import`, "POST", { file: "name\nMaya" }, teacherCookie)).status, 400);
  assert.equal(studentCount(), before);
});

test("a teacher cannot import into another teacher's class", async () => {
  const before = studentCount();
  const denied = await send(`/api/classes/${classId}/students/import`, "POST", { csv: "name\nIntruder\n" }, otherTeacherCookie);
  assert.equal(denied.status, 404);
  const invalid = await send(`/api/classes/${classId}/students/import`, "POST", { csv: "nonsense" }, otherTeacherCookie);
  assert.equal(invalid.status, 404, "row errors are not revealed for someone else's class");
  assert.equal((await send(`/api/classes/${classId}/students/import`, "POST", { csv: "name\nIntruder\n" })).status, 401);
  assert.equal((await send(`/api/classes/${classId}/students/import`, "POST", { csv: "name\nIntruder\n" }, teacherCookie, { Origin: "https://other.example" })).status, 403);
  assert.equal(studentCount(), before);
  const own = await send(`/api/classes/${otherClassId}/students/import`, "POST", { csv: "name\nOwn Student\n" }, otherTeacherCookie);
  assert.equal(own.status, 201);
});

test("a provisioned student must replace the temporary password before learning", async () => {
  const [{ username, temporaryPassword }] = provisioned;
  const first = await signInStudent(username, temporaryPassword, "device-a");
  assert.equal(first.status, 200);
  const signedIn = await first.json();
  assert.equal(signedIn.mustChangePassword, true);
  assert.equal(signedIn.student.mustChangePassword, true);
  const cookie = cookieFrom(first, "ba_student_session");
  const otherDevice = cookieFrom(await signInStudent(username, temporaryPassword, "device-b"), "ba_student_session");

  for (const [route, method, body] of [["/api/student/feed", "GET"], ["/api/student/results", "GET"], ["/api/student/submit", "POST", { activityId: "x", answers: [] }], ["/api/student/topic-progress", "POST", { topicId: "pohela-boishakh" }], ["/api/curriculum", "GET"]]) {
    const blocked = await send(route, method, body, cookie);
    assert.equal(blocked.status, 403, route);
    const payload = await blocked.json();
    assert.equal(payload.mustChangePassword, true, route);
    assert.equal(payload.readTopicIds, undefined, `${route} reveals no progress`);
  }
  for (const page of ["/student", "/topics", "/learn", "/references", "/adventure", "/certificate"]) {
    const redirected = await send(page, "GET", undefined, cookie);
    assert.equal(redirected.status, 307, page);
    assert.equal(new URL(redirected.headers.get("location"), BASE).pathname, "/student/password", page);
  }
  assert.equal((await send("/student/password", "GET", undefined, cookie)).status, 200);
  assert.equal((await (await send("/api/student/session", "GET", undefined, cookie)).json()).student.mustChangePassword, true);

  const change = (currentPassword, newPassword) => send("/api/student/password", "POST", { currentPassword, newPassword }, cookie);
  assert.equal((await change("wrong-password", "my-own-password")).status, 403);
  assert.equal((await change(temporaryPassword, "short")).status, 400);
  assert.equal((await change(temporaryPassword, temporaryPassword)).status, 400);
  assert.equal((await send("/api/student/password", "POST", { currentPassword: temporaryPassword, newPassword: "my-own-password" })).status, 401);
  const changed = await change(temporaryPassword, "my-own-password");
  assert.equal(changed.status, 200);
  assert.match(changed.headers.get("cache-control"), /no-store/);

  assert.equal((await send("/api/student/feed", "GET", undefined, cookie)).status, 200, "this session continues, unblocked");
  assert.equal((await send("/api/student/results", "GET", undefined, cookie)).status, 200);
  assert.equal((await send("/student", "GET", undefined, cookie)).status, 200);
  assert.equal((await send("/topics", "GET", undefined, cookie)).status, 200);
  const curriculum = await (await send("/api/curriculum", "GET", undefined, cookie)).json();
  assert.equal(curriculum.canRecordProgress, true);
  assert.deepEqual(curriculum.readTopicIds, []);
  assert.equal((await send("/api/student/feed", "GET", undefined, otherDevice)).status, 401, "other sessions are signed out");
  fixture((db) => {
    const student = db.prepare("SELECT * FROM students WHERE username = ?").get(username);
    assert.equal(student.must_change_password, 0);
    const audit = db.prepare("SELECT * FROM user_audit_events WHERE target_id = ? AND action = 'student-password-changed'").get(student.id);
    assert.ok(audit);
    assert.ok(!audit.details_json.includes("my-own-password"));
  });
  assert.equal((await signInStudent(username, temporaryPassword, "device-c")).status, 401, "the temporary password no longer works");
  const again = await signInStudent(username, "my-own-password", "device-c");
  assert.equal(again.status, 200);
  assert.equal((await again.json()).mustChangePassword, false);
  const signOut = await send("/api/student/sign-out?returnTo=%2Fstudent", "GET", undefined, cookie);
  assert.equal(signOut.status, 303);
});

test("students can change their password voluntarily", async () => {
  const signUp = await send("/api/student/sign-up", "POST", { username: "self-registered", displayName: "Self", password }, undefined, { "x-forwarded-for": "import-self" });
  assert.equal(signUp.status, 201);
  assert.equal((await signUp.json()).student.mustChangePassword, false);
  const cookie = cookieFrom(signUp, "ba_student_session");
  assert.equal((await send("/api/student/feed", "GET", undefined, cookie)).status, 200);
  assert.equal((await send("/api/student/password", "POST", { currentPassword: password, newPassword: "a-fresh-password" }, cookie)).status, 200);
  assert.equal((await signInStudent("self-registered", "a-fresh-password", "self")).status, 200);
});

test("a class signing in from one school network is limited per account, not as a whole", async () => {
  const school = "import-school-network";
  for (let attempt = 0; attempt < 10; attempt++) assert.equal((await send("/api/student/sign-in", "POST", { username: "Guessed.Pupil", password: `wrong-${attempt}` }, undefined, { "x-forwarded-for": school })).status, 401);
  const locked = await send("/api/student/sign-in", "POST", { username: "guessed.pupil", password: "wrong-again" }, undefined, { "x-forwarded-for": school });
  assert.equal(locked.status, 429, "one account's guesses are capped, whatever the capitalisation");
  assert.ok(Number(locked.headers.get("retry-after")) > 0);
  const [, classmate] = provisioned;
  const signedIn = await send("/api/student/sign-in", "POST", { username: classmate.username, password: classmate.temporaryPassword }, undefined, { "x-forwarded-for": school });
  assert.equal(signedIn.status, 200, "classmates on the same network can still sign in");
  assert.equal((await signedIn.json()).mustChangePassword, true);
});

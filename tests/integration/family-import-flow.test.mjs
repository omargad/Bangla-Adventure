import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import Database from "better-sqlite3";

/**
 * Administrator family upload: one CSV of student name, parent name and parent e-mail creates the
 * students, creates or reuses the parents, links them and can allocate a class. New parents must
 * replace the temporary password, then see their children.
 */

const PORT = 3232;
const BASE = `http://127.0.0.1:${PORT}`;
const stateDir = mkdtempSync(path.join(tmpdir(), "bangla-families-"));
const password = "integration-family-password";
const temporaryPattern = /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{2}$/;
let server, adminCookie, teacherCookie, existingCookie, classId, families;

const cookieFrom = (response, name = "ba_adult_session") => response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`))?.split(";")[0];
const send = (route, method = "GET", body, cookie, headers = {}) => fetch(`${BASE}${route}`, { method, redirect: "manual", headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const fixture = (callback) => { const db = new Database(path.join(stateDir, "test.db")); try { return callback(db); } finally { db.close(); } };
const device = (name) => ({ "x-forwarded-for": `families-${name}` });
const importFamilies = (body, cookie = adminCookie) => send("/api/admin/families/import", "POST", body, cookie);
const totals = () => fixture((db) => Object.fromEntries(["adults", "students", "parent_student_links", "student_class_enrollments"].map((table) => [table, db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n])));

async function adult(email, role) {
  const signUp = await send("/api/auth/sign-up", "POST", { email, displayName: email.split("@")[0].replace(/-/g, " "), password }, undefined, device(email));
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

before(async () => {
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(PORT)], {
    cwd: new URL("../..", import.meta.url).pathname,
    env: { ...process.env, NODE_ENV: "production", PLATFORM_MODE: "legacy", DATABASE_PATH: path.join(stateDir, "test.db"), MEDIA_ROOT: path.join(stateDir, "media") }, stdio: "ignore",
  });
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch (error) { if (server.exitCode !== null) throw error; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  adminCookie = await adult("family-admin@example.com", "admin");
  teacherCookie = await adult("family-teacher@example.com", "teacher");
  existingCookie = await adult("existing-parent@example.com", "parent");
  // A self-registered parent still waiting for approval.
  assert.equal((await send("/api/auth/sign-up", "POST", { email: "waiting-parent@example.com", displayName: "Waiting Parent", password }, undefined, device("waiting"))).status, 201);
  const created = await send("/api/classes", "POST", { name: "Family class" }, teacherCookie);
  assert.equal(created.status, 201);
  classId = (await created.json()).class.id;
});
after(async () => {
  if (server && server.exitCode === null) { const closed = once(server, "exit"); server.kill("SIGTERM"); await closed; }
  rmSync(stateDir, { recursive: true, force: true });
});

test("an administrator imports families: new parents, a reused parent, siblings and a class", async () => {
  const csv = [
    "Student Name,Parent Name,Parent E-mail",
    "Maya Rahman,Farida Rahman,farida@example.com",
    "Arif Rahman,Farida Rahman,FARIDA@example.com",
    '"Islam, Nadia",existing parent,existing-parent@example.com',
    "মায়া,Salma Begum,salma@example.com",
  ].join("\r\n");
  const response = await importFamilies({ csv, classId });
  assert.equal(response.status, 201);
  assert.match(response.headers.get("cache-control"), /no-store/);
  const text = await response.text();
  assert.ok(!/passwordHash|password_hash|scrypt:/.test(text));
  ({ families } = JSON.parse(text));
  assert.equal(JSON.parse(text).className, "Family class");
  assert.deepEqual(families.map((row) => [row.studentName, row.parentEmail, row.parentTemporaryPassword === null]), [
    ["Maya Rahman", "farida@example.com", false], ["Arif Rahman", "farida@example.com", false], ["Islam, Nadia", "existing-parent@example.com", true], ["মায়া", "salma@example.com", false]]);
  assert.equal(families[0].parentTemporaryPassword, families[1].parentTemporaryPassword, "siblings share one parent account");
  for (const row of families) assert.match(row.temporaryPassword, temporaryPattern);

  fixture((db) => {
    assert.equal(db.prepare("SELECT count(*) AS n FROM adults WHERE email = 'farida@example.com'").get().n, 1);
    const farida = db.prepare("SELECT * FROM adults WHERE email = 'farida@example.com'").get();
    assert.deepEqual([farida.role, farida.approval_status, farida.must_change_password], ["parent", "approved", 1]);
    for (const row of families) {
      const student = db.prepare("SELECT * FROM students WHERE username = ?").get(row.username);
      assert.deepEqual([student.approval_status, student.must_change_password], ["approved", 1]);
      assert.equal(db.prepare("SELECT count(*) AS n FROM parent_student_links l JOIN adults a ON a.id = l.parent_id WHERE l.student_id = ? AND a.email = ?").get(student.id, row.parentEmail).n, 1);
      assert.equal(db.prepare("SELECT count(*) AS n FROM student_class_enrollments WHERE student_id = ? AND class_id = ? AND active = 1").get(student.id, classId).n, 1);
    }
    const audit = JSON.stringify(db.prepare("SELECT * FROM user_audit_events").all());
    for (const row of families) assert.ok(!audit.includes(row.temporaryPassword), "audit never stores a password");
  });
  const roster = await (await send(`/api/classes/${classId}/students`, "GET", undefined, teacherCookie)).json();
  assert.deepEqual(roster.students.map((row) => row.username).sort(), families.map((row) => row.username).sort(), "the class teacher sees the students");
});

test("a new parent must replace the temporary password, then sees both children", async () => {
  const [maya] = families;
  const signIn = await send("/api/auth/sign-in", "POST", { email: "farida@example.com", password: maya.parentTemporaryPassword }, undefined, device("farida"));
  assert.equal(signIn.status, 200);
  assert.equal((await signIn.json()).mustChangePassword, true);
  const cookie = cookieFrom(signIn);
  const held = await send("/api/family", "GET", undefined, cookie);
  assert.equal(held.status, 403);
  assert.equal((await held.json()).mustChangePassword, true);
  const changed = await send("/api/account/password", "POST", { currentPassword: maya.parentTemporaryPassword, newPassword: "farida-own-password" }, cookie, device("farida-change"));
  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).recoveryCodes.length, 8, "the parent's own recovery codes, shown once");
  const overview = await send("/api/family", "GET", undefined, cookie);
  assert.equal(overview.status, 200);
  const { children } = await overview.json();
  assert.deepEqual(children.map((child) => [child.displayName, child.classes.map((item) => item.name)]), [["Arif Rahman", ["Family class"]], ["Maya Rahman", ["Family class"]]]);

  const student = await send("/api/student/sign-in", "POST", { username: maya.username, password: maya.temporaryPassword }, undefined, device("maya"));
  assert.equal(student.status, 200);
  assert.equal((await student.json()).mustChangePassword, true, "students change their temporary password too");
});

test("a reused parent keeps their password and sees the new child", async () => {
  const signIn = await send("/api/auth/sign-in", "POST", { email: "existing-parent@example.com", password }, undefined, device("existing-again"));
  assert.equal(signIn.status, 200);
  assert.equal((await signIn.json()).mustChangePassword, false);
  const { children } = await (await send("/api/family", "GET", undefined, existingCookie)).json();
  assert.deepEqual(children.map((child) => child.displayName), ["Islam, Nadia"]);
});

test("rows whose parent e-mail cannot be used are refused with their lines and nothing is created", async () => {
  const before = totals();
  const csv = [
    "student,parent,email",
    "New Child,New Parent,new-parent@example.com",
    "Teacher Child,Family Teacher,family-teacher@example.com",
    "Waiting Child,Waiting Parent,waiting-parent@example.com",
    "Wrong Child,Somebody Else,existing-parent@example.com",
    "Bad Email Child,Parent,not-an-email",
  ].join("\n");
  const response = await importFamilies({ csv });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.errorBn, /কিছুই তৈরি হয়নি/);
  assert.deepEqual(body.errors.map((error) => error.line), [3, 4, 5, 6]);
  assert.match(body.errors[0].message, /teacher or administrator account/);
  assert.match(body.errors[1].message, /waiting for approval/);
  assert.match(body.errors[2].message, /named "existing parent", not "Somebody Else"/);
  assert.match(body.errors[3].message, /not a valid e-mail/);
  assert.ok(body.errors.every((error) => /[ঀ-৿]/.test(error.messageBn)));
  assert.deepEqual(totals(), before, "all or nothing");
});

test("only administrators may import families", async () => {
  const before = totals();
  const csv = "student name,parent name,parent email\nIntruder Child,Intruder Parent,intruder@example.com\n";
  assert.equal((await importFamilies({ csv }, teacherCookie)).status, 403);
  assert.equal((await importFamilies({ csv }, existingCookie)).status, 403);
  assert.equal((await importFamilies({ csv }, null)).status, 401);
  assert.equal((await send("/api/admin/families/import", "POST", { csv }, adminCookie, { Origin: "https://other.example" })).status, 403);
  assert.equal((await importFamilies({ csv, classId: "no-such-class" })).status, 404);
  assert.equal((await importFamilies({ csv, classId: 42 })).status, 400);
  assert.equal((await importFamilies({ file: csv })).status, 400);
  assert.equal((await importFamilies({ csv: `student name,parent name,parent email\n${"a".repeat(70 * 1024)}` })).status, 413);
  assert.deepEqual(totals(), before);
});

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import Database from "better-sqlite3";

/**
 * Announcements to everyone, to students only or to parents only: students never get parents-only
 * posts (and the retired class-code feed stays closed), a linked parent gets everyone and
 * parents-only posts from their child's classes, a parent with no link gets nothing, and an
 * administrator's post is credited to the administrator, not the class teacher.
 */

const PORT = 3236;
const BASE = `http://127.0.0.1:${PORT}`;
const stateDir = mkdtempSync(path.join(tmpdir(), "bangla-announcements-"));
const password = "integration-announcements-password";
let server, adminCookie, teacherCookie, otherTeacherCookie, parentCookie, unlinkedParentCookie, studentCookie, classId, otherClassId;
const legacyToken = randomUUID();
const legacyFeed = () => send("/api/classroom/feed", "GET", undefined, undefined, { "x-student-token": legacyToken });
const posts = {};

const cookieFrom = (response, name = "ba_adult_session") => response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`))?.split(";")[0];
const send = (route, method = "GET", body, cookie, headers = {}) => fetch(`${BASE}${route}`, { method, redirect: "manual", headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const fixture = (callback) => { const db = new Database(path.join(stateDir, "test.db")); try { return callback(db); } finally { db.close(); } };
const device = (name) => ({ "x-forwarded-for": `announcements-${name}` });
const post = (body, audience, cookie = teacherCookie, target = classId) => send(`/api/classes/${target}/announcements`, "POST", audience === undefined ? { body } : { body, audience }, cookie);
const bodies = (items) => items.map((item) => item.body).sort();

async function adult(email, role) {
  const signUp = await send("/api/auth/sign-up", "POST", { email, displayName: { admin: "Admin Akter", teacher: "Teacher Rahman", other: "Other Teacher", parent: "Parent Begum", unlinked: "Unlinked Parent" }[email.split("@")[0]], password }, undefined, device(email));
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
  adminCookie = await adult("admin@example.com", "admin");
  teacherCookie = await adult("teacher@example.com", "teacher");
  otherTeacherCookie = await adult("other@example.com", "teacher");
  parentCookie = await adult("parent@example.com", "parent");
  unlinkedParentCookie = await adult("unlinked@example.com", "parent");
  const created = await send("/api/classes", "POST", { name: "Sunday Class" }, teacherCookie);
  assert.equal(created.status, 201);
  classId = (await created.json()).class.id;
  const other = await send("/api/classes", "POST", { name: "Other Class" }, otherTeacherCookie);
  otherClassId = (await other.json()).class.id;

  const signUp = await send("/api/student/sign-up", "POST", { username: "maya.notices", displayName: "Maya", password }, undefined, device("maya"));
  assert.equal(signUp.status, 201);
  const studentId = (await signUp.json()).student.id;
  fixture((db) => db.prepare("UPDATE students SET approval_status = 'approved' WHERE id = ?").run(studentId));
  studentCookie = cookieFrom(await send("/api/student/sign-in", "POST", { username: "maya.notices", password }, undefined, device("maya")), "ba_student_session");
  assert.equal((await send(`/api/classes/${classId}/students`, "POST", { studentIds: [studentId] }, teacherCookie)).status, 200);
  assert.equal((await send("/api/admin/family-links", "POST", { studentId, parentEmail: "parent@example.com", confirmed: true }, adminCookie)).status, 200);
  // A learner who joined with the old class code still has a token for the retired /classroom feed.
  fixture((db) => db.prepare("INSERT INTO class_students (id, class_id, display_name, token_hash) VALUES (?, ?, ?, ?)").run(randomUUID(), classId, "Code learner", createHash("sha256").update(legacyToken).digest("hex")));
});
after(async () => {
  if (server && server.exitCode === null) { const closed = once(server, "exit"); server.kill("SIGTERM"); await closed; }
  rmSync(stateDir, { recursive: true, force: true });
});

test("a teacher posts to everyone (the default), to students only and to parents only, up to 2000 characters", async () => {
  for (const [key, body, audience] of [["all", "Festival day on Sunday.\nWear something red.", undefined], ["students", "Students: read the Pohela Boishakh topic.", "students"], ["parents", "Parents' evening is on Friday at 6.", "parents"]]) {
    const response = await post(body, audience);
    assert.equal(response.status, 201);
    const { announcement } = await response.json();
    assert.equal(announcement.body, body);
    assert.equal(announcement.audience, key);
    assert.equal(announcement.authorName, "Teacher Rahman");
    posts[key] = announcement.id;
  }
  assert.equal((await post("x".repeat(2001), "all")).status, 400);
  const invalid = await post("Hello", "teachers");
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).errorBn, /বেছে নিন/);
  assert.equal((await post("   ", "all")).status, 400);
  const longest = await post("ক".repeat(2000), "students");
  assert.equal(longest.status, 201);
  assert.equal((await longest.json()).announcement.body.length, 2000);
  assert.equal((await post("Intruder note", "parents", otherTeacherCookie)).status, 404, "another teacher cannot post in this class");
  assert.equal((await post("A note", "all", parentCookie)).status, 403, "parents cannot post");
});

test("the teacher sees every post with its audience, author and time", async () => {
  const detail = await (await send(`/api/classes/${classId}`, "GET", undefined, teacherCookie)).json();
  assert.deepEqual(detail.announcements.slice(1).map((item) => [item.id, item.audience, item.authorName]), [[posts.parents, "parents", "Teacher Rahman"], [posts.students, "students", "Teacher Rahman"], [posts.all, "all", "Teacher Rahman"]]);
  assert.ok(detail.announcements.every((item) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(item.createdAt)));
});

test("a parents-only post is invisible to students, and the retired class-code feed cannot show it", async () => {
  const feed = await send("/api/student/feed", "GET", undefined, studentCookie);
  assert.equal(feed.status, 200);
  const [classroom] = (await feed.json()).classes;
  assert.deepEqual(bodies(classroom.announcements), bodies([{ body: "Festival day on Sunday.\nWear something red." }, { body: "Students: read the Pohela Boishakh topic." }, { body: "ক".repeat(2000) }]));
  assert.ok(classroom.announcements.every((item) => item.authorName === "Teacher Rahman" && item.audience !== "parents"));

  // Class-code access is retired: the feed answers 410 even with a valid token (its own audience
  // filter is unit-tested in tests/announcements.test.mjs).
  const legacy = await legacyFeed();
  assert.equal(legacy.status, 410);
  assert.ok(!(await legacy.text()).includes("Parents' evening"));
});

test("a linked parent sees everyone and parents-only posts with child, class and author; never students-only posts", async () => {
  const response = await send("/api/family", "GET", undefined, parentCookie);
  assert.equal(response.status, 200);
  const { announcements } = await response.json();
  assert.deepEqual(announcements.map((item) => [item.id, item.audience, item.className, item.children.map((child) => child.displayName), item.authorName]), [
    [posts.parents, "parents", "Sunday Class", ["Maya"], "Teacher Rahman"],
    [posts.all, "all", "Sunday Class", ["Maya"], "Teacher Rahman"],
  ]);
  assert.ok(!JSON.stringify(announcements).includes("Pohela Boishakh"), "students-only posts stay with students");
});

test("a parent with no linked child sees no announcements", async () => {
  const response = await send("/api/family", "GET", undefined, unlinkedParentCookie);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.announcements, []);
  assert.deepEqual(data.children, []);
});

test("an administrator's post in a teacher's class is credited to the administrator everywhere", async () => {
  const response = await post("A message from the school office.", "all", adminCookie);
  assert.equal(response.status, 201);
  const { announcement } = await response.json();
  assert.equal(announcement.authorName, "Admin Akter");
  const detail = await (await send(`/api/classes/${classId}`, "GET", undefined, teacherCookie)).json();
  assert.equal(detail.announcements.find((item) => item.id === announcement.id).authorName, "Admin Akter");
  const [classroom] = (await (await send("/api/student/feed", "GET", undefined, studentCookie)).json()).classes;
  assert.equal(classroom.announcements.find((item) => item.id === announcement.id).authorName, "Admin Akter");
  assert.equal(classroom.teacherName, "Teacher Rahman", "the class itself still names its teacher");
  const family = await (await send("/api/family", "GET", undefined, parentCookie)).json();
  assert.equal(family.announcements.find((item) => item.id === announcement.id).authorName, "Admin Akter");
});

test("removing a post takes it from everyone and is audited", async () => {
  assert.equal((await send(`/api/classes/${classId}/announcements`, "DELETE", { announcementId: posts.parents }, otherTeacherCookie)).status, 404);
  assert.equal((await send(`/api/classes/${otherClassId}/announcements`, "DELETE", { announcementId: posts.parents }, otherTeacherCookie)).status, 404);
  assert.equal((await send(`/api/classes/${classId}/announcements`, "DELETE", { announcementId: posts.parents }, teacherCookie)).status, 200);
  const family = await (await send("/api/family", "GET", undefined, parentCookie)).json();
  assert.ok(!family.announcements.some((item) => item.id === posts.parents));
  const audit = fixture((db) => db.prepare("SELECT actor_id, target_id, target_type, details_json FROM user_audit_events WHERE action = 'announcement-removed'").all());
  assert.equal(audit.length, 1);
  assert.equal(audit[0].target_id, classId);
  assert.equal(audit[0].target_type, "class");
  assert.equal(JSON.parse(audit[0].details_json).audience, "parents");
});

test("when the child leaves the class, the parent stops receiving its announcements", async () => {
  const studentId = fixture((db) => db.prepare("SELECT id FROM students WHERE username = ?").get("maya.notices").id);
  assert.equal((await send(`/api/classes/${classId}/students`, "DELETE", { studentId }, teacherCookie)).status, 200);
  const family = await (await send("/api/family", "GET", undefined, parentCookie)).json();
  assert.equal(family.children.length, 1);
  assert.deepEqual(family.announcements, []);
});

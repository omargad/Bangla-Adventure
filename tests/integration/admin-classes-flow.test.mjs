import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import Database from "better-sqlite3";

/**
 * Administrators work in any class from the teacher workspace: list every class
 * with its teacher, open it, manage its announcements and activities and delete
 * it (audited), while teachers keep owner-only access to the class routes.
 */

const PORT = 3223;
const BASE = `http://127.0.0.1:${PORT}`;
const stateDir = mkdtempSync(path.join(tmpdir(), "bangla-admin-classes-"));
const password = "integration-classes-password";
const className = "বাংলা ক্লাস";
let server, adminCookie, teacherCookie, otherTeacherCookie, classId, otherClassId, adminClassId, activityId, announcementId;

const cookieFrom = (response, name = "ba_adult_session") => response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`))?.split(";")[0];
const send = (route, method = "GET", body, cookie, headers = {}) => fetch(`${BASE}${route}`, { method, redirect: "manual", headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const fixture = (callback) => { const db = new Database(path.join(stateDir, "test.db")); try { return callback(db); } finally { db.close(); } };
const adultId = (email) => fixture((db) => db.prepare("SELECT id FROM adults WHERE email = ?").get(email).id);
const quiz = [{ prompt: "Which month starts the Bengali year?", options: ["Boishakh", "Poush"], answer: 0 }];

async function adult(email, role) {
  const signUp = await send("/api/auth/sign-up", "POST", { email, displayName: email.split("@")[0], password });
  assert.equal(signUp.status, 201);
  fixture((db) => db.prepare(role === "admin" ? "UPDATE adults SET role = 'admin' WHERE email = ?" : "UPDATE adults SET role = 'teacher', teacher_status = 'approved' WHERE email = ?").run(email));
  return cookieFrom(signUp);
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
  teacherCookie = await adult("class-teacher@example.com", "teacher");
  otherTeacherCookie = await adult("other-class-teacher@example.com", "teacher");
  adminCookie = await adult("class-admin@example.com", "admin");
  classId = await createClass(teacherCookie, className);
  otherClassId = await createClass(otherTeacherCookie, "Quiet class");
  adminClassId = await createClass(adminCookie, "Admin's own class");

  const activity = await send(`/api/classes/${classId}/activities`, "POST", { title: "Festivals check-in", questions: quiz }, teacherCookie);
  assert.equal(activity.status, 201);
  activityId = (await activity.json()).activity.id;
  const announcement = await send(`/api/classes/${classId}/announcements`, "POST", { body: "Read the Pohela Boishakh topic." }, teacherCookie);
  assert.equal(announcement.status, 201);
  announcementId = (await announcement.json()).announcement.id;
});
after(async () => {
  if (server && server.exitCode === null) { const closed = once(server, "exit"); server.kill("SIGTERM"); await closed; }
  rmSync(stateDir, { recursive: true, force: true });
});

test("an administrator lists every class with its teacher's name while a teacher's list is unchanged", async () => {
  const response = await send("/api/classes?scope=all", "GET", undefined, adminCookie);
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.ok(!/passwordHash|password_hash|tokenHash|scrypt:|"email"/.test(text), "no credentials or teacher emails");
  const listing = Object.fromEntries(JSON.parse(text).classes.map((item) => [item.id, item]));
  assert.equal(listing[classId].name, className);
  assert.equal(listing[classId].teacherName, "class-teacher");
  assert.equal(listing[classId].teacherId, adultId("class-teacher@example.com"));
  assert.equal(listing[classId].activityCount, 1);
  assert.equal(listing[otherClassId].teacherName, "other-class-teacher");
  assert.equal(listing[adminClassId].teacherName, "class-admin");
  assert.equal(listing[adminClassId].teacherId, adultId("class-admin@example.com"));

  const own = await (await send("/api/classes", "GET", undefined, teacherCookie)).json();
  assert.deepEqual(own.classes.map((item) => item.id), [classId]);
  assert.equal(own.classes[0].teacherName, undefined, "the teacher's listing has no teacher names");
  assert.equal((await send("/api/classes?scope=all", "GET", undefined, teacherCookie)).status, 403);
  const adminOwn = await (await send("/api/classes", "GET", undefined, adminCookie)).json();
  assert.deepEqual(adminOwn.classes.map((item) => item.id), [adminClassId], "without scope=all an administrator sees their own classes");
});

test("a teacher still gets 404 on every class route for a class they do not own", async () => {
  const routes = [
    [`/api/classes/${classId}`, "GET"],
    [`/api/classes/${classId}`, "DELETE"],
    [`/api/classes/${classId}/activities`, "POST", { title: "Intruder quiz", questions: quiz }],
    [`/api/classes/${classId}/activities`, "PATCH", { activityId, status: "closed" }],
    [`/api/classes/${classId}/activities`, "DELETE", { activityId }],
    [`/api/classes/${classId}/announcements`, "POST", { body: "Intruder note" }],
    [`/api/classes/${classId}/announcements`, "DELETE", { announcementId }],
    [`/api/classes/${classId}/grades`, "GET"],
    [`/api/classes/${classId}/grades?format=csv`, "GET"],
    [`/api/classes/${classId}/submissions`, "DELETE", { submissionId: "any" }],
  ];
  for (const [route, method, body] of routes) {
    assert.equal((await send(route, method, body, otherTeacherCookie)).status, 404, `${method} ${route}`);
  }
  assert.equal((await send(`/api/classes/${otherClassId}/activities`, "DELETE", { activityId }, otherTeacherCookie)).status, 404, "nor through their own class");
  assert.equal((await send(`/api/classes/${otherClassId}/announcements`, "DELETE", { announcementId }, otherTeacherCookie)).status, 404, "nor through their own class");

  const detail = await (await send(`/api/classes/${classId}`, "GET", undefined, teacherCookie)).json();
  assert.deepEqual(detail.activities.map((item) => [item.id, item.status]), [[activityId, "open"]], "nothing changed");
  assert.deepEqual(detail.announcements.map((item) => item.id), [announcementId]);
  fixture((db) => assert.equal(db.prepare("SELECT count(*) AS n FROM user_audit_events WHERE action = 'class-deleted'").get().n, 0));
});

test("an administrator opens another teacher's class and manages its announcements and activities", async () => {
  const opened = await send(`/api/classes/${classId}`, "GET", undefined, adminCookie);
  assert.equal(opened.status, 200);
  const detail = await opened.json();
  assert.equal(detail.class.id, classId);
  assert.equal(detail.class.name, className);
  assert.equal(detail.class.teacherId, adultId("class-teacher@example.com"));
  assert.deepEqual(detail.activities.map((item) => item.id), [activityId]);

  const posted = await send(`/api/classes/${classId}/announcements`, "POST", { body: "Bring a festival photo." }, adminCookie);
  assert.equal(posted.status, 201);
  const noteId = (await posted.json()).announcement.id;
  const teacherView = await (await send(`/api/classes/${classId}`, "GET", undefined, teacherCookie)).json();
  assert.ok(teacherView.announcements.some((item) => item.id === noteId && item.body === "Bring a festival photo."), "the owning teacher sees it");
  assert.equal((await send(`/api/classes/${classId}/announcements`, "DELETE", { announcementId: noteId }, adminCookie)).status, 200);
  assert.equal((await send(`/api/classes/${classId}/announcements`, "DELETE", { announcementId: noteId }, adminCookie)).status, 404, "already removed");

  const created = await send(`/api/classes/${classId}/activities`, "POST", { title: "Numbers check-in", questions: quiz }, adminCookie);
  assert.equal(created.status, 201);
  const newActivityId = (await created.json()).activity.id;
  const closed = await send(`/api/classes/${classId}/activities`, "PATCH", { activityId: newActivityId, status: "closed" }, adminCookie);
  assert.equal(closed.status, 200);
  assert.equal((await closed.json()).status, "closed");
  assert.equal((await send(`/api/classes/${classId}/activities`, "DELETE", { activityId: newActivityId }, adminCookie)).status, 200);
  assert.equal((await send(`/api/classes/${otherClassId}/activities`, "DELETE", { activityId }, adminCookie)).status, 404, "the activity must belong to the class");

  const final = await (await send(`/api/classes/${classId}`, "GET", undefined, adminCookie)).json();
  assert.deepEqual(final.activities.map((item) => item.id), [activityId]);
  assert.deepEqual(final.announcements.map((item) => item.id), [announcementId]);
  assert.equal((await send(`/api/classes/${classId}/grades`, "GET", undefined, adminCookie)).status, 200);
});

test("the grades CSV of a Bangla-only class downloads under an ASCII fallback and its UTF-8 name", async () => {
  for (const cookie of [adminCookie, teacherCookie]) {
    const csv = await send(`/api/classes/${classId}/grades?format=csv`, "GET", undefined, cookie);
    assert.equal(csv.status, 200);
    const disposition = csv.headers.get("content-disposition");
    const match = /^attachment; filename="([^"]+)"; filename\*=UTF-8''(\S+)$/.exec(disposition);
    assert.ok(match, disposition);
    assert.equal(match[1], "class-grades.csv", "a non-empty ASCII file name");
    assert.equal(decodeURIComponent(match[2]), `${className}-grades.csv`, "the class name in UTF-8");
    assert.match((await csv.text()).split("\n")[0], /^"Class","Activity","Student"/);
  }
});

test("an administrator deletes another teacher's class and the deletion is audited", async () => {
  assert.equal((await send(`/api/classes/${classId}`, "DELETE", undefined, adminCookie, { Origin: "https://other.example" })).status, 403);
  const deleted = await send(`/api/classes/${classId}`, "DELETE", undefined, adminCookie);
  assert.equal(deleted.status, 200);
  assert.equal((await send(`/api/classes/${classId}`, "GET", undefined, teacherCookie)).status, 404);
  assert.equal((await send(`/api/classes/${classId}`, "DELETE", undefined, adminCookie)).status, 404, "already deleted");
  assert.deepEqual((await (await send("/api/classes", "GET", undefined, teacherCookie)).json()).classes, []);

  assert.equal((await send(`/api/classes/${otherClassId}`, "DELETE", undefined, otherTeacherCookie)).status, 200, "a teacher deletes their own class");
  fixture((db) => {
    const audits = db.prepare("SELECT * FROM user_audit_events WHERE action = 'class-deleted' ORDER BY created_at, rowid").all();
    assert.equal(audits.length, 2);
    const [byAdmin, byTeacher] = audits;
    assert.equal(byAdmin.actor_id, adultId("class-admin@example.com"));
    assert.equal(byAdmin.target_type, "class");
    assert.equal(byAdmin.target_id, classId);
    assert.deepEqual(JSON.parse(byAdmin.details_json), { classId, name: className, teacherId: adultId("class-teacher@example.com") });
    assert.equal(byTeacher.actor_id, adultId("other-class-teacher@example.com"));
    assert.deepEqual(JSON.parse(byTeacher.details_json), { classId: otherClassId, name: "Quiet class", teacherId: adultId("other-class-teacher@example.com") });
    assert.equal(db.prepare("SELECT count(*) AS n FROM class_activities WHERE class_id = ?").get(classId).n, 0, "the class's activities went with it");
  });
});

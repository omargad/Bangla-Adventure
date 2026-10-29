import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import Database from "better-sqlite3";

/**
 * Attendance and the results gradebook: a teacher ticks who was present on a date and saves (saving
 * the date again updates it), parents, students and administrators see "attended X of Y", another
 * teacher cannot read or write it, a student removed from the class leaves the roster, results,
 * counts and exports, and a student added later is not recorded for sessions before they joined.
 */

const PORT = 3234;
const BASE = `http://127.0.0.1:${PORT}`;
const stateDir = mkdtempSync(path.join(tmpdir(), "bangla-attendance-"));
const password = "integration-attendance-password";
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const today = day(0), lastWeek = day(-7);
let server, adminCookie, teacherCookie, otherTeacherCookie, parentCookie, classId, otherClassId, activityId;
const ids = {}, studentCookies = {};

const cookieFrom = (response, name = "ba_adult_session") => response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`))?.split(";")[0];
const send = (route, method = "GET", body, cookie, headers = {}) => fetch(`${BASE}${route}`, { method, redirect: "manual", headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const fixture = (callback) => { const db = new Database(path.join(stateDir, "test.db")); try { return callback(db); } finally { db.close(); } };
const device = (name) => ({ "x-forwarded-for": `attendance-${name}` });
const sheet = (date, cookie = teacherCookie, target = classId) => send(`/api/classes/${target}/attendance?${new URLSearchParams({ date })}`, "GET", undefined, cookie);
const save = (date, absent, cookie = teacherCookie, target = classId, who = ["arif", "maya", "nadia"]) => send(`/api/classes/${target}/attendance`, "PUT", { date, marks: who.map((name) => ({ studentId: ids[name], present: !absent.includes(name) })) }, cookie);

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
async function student(name, displayName) {
  const created = await send("/api/student/sign-up", "POST", { username: `${name}.attend`, displayName, password }, undefined, device(name));
  assert.equal(created.status, 201);
  ids[name] = (await created.json()).student.id;
  fixture((db) => db.prepare("UPDATE students SET approval_status = 'approved' WHERE id = ?").run(ids[name]));
  studentCookies[name] = cookieFrom(await send("/api/student/sign-in", "POST", { username: `${name}.attend`, password }, undefined, device(name)), "ba_student_session");
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
  adminCookie = await adult("attendance-admin@example.com", "admin");
  teacherCookie = await adult("attendance-teacher@example.com", "teacher");
  otherTeacherCookie = await adult("attendance-other@example.com", "teacher");
  parentCookie = await adult("attendance-parent@example.com", "parent");
  classId = await createClass(teacherCookie, "Attendance class");
  otherClassId = await createClass(otherTeacherCookie, "Other class");
  await student("maya", "Maya");
  await student("arif", "Arif");
  await student("nadia", "Nadia");
  assert.equal((await send(`/api/classes/${classId}/students`, "POST", { studentIds: [ids.maya, ids.arif, ids.nadia] }, teacherCookie)).status, 200);
  assert.equal((await send("/api/admin/family-links", "POST", { studentId: ids.maya, parentEmail: "attendance-parent@example.com", confirmed: true }, adminCookie)).status, 200);
  const activity = await send(`/api/classes/${classId}/activities`, "POST", { title: "Festivals check-in", questions: [
    { prompt: "Which month starts the Bengali year?", options: ["Boishakh", "Poush"], answer: 0 },
    { prompt: "What do shops open on Pohela Boishakh?", options: ["Halkhata", "Umbrellas"], answer: 0 },
  ] }, teacherCookie);
  assert.equal(activity.status, 201);
  activityId = (await activity.json()).activity.id;
  for (const [name, answers] of [["maya", [0, 1]], ["nadia", [0, 0]]]) {
    assert.equal((await send("/api/student/submit", "POST", { activityId, answers }, studentCookies[name], device(name))).status, 200);
  }
});
after(async () => {
  if (server && server.exitCode === null) { const closed = once(server, "exit"); server.kill("SIGTERM"); await closed; }
  rmSync(stateDir, { recursive: true, force: true });
});

test("a teacher opens today's attendance with every student ticked present, then saves one absent", async () => {
  const opened = await sheet(today);
  assert.equal(opened.status, 200);
  const data = await opened.json();
  assert.equal(data.date, today);
  assert.equal(data.saved, null);
  assert.deepEqual(data.students.map((row) => [row.displayName, row.username, row.present]), [["Arif", "arif.attend", true], ["Maya", "maya.attend", true], ["Nadia", "nadia.attend", true]]);
  assert.ok(!/passwordHash|password_hash|tokenHash/.test(JSON.stringify(data)));

  const saved = await save(today, ["arif"]);
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { date: today, saved: 3, present: 2 });
  const reopened = await (await sheet(today)).json();
  assert.deepEqual(reopened.students.map((row) => [row.displayName, row.present, row.saved]), [["Arif", false, true], ["Maya", true, true], ["Nadia", true, true]]);
  assert.equal(reopened.saved.recordedBy, "attendance-teacher");
  assert.deepEqual(reopened.sessions, [{ date: today, present: 2, marked: 3 }]);
});

test("saving the same date again updates it, and another date is a second session", async () => {
  assert.equal((await save(today, ["arif", "nadia"])).status, 200);
  assert.equal(fixture((db) => db.prepare("SELECT count(*) AS n FROM class_attendance WHERE class_id = ? AND session_date = ?").get(classId, today).n), 3, "no duplicate marks");
  assert.equal((await save(lastWeek, [], adminCookie)).status, 200, "an administrator can take attendance in any class");
  const data = await (await sheet(today)).json();
  assert.deepEqual(data.students.map((row) => [row.displayName, row.present]), [["Arif", false], ["Maya", true], ["Nadia", false]]);
  assert.deepEqual(Object.fromEntries(data.students.map((row) => [row.displayName, row.attendance])), {
    Arif: { attended: 1, recorded: 2 }, Maya: { attended: 2, recorded: 2 }, Nadia: { attended: 1, recorded: 2 },
  });
  assert.deepEqual(data.sessions.map((session) => [session.date, session.present]), [[today, 1], [lastWeek, 3]]);
  fixture((db) => {
    const recorders = db.prepare("SELECT a.email, c.session_date FROM class_attendance c JOIN adults a ON a.id = c.recorded_by WHERE c.class_id = ? GROUP BY c.session_date").all(classId);
    assert.deepEqual(Object.fromEntries(recorders.map((row) => [row.session_date, row.email])), { [today]: "attendance-teacher@example.com", [lastWeek]: "attendance-admin@example.com" });
  });
});

test("bad dates and incomplete or unknown marks are refused with Bangla copies", async () => {
  for (const date of ["", "2026-02-30", "yesterday", day(3)]) {
    const response = await sheet(date);
    assert.equal(response.status, 400, date);
    assert.ok((await response.json()).errorBn);
  }
  assert.equal((await save(day(3), [])).status, 400, "no future sessions");
  assert.equal((await send(`/api/classes/${classId}/attendance`, "PUT", { date: today, marks: [] }, teacherCookie)).status, 400);
  assert.equal((await send(`/api/classes/${classId}/attendance`, "PUT", { date: today, marks: [{ studentId: ids.maya, present: "yes" }] }, teacherCookie)).status, 400);
  const partial = await save(day(-2), [], teacherCookie, classId, ["maya"]);
  assert.equal(partial.status, 409, "the first save of a date covers everyone in the class");
  assert.ok((await partial.json()).errorBn);
  const untouched = await sheet(day(-2));
  assert.equal(untouched.status, 200);
  assert.equal((await untouched.json()).saved, null, "a refused save writes nothing");
  assert.equal((await send(`/api/classes/${classId}/attendance`, "PUT", { date: today, marks: [...["arif", "maya", "nadia"].map((name) => ({ studentId: ids[name], present: true })), { studentId: "stranger", present: true }] }, teacherCookie)).status, 409);
  assert.deepEqual((await (await sheet(today)).json()).students.map((row) => row.present), [false, true, false], "nothing changed");
});

test("another teacher, a parent, a student or a stranger cannot read or write a class's attendance", async () => {
  assert.equal((await sheet(today, otherTeacherCookie)).status, 404);
  assert.equal((await save(today, [], otherTeacherCookie)).status, 404);
  assert.equal((await sheet(today, parentCookie)).status, 403);
  assert.equal((await save(today, [], parentCookie)).status, 403);
  assert.equal((await sheet(today, studentCookies.maya)).status, 401);
  assert.equal((await sheet(today, null)).status, 401);
  assert.equal((await send(`/api/classes/${classId}/attendance`, "PUT", { date: today, marks: [] }, teacherCookie, { Origin: "https://other.example" })).status, 403);
  assert.deepEqual((await (await sheet(today)).json()).students.map((row) => row.present), [false, true, false]);
  const own = await (await sheet(today, otherTeacherCookie, otherClassId)).json();
  assert.deepEqual(own.students, [], "their own empty class");
});

test("the parent, the student and the administrator see attended X of Y", async () => {
  const family = await (await send("/api/family", "GET", undefined, parentCookie)).json();
  const [maya] = family.children;
  assert.deepEqual(maya.classes.map((item) => [item.name, item.attendance]), [["Attendance class", { attended: 2, recorded: 2 }]]);
  assert.deepEqual([maya.metrics.attendedSessions, maya.metrics.recordedSessions], [2, 2]);
  assert.ok(!JSON.stringify(family).includes("Arif"), "only the linked child");

  const feed = await (await send("/api/student/feed", "GET", undefined, studentCookies.arif)).json();
  assert.deepEqual([feed.metrics.attendedSessions, feed.metrics.recordedSessions], [1, 2]);
  assert.deepEqual(feed.classes[0].attendance, { attended: 1, recorded: 2 });

  const listing = await (await send("/api/admin/results", "GET", undefined, adminCookie)).json();
  assert.equal(listing.classes.find((item) => item.id === classId).attendancePercent, 67, "4 of 6 marks present");
  assert.equal(listing.classes.find((item) => item.id === otherClassId).attendancePercent, null);
});

test("the gradebook shows each student's work, done, average and attendance, and missing work as empty", async () => {
  const { gradebook } = await (await send(`/api/classes/${classId}/grades`, "GET", undefined, teacherCookie)).json();
  assert.deepEqual(gradebook.activities.map((activity) => activity.title), ["Festivals check-in"]);
  assert.deepEqual(gradebook.rows.map((row) => [row.student.displayName, row.cells[0] && `${row.cells[0].score}/${row.cells[0].total}`, row.done, row.averagePercent, row.attendance]), [
    ["Arif", null, 0, null, { attended: 1, recorded: 2 }],
    ["Maya", "1/2", 1, 50, { attended: 2, recorded: 2 }],
    ["Nadia", "2/2", 1, 100, { attended: 1, recorded: 2 }],
  ]);
  const csv = (await (await send(`/api/classes/${classId}/grades?format=csv`, "GET", undefined, teacherCookie)).text()).split("\n");
  assert.equal(csv[0], '"Class","Activity","Student","Score","Total","Percent","Submitted At","Done","Attendance"');
  assert.equal(csv[1], '"Attendance class","","Arif","","","","","0 of 1","1 of 2"');
  assert.match(csv[2], /^"Attendance class","Festivals check-in","Maya","1","2","50","[^"]+","1 of 1","2 of 2"$/);
  assert.match(csv[3], /^"Attendance class","Festivals check-in","Nadia","2","2","100",/);
});

test("a removed student leaves the roster, results, counts, averages, exports and attendance, but keeps their history", async () => {
  assert.equal((await send(`/api/classes/${classId}/students`, "DELETE", { studentId: ids.nadia }, teacherCookie)).status, 200);
  const roster = await (await send(`/api/classes/${classId}/students`, "GET", undefined, teacherCookie)).json();
  assert.deepEqual(roster.students.map((row) => row.displayName), ["Arif", "Maya"]);
  const detail = await (await send(`/api/classes/${classId}`, "GET", undefined, teacherCookie)).json();
  assert.deepEqual(detail.students.map((row) => row.displayName), ["Arif", "Maya"]);
  assert.deepEqual(detail.activities[0].submissions.map((row) => row.studentName), ["Maya"]);
  const classes = await (await send("/api/classes", "GET", undefined, teacherCookie)).json();
  assert.deepEqual([classes.classes[0].studentCount, classes.classes[0].submissionCount], [2, 1]);
  const { rows, gradebook } = await (await send(`/api/classes/${classId}/grades`, "GET", undefined, teacherCookie)).json();
  assert.deepEqual(rows.map((row) => row.studentName), ["Maya"]);
  assert.deepEqual(gradebook.rows.map((row) => row.student.displayName), ["Arif", "Maya"]);
  const csv = await (await send(`/api/classes/${classId}/grades?format=csv`, "GET", undefined, teacherCookie)).text();
  assert.ok(!csv.includes("Nadia"));
  const listing = (await (await send("/api/admin/results", "GET", undefined, adminCookie)).json()).classes.find((item) => item.id === classId);
  assert.deepEqual([listing.studentCount, listing.submissionCount, listing.averagePercent, listing.attendancePercent], [2, 1, 50, 75]);
  assert.deepEqual((await (await sheet(today)).json()).students.map((row) => row.displayName), ["Arif", "Maya"]);
  assert.equal((await save(today, [])).status, 409, "the old sheet with Nadia is refused");
  assert.equal((await save(today, [], teacherCookie, classId, ["arif", "maya"])).status, 200);
  fixture((db) => {
    assert.equal(db.prepare("SELECT count(*) AS n FROM class_attendance WHERE student_id = ?").get(ids.nadia).n, 2, "her attendance is kept");
    assert.equal(db.prepare("SELECT count(*) AS n FROM activity_submissions s JOIN student_class_enrollments e ON e.class_student_id = s.student_id WHERE e.student_id = ?").get(ids.nadia).n, 1, "and her work");
  });
  // Added back, she returns with her history.
  assert.equal((await send(`/api/classes/${classId}/students`, "POST", { studentIds: [ids.nadia] }, teacherCookie)).status, 200);
  const restored = await (await send(`/api/classes/${classId}/grades`, "GET", undefined, teacherCookie)).json();
  assert.deepEqual(restored.gradebook.rows.find((row) => row.student.displayName === "Nadia").attendance, { attended: 1, recorded: 2 });
});

test("a student added after a saved date is not recorded for it when the teacher corrects that date", async () => {
  await student("zara", "Zara");
  assert.equal((await send(`/api/classes/${classId}/students`, "POST", { studentIds: [ids.zara] }, teacherCookie)).status, 200);
  const before = await (await sheet(lastWeek)).json();
  assert.deepEqual(before.students.map((row) => [row.displayName, row.present, row.saved]), [["Arif", true, true], ["Maya", true, true], ["Nadia", true, true], ["Zara", null, false]], "she is not ticked present for a session before she joined");

  const corrected = await save(lastWeek, ["arif"]);
  assert.equal(corrected.status, 200, "a correction need not include her");
  assert.deepEqual(await corrected.json(), { date: lastWeek, saved: 3, present: 2 });
  fixture((db) => assert.equal(db.prepare("SELECT count(*) AS n FROM class_attendance WHERE student_id = ? AND session_date = ?").get(ids.zara, lastWeek).n, 0, "no mark for Zara on that date"));
  const after = await (await sheet(lastWeek)).json();
  assert.deepEqual(after.students.map((row) => [row.displayName, row.present]), [["Arif", false], ["Maya", true], ["Nadia", true], ["Zara", null]]);
  assert.deepEqual(after.students.find((row) => row.displayName === "Zara").attendance, { attended: 0, recorded: 0 });
  const feed = await (await send("/api/student/feed", "GET", undefined, studentCookies.zara)).json();
  assert.deepEqual([feed.metrics.attendedSessions, feed.metrics.recordedSessions], [0, 0], "her own page shows no sessions");

  assert.equal((await save(today, [], teacherCookie, classId, ["zara"])).status, 200, "the teacher can still add her to a date she attended");
  assert.deepEqual((await (await send("/api/student/feed", "GET", undefined, studentCookies.zara)).json()).classes[0].attendance, { attended: 1, recorded: 1 });
  assert.equal((await save(day(-1), [])).status, 409, "a new date still needs every student, Zara included");
  assert.equal((await save(day(-1), [], teacherCookie, classId, ["arif", "maya", "nadia", "zara"])).status, 200);
});

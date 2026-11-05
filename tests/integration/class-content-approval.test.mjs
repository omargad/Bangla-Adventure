import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import Database from "better-sqlite3";

const PORT = 3276;
const BASE = `http://127.0.0.1:${PORT}`;
const stateDir = mkdtempSync(path.join(tmpdir(), "bangla-class-content-approval-"));
const password = "class-content-approval-fixture";
const legacyToken = "isolated-class-content-fixture-token";
const legacyHeaders = { "x-student-token": legacyToken };
let server, adminCookie, teacherCookie, otherTeacherCookie, parentCookie, studentCookie, adminId, classId, studentId;

const fixture = (callback) => { const db = new Database(path.join(stateDir, "test.db")); try { return callback(db); } finally { db.close(); } };
const cookieFrom = (response, name = "ba_adult_session") => response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`) && !value.startsWith(`${name}=;`))?.split(";")[0];
const send = (route, method = "GET", body, cookie, headers = {}) => fetch(`${BASE}${route}`, {
  method, redirect: "manual", headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});
async function json(route, cookie, headers) {
  const response = await send(route, "GET", undefined, cookie, headers);
  assert.equal(response.status, 200, route);
  return response.json();
}
async function adult(name, role) {
  const email = `${name}@example.com`, headers = { "x-forwarded-for": name };
  assert.equal((await send("/api/auth/sign-up", "POST", { email, displayName: name, password }, undefined, headers)).status, 201);
  fixture((db) => db.prepare("UPDATE adults SET role = ?, teacher_status = ?, approval_status = 'approved' WHERE email = ?").run(role, role === "teacher" ? "approved" : "none", email));
  const response = await send("/api/auth/sign-in", "POST", { email, password }, undefined, headers);
  assert.equal(response.status, 200);
  return cookieFrom(response);
}
async function createActivity(title, cookie = teacherCookie, extra = {}) {
  const response = await send(`/api/classes/${classId}/activities`, "POST", {
    title, instructions: "Read the class's river story before answering.",
    questions: [{ prompt: "Which one is a river?", options: ["Padma", "Mountain"], answer: 0 }],
    ...extra,
  }, cookie);
  assert.equal(response.status, 201);
  return (await response.json()).activity;
}
async function createSource(titleEn, cookie = teacherCookie, extra = {}) {
  const response = await send(`/api/classes/${classId}/sources`, "POST", { titleEn, url: `https://example.org/${encodeURIComponent(titleEn)}`, note: "A reading chosen for Sunday's class.", ...extra }, cookie);
  assert.equal(response.status, 201);
  return (await response.json()).source;
}
const review = (kind, item, approvalStatus, cookie = adminCookie, extra = {}) => send(`/api/classes/${classId}/${kind}`, "PATCH", {
  [kind === "activities" ? "activityId" : "sourceId"]: item.id, approvalStatus, revision: item.revision, ...extra,
}, cookie);
const stored = (table, id) => fixture((db) => db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id));
const submissions = (id) => fixture((db) => db.prepare("SELECT * FROM activity_submissions WHERE activity_id = ? ORDER BY id").all(id));
async function assertLegacyRetired(activity) {
  const before = submissions(activity.id);
  for (const [route, method, body] of [["/api/classroom/feed", "GET", undefined], ["/api/classroom/submit", "POST", { activityId: activity.id, answers: [0] }]]) {
    const response = await send(route, method, body, undefined, legacyHeaders);
    assert.equal(response.status, 410, `${route} stays retired even with an existing class token`);
    const data = await response.json();
    assert.match(data.error, /retired/);
    assert.equal(JSON.stringify(data).includes(activity.id), false, "the retired endpoint discloses no activity");
    assert.equal(JSON.stringify(data).includes('"answer"'), false, "the retired endpoint discloses no answer key");
  }
  assert.deepEqual(submissions(activity.id), before, "retired access cannot create or replace a submission");
}

before(async () => {
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(PORT)], {
    cwd: new URL("../..", import.meta.url).pathname,
    env: { ...process.env, NODE_ENV: "production", PLATFORM_MODE: "legacy", DATABASE_PATH: path.join(stateDir, "test.db"), MEDIA_ROOT: path.join(stateDir, "media") }, stdio: "ignore",
  });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) { ready = true; break; } } catch { if (server.exitCode !== null) break; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(ready, "isolated production server becomes ready");
  adminCookie = await adult("content-admin", "admin");
  teacherCookie = await adult("content-teacher", "teacher");
  otherTeacherCookie = await adult("content-other-teacher", "teacher");
  parentCookie = await adult("content-parent", "parent");
  adminId = fixture((db) => db.prepare("SELECT id FROM adults WHERE email = 'content-admin@example.com'").get().id);
  const headers = { "x-forwarded-for": "content-student" };
  const signup = await send("/api/student/sign-up", "POST", { username: "content-student", displayName: "Demo learner", password }, undefined, headers);
  assert.equal(signup.status, 201);
  studentId = (await signup.json()).student.id;
  fixture((db) => db.prepare("UPDATE students SET approval_status = 'approved' WHERE id = ?").run(studentId));
  const login = await send("/api/student/sign-in", "POST", { username: "content-student", password }, undefined, headers);
  assert.equal(login.status, 200);
  studentCookie = cookieFrom(login, "ba_student_session");
  const created = await send("/api/classes", "POST", { name: "Sunday river stories" }, teacherCookie);
  assert.equal(created.status, 201);
  classId = (await created.json()).class.id;
  assert.equal((await send(`/api/classes/${classId}/students`, "POST", { studentIds: [studentId] }, teacherCookie)).status, 200);
  assert.equal((await send("/api/admin/family-links", "POST", { studentId, parentEmail: "content-parent@example.com", confirmed: true }, adminCookie)).status, 200);
  fixture((db) => db.prepare("UPDATE class_students SET token_hash = ? WHERE id = (SELECT class_student_id FROM student_class_enrollments WHERE student_id = ? AND class_id = ?)").run(createHash("sha256").update(legacyToken).digest("hex"), studentId, classId));
});
after(async () => {
  if (server && server.exitCode === null) { const closed = once(server, "exit"); server.kill("SIGTERM"); await closed; }
  rmSync(stateDir, { recursive: true, force: true });
});

test("teacher content stays pending and cannot be self-approved or reached through known activity IDs", async () => {
  const forged = { approvalStatus: "approved", reviewedBy: adminId, reviewedAt: "2026-01-01T00:00:00Z" };
  const activity = await createActivity("Pending river quiz", teacherCookie, forged);
  const source = await createSource("Pending river reading", teacherCookie, forged);
  for (const [kind, item, table] of [["activities", activity, "class_activities"], ["sources", source, "class_sources"]]) {
    assert.equal(item.approvalStatus, "pending");
    assert.equal(item.revision, 1);
    assert.equal(item.reviewedBy, null);
    assert.equal(item.reviewedAt, null);
    const before = stored(table, item.id);
    for (const [cookie, status] of [[teacherCookie, 403], [otherTeacherCookie, 404]]) {
      assert.equal((await review(kind, item, "approved", cookie)).status, status, `${kind}: teacher cannot approve`);
      assert.equal((await review(kind, item, "rejected", cookie, { reviewNote: "Forged review" })).status, status, `${kind}: teacher cannot reject`);
    }
    assert.deepEqual(stored(table, item.id), before, "forbidden reviews do not modify content or review metadata");
    assert.equal((await review(kind, item, "approved", adminCookie, { revision: item.revision + 1 })).status, 409, "Admin review must match the loaded revision");
    assert.equal((await review(kind, item, "rejected")).status, 400, "rejection needs feedback for the teacher");
    assert.deepEqual(stored(table, item.id), before, "invalid reviews leave the pending revision intact");
  }
  const feed = await json("/api/student/feed", studentCookie);
  assert.equal(feed.classes.find((item) => item.id === classId).activities.some((item) => item.id === activity.id), false);
  assert.equal(feed.classes.find((item) => item.id === classId).sources.some((item) => item.id === source.id), false);
  assert.equal(JSON.stringify(await json("/api/family", parentCookie)).includes(activity.id), false);
  assert.equal(JSON.stringify(await json("/api/family/sources", parentCookie)).includes(source.id), false);
  await assertLegacyRetired(activity);
  const refused = await send("/api/student/submit", "POST", { activityId: activity.id, answers: [0] }, studentCookie);
  assert.equal(refused.status, 404, "knowing a pending activity ID cannot bypass approval");
  assert.equal(JSON.stringify(await refused.json()).includes('"answer"'), false);
  assert.deepEqual(submissions(activity.id), []);
});

test("an Admin review publishes the exact revision to the student and linked parent while class-code access stays retired", async () => {
  const activity = await createActivity("Approved river quiz");
  const source = await createSource("Approved river reading");
  for (const [kind, item, table] of [["activities", activity, "class_activities"], ["sources", source, "class_sources"]]) {
    assert.equal((await review(kind, item, "approved", adminCookie, { reviewNote: "Checked the lesson and reference." })).status, 200);
    const row = stored(table, item.id);
    assert.equal(row.approval_status, "approved");
    assert.equal(row.reviewed_by, adminId);
    assert.ok(row.reviewed_at);
  }
  const feed = await json("/api/student/feed", studentCookie);
  const ownClass = feed.classes.find((item) => item.id === classId);
  assert.ok(ownClass.activities.some((item) => item.id === activity.id));
  assert.ok(ownClass.sources.some((item) => item.id === source.id));
  assert.equal(JSON.stringify(feed).includes('"answer"'), false, "approval never exposes the answer key");
  await assertLegacyRetired(activity);
  assert.ok((await json("/api/family/sources", parentCookie)).classes[classId].some((item) => item.id === source.id));
  const submitted = await send("/api/student/submit", "POST", { activityId: activity.id, answers: [0] }, studentCookie);
  assert.equal(submitted.status, 200);
  assert.equal((await submitted.json()).score, 1);
  assert.ok((await json("/api/student/results", studentCookie)).results.some((item) => item.activityId === activity.id && item.score === 1));
  const family = await json("/api/family", parentCookie);
  const parentActivity = family.children.find((child) => child.id === studentId).classes.find((item) => item.id === classId).activities.find((item) => item.id === activity.id);
  assert.equal(parentActivity.submission.score, 1);
});

test("editing an approved source requires a fresh Admin review and rejects a stale reviewed revision", async () => {
  const source = await createSource("River reading before edit");
  assert.equal((await review("sources", source, "approved")).status, 200);
  const approvedRevision = stored("class_sources", source.id).revision;
  const edited = await send(`/api/classes/${classId}/sources`, "PATCH", { sourceId: source.id, titleEn: "Updated river reading", url: "https://example.org/updated-river-reading", note: "New page requires another check." }, teacherCookie);
  assert.equal(edited.status, 200);
  const next = (await edited.json()).source;
  assert.equal(next.revision, approvedRevision + 1);
  assert.equal(next.approvalStatus, "pending");
  assert.equal(next.reviewedBy, null);
  assert.equal(next.reviewedAt, null);
  assert.equal(JSON.stringify(await json("/api/student/feed", studentCookie)).includes(next.url), false);
  assert.equal(JSON.stringify(await json("/api/family/sources", parentCookie)).includes(next.url), false);
  const before = stored("class_sources", source.id);
  assert.equal((await review("sources", { ...source, revision: approvedRevision }, "approved")).status, 409, "a stale preview must not approve changed text or URLs");
  assert.deepEqual(stored("class_sources", source.id), before);
  assert.equal((await review("sources", next, "approved")).status, 200);
  assert.ok((await json("/api/family/sources", parentCookie)).classes[classId].some((item) => item.id === next.id && item.url === next.url));
});

test("rejected activity content and existing results are hidden without deleting work, and reopening cannot bypass review", async () => {
  const activity = await createActivity("Quiz awaiting corrections");
  assert.equal((await review("activities", activity, "approved")).status, 200);
  assert.equal((await send("/api/student/submit", "POST", { activityId: activity.id, answers: [0] }, studentCookie)).status, 200);
  const work = submissions(activity.id);
  assert.equal(work.length, 1);
  const reviewed = { ...activity, revision: stored("class_activities", activity.id).revision };
  assert.equal((await review("activities", reviewed, "rejected", adminCookie, { reviewNote: "Correct the reading instructions before reuse." })).status, 200);
  assert.equal((await send(`/api/classes/${classId}/activities`, "PATCH", { activityId: activity.id, status: "open" }, teacherCookie)).status, 200);
  for (const [route, cookie] of [["/api/student/feed", studentCookie], ["/api/student/results", studentCookie], ["/api/family", parentCookie]]) {
    assert.equal(JSON.stringify(await json(route, cookie)).includes(activity.id), false, `${route} hides rejected content`);
  }
  await assertLegacyRetired(activity);
  assert.equal((await send("/api/student/submit", "POST", { activityId: activity.id, answers: [1] }, studentCookie)).status, 404);
  assert.deepEqual(submissions(activity.id), work, "held work remains intact for the teacher and later review");
  assert.equal((await review("activities", activity, "approved", teacherCookie)).status, 403);
  assert.equal((await review("activities", { ...activity, revision: stored("class_activities", activity.id).revision }, "approved")).status, 200);
  assert.ok((await json("/api/student/results", studentCookie)).results.some((item) => item.activityId === activity.id));
});

test("Admin-authored class content records real approval provenance and reaches readers immediately", async () => {
  const activity = await createActivity("Admin checked river quiz", adminCookie);
  const source = await createSource("Admin checked river reading", adminCookie);
  for (const item of [activity, source]) {
    assert.equal(item.approvalStatus, "approved");
    assert.equal(item.reviewedBy, adminId);
    assert.ok(item.reviewedAt);
  }
  const ownClass = (await json("/api/student/feed", studentCookie)).classes.find((item) => item.id === classId);
  assert.ok(ownClass.activities.some((item) => item.id === activity.id));
  assert.ok(ownClass.sources.some((item) => item.id === source.id));
});

test("source review notes and reviewer metadata stay with staff and never reach student or parent payloads", async () => {
  const source = await createSource("River source with a private review");
  const reviewNote = "STAFF-ONLY-review-note-7f4d: verify the next edition before reuse.";
  assert.equal((await review("sources", source, "approved", adminCookie, { reviewNote })).status, 200);
  for (const cookie of [teacherCookie, adminCookie]) {
    const managed = (await json(`/api/classes/${classId}/sources`, cookie)).sources.find((item) => item.id === source.id);
    assert.equal(managed.approvalStatus, "approved");
    assert.equal(managed.reviewNote, reviewNote);
    assert.equal(managed.reviewedBy, adminId);
    assert.ok(managed.reviewedAt);
    assert.equal(managed.revision, stored("class_sources", source.id).revision);
  }
  const studentSource = (await json("/api/student/feed", studentCookie)).classes.find((item) => item.id === classId).sources.find((item) => item.id === source.id);
  const parentSource = (await json("/api/family/sources", parentCookie)).classes[classId].find((item) => item.id === source.id);
  for (const item of [studentSource, parentSource]) {
    assert.ok(item, "readers still receive the approved reference");
    assert.equal(item.titleEn, source.titleEn);
    assert.equal(item.url, source.url);
    assert.equal(item.note, source.note, "the teacher's learner-facing reading note remains available");
    for (const field of ["approvalStatus", "revision", "reviewedBy", "reviewedAt", "reviewNote"]) assert.equal(Object.hasOwn(item, field), false, `${field} is staff-only`);
    assert.equal(JSON.stringify(item).includes(reviewNote), false);
    assert.equal(JSON.stringify(item).includes(adminId), false);
  }
  // References passes studentClassSources directly to a client component, so
  // inspect the serialized server response as well as the JSON endpoints.
  const references = await send("/references", "GET", undefined, studentCookie);
  assert.equal(references.status, 200);
  const html = await references.text();
  assert.ok(html.includes(source.titleEn));
  assert.equal(html.includes(reviewNote), false);
  assert.equal(html.includes(adminId), false);
  for (const field of ["reviewedBy", "reviewedAt", "reviewNote"]) assert.equal(html.includes(field), false, `References does not serialize ${field}`);
});

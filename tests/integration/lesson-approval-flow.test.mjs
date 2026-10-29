import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import Database from "better-sqlite3";

/**
 * The shared lesson approval against the production server: a teacher withdraws
 * a lesson and students can no longer open it (lesson list, ?module= link,
 * audio, worksheet), new assignments and progress for it are refused and parents
 * stop seeing its assignments; another teacher re-approves it and everything
 * comes back. Recordings waiting for review play for staff only, and a video a
 * teacher marks unsuitable disappears from the learner lesson.
 */

const PORT = 3261;
const BASE = `http://127.0.0.1:${PORT}`;
const stateDir = mkdtempSync(path.join(tmpdir(), "bangla-lessons-"));
const password = "integration-lessons-password";
let server, adminCookie, teacherCookie, colleagueCookie, parentCookie, studentCookie;

const cookieFrom = (response, name = "ba_adult_session") => response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`) && !value.startsWith(`${name}=;`))?.split(";")[0];
const send = (route, method = "GET", body, cookie, headers = {}) => fetch(`${BASE}${route}`, { method, redirect: "manual", headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const fixture = (callback) => { const db = new Database(path.join(stateDir, "test.db")); try { return callback(db); } finally { db.close(); } };
/** Self sign-up may need an administrator's approval; approve it directly when the column exists. */
const approveAccount = (table, column, value) => fixture((db) => {
  if (db.prepare(`PRAGMA table_info(${table})`).all().some((item) => item.name === "approval_status")) db.prepare(`UPDATE ${table} SET approval_status = 'approved' WHERE ${column} = ?`).run(value);
});
const html = async (route, cookie) => { const response = await send(route, "GET", undefined, cookie); assert.equal(response.status, 200, route); return response.text(); };
const decide = (lessonId, body, cookie) => send(`/api/studio/lessons/${lessonId}`, "POST", body, cookie);

async function adult(email, role) {
  assert.equal((await send("/api/auth/sign-up", "POST", { email, displayName: email.split("@")[0], password }, undefined, { "x-forwarded-for": email })).status, 201);
  approveAccount("adults", "email", email);
  if (role === "admin") fixture((db) => db.prepare("UPDATE adults SET role = 'admin' WHERE email = ?").run(email));
  if (role === "teacher") fixture((db) => db.prepare("UPDATE adults SET role = 'teacher', teacher_status = 'approved' WHERE email = ?").run(email));
  const signedIn = await send("/api/auth/sign-in", "POST", { email, password }, undefined, { "x-forwarded-for": email });
  assert.equal(signedIn.status, 200, email);
  return cookieFrom(signedIn);
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
  adminCookie = await adult("lessons-admin@example.com", "admin");
  teacherCookie = await adult("lessons-teacher@example.com", "teacher");
  colleagueCookie = await adult("lessons-colleague@example.com", "teacher");
  parentCookie = await adult("lessons-parent@example.com", "parent");
  assert.equal((await send("/api/student/sign-up", "POST", { username: "lessons-maya", displayName: "Maya", password }, undefined, { "x-forwarded-for": "lessons-student" })).status, 201);
  approveAccount("students", "username", "lessons-maya");
  const signedIn = await send("/api/student/sign-in", "POST", { username: "lessons-maya", password }, undefined, { "x-forwarded-for": "lessons-student" });
  assert.equal(signedIn.status, 200);
  studentCookie = cookieFrom(signedIn, "ba_student_session");
});
after(async () => {
  if (server && server.exitCode === null) { const closed = once(server, "exit"); server.kill("SIGTERM"); await closed; }
  rmSync(stateDir, { recursive: true, force: true });
});

test("a withdrawn lesson disappears for students and parents everywhere, and re-approval brings it back", async () => {
  // Every lesson starts approved as a baseline, and the state is the same for all staff.
  const list = await (await send("/api/studio/lessons", "GET", undefined, teacherCookie)).json();
  assert.equal(list.lessons.length, 18);
  assert.ok(list.lessons.every((lesson) => lesson.status === "approved" && lesson.baseline));
  assert.equal((await send("/api/studio/lessons", "GET", undefined, parentCookie)).status, 403);
  assert.equal((await send("/api/studio/lessons", "GET", undefined, studentCookie)).status, 401);
  assert.equal((await send("/api/studio/lessons")).status, 401);

  // A teacher's learner profile with an assignment, and a parent's older saved profile with one too.
  const profile = await send("/api/profiles", "POST", { displayName: "Rumi" }, teacherCookie);
  assert.equal(profile.status, 201);
  const profileId = (await profile.json()).profile.id;
  assert.equal((await send("/api/assignments", "POST", { profileId, lessonId: "six-seasons" }, teacherCookie)).status, 201);
  fixture((db) => {
    db.prepare("INSERT INTO learner_profiles (id, owner_email, display_name) VALUES ('parent-profile', 'lessons-parent@example.com', 'Rumi at home')").run();
    db.prepare("INSERT INTO assignments (id, owner_email, profile_id, lesson_id, title) VALUES ('a-seasons', 'lessons-parent@example.com', 'parent-profile', 'six-seasons', 'Seasons'), ('a-hello', 'lessons-parent@example.com', 'parent-profile', 'hello-me', 'Hello')").run();
  });
  const parentAssignments = async () => (await (await send("/api/profiles", "GET", undefined, parentCookie)).json()).profiles[0].assignments.map((item) => item.lessonId).sort();
  assert.deepEqual(await parentAssignments(), ["hello-me", "six-seasons"]);

  const seasonsTitle = "Bangladesh through six seasons";
  assert.match(await html("/adventure?module=six-seasons", studentCookie), new RegExp(seasonsTitle));

  // Only staff decide, withdrawing needs a reason, and the reason is kept.
  assert.equal((await decide("six-seasons", { decision: "withdraw", note: "Check" }, parentCookie)).status, 403);
  assert.equal((await decide("six-seasons", { decision: "withdraw", note: "Check" }, undefined)).status, 401);
  assert.equal((await decide("made-up", { decision: "withdraw", note: "Check" }, teacherCookie)).status, 404);
  const noReason = await decide("six-seasons", { decision: "withdraw" }, teacherCookie);
  assert.equal(noReason.status, 400);
  assert.match((await noReason.json()).errorBn, /কেন/);
  const withdrawn = await decide("six-seasons", { decision: "withdraw", note: "The season names in Bangla need a check." }, teacherCookie);
  assert.equal(withdrawn.status, 200);
  assert.deepEqual([(await withdrawn.json()).approval.status], ["withdrawn"]);
  const seen = (await (await send("/api/studio/lessons", "GET", undefined, adminCookie)).json()).lessons.find((lesson) => lesson.lessonId === "six-seasons");
  assert.deepEqual([seen.status, seen.changedByName, seen.note], ["withdrawn", "lessons-teacher", "The season names in Bangla need a check."]);

  // Students cannot open it: not in the deep link, not as audio, not as a worksheet.
  const deepLink = await html("/adventure?module=six-seasons", studentCookie);
  assert.match(deepLink, /That lesson is not available at the moment/);
  assert.doesNotMatch(deepLink, new RegExp(seasonsTitle));
  assert.equal((await send("/api/audio/six-seasons/dialogue", "GET", undefined, studentCookie)).status, 404);
  assert.equal((await send("/api/audio/six-seasons/dialogue", "GET", undefined, parentCookie)).status, 404);
  assert.equal((await send("/api/audio/hello-me/dialogue", "GET", undefined, studentCookie)).status, 307);
  assert.equal((await send("/api/audio/six-seasons/dialogue", "GET", undefined, teacherCookie)).status, 307, "staff still preview it");
  assert.equal((await send("/worksheets/six-seasons", "GET", undefined, studentCookie)).status, 404);
  assert.equal((await send("/worksheets/six-seasons", "GET", undefined, parentCookie)).status, 404);
  assert.equal((await send("/worksheets/six-seasons", "GET", undefined, teacherCookie)).status, 200);
  assert.doesNotMatch(await html("/worksheets", studentCookie), new RegExp(seasonsTitle));
  assert.match(await html("/worksheets", teacherCookie), new RegExp(seasonsTitle));

  // New assignments and progress are refused; parents stop seeing its assignments; staff see it marked.
  const refused = await send("/api/assignments", "POST", { profileId, lessonId: "six-seasons" }, teacherCookie);
  assert.equal(refused.status, 400);
  assert.match((await refused.json()).error, /not available to learners/);
  assert.equal((await send("/api/progress", "POST", { profileId, lessonId: "six-seasons", sessionId: "session-six-seasons-reading", skill: "reading" }, teacherCookie)).status, 400);
  assert.equal((await send("/api/progress", "POST", { profileId, lessonId: "hello-me", sessionId: "session-hello-me-reading", skill: "reading" }, teacherCookie)).status, 201);
  assert.deepEqual(await parentAssignments(), ["hello-me"]);
  const staffView = (await (await send(`/api/assignments?profileId=${profileId}`, "GET", undefined, teacherCookie)).json()).assignments;
  assert.deepEqual(staffView.map((item) => [item.lessonId, item.lessonAvailable]), [["six-seasons", false]]);

  // Another teacher must confirm a full review to approve it again.
  assert.equal((await decide("six-seasons", { decision: "approve" }, colleagueCookie)).status, 400);
  const approved = await decide("six-seasons", { decision: "approve", confirmedRead: true, note: "Season names checked." }, colleagueCookie);
  assert.equal(approved.status, 200);
  const detail = await approved.json();
  assert.deepEqual([detail.approval.status, detail.approval.changedByName], ["approved", "lessons-colleague"]);
  assert.deepEqual(detail.history.map((entry) => [entry.status, entry.baseline]), [["approved", false], ["withdrawn", false], ["approved", true]]);
  assert.equal((await decide("six-seasons", { decision: "approve", confirmedRead: true }, adminCookie)).status, 409);

  const restored = await html("/adventure?module=six-seasons", studentCookie);
  assert.match(restored, new RegExp(seasonsTitle));
  assert.doesNotMatch(restored, /That lesson is not available at the moment/);
  assert.equal((await send("/api/audio/six-seasons/dialogue", "GET", undefined, studentCookie)).status, 307);
  assert.equal((await send("/worksheets/six-seasons", "GET", undefined, studentCookie)).status, 200);
  assert.equal((await send("/api/assignments", "POST", { profileId, lessonId: "six-seasons" }, teacherCookie)).status, 201);
  assert.deepEqual(await parentAssignments(), ["hello-me", "six-seasons"]);
  const audit = fixture((db) => db.prepare("SELECT action FROM user_audit_events WHERE target_id = 'six-seasons' ORDER BY created_at, rowid").all().map((row) => row.action));
  assert.deepEqual(audit, ["lesson-withdrawn", "lesson-approved"]);
});

test("a recording waiting for review plays for staff only, and any teacher approves it after listening", async () => {
  const bytes = Buffer.from("OggS fake recording for the integration test");
  const form = new FormData();
  form.set("file", new Blob([bytes], { type: "audio/ogg" }), "hello.ogg");
  form.set("lessonId", "hello-me"); form.set("slot", "dialogue"); form.set("speakerName", "Nadia"); form.set("dialect", "Dhaka"); form.set("consentConfirmed", "true");
  // Uploads are accepted only from the same origin, as from the Studio page.
  const uploaded = await fetch(`${BASE}/api/studio/media`, { method: "POST", body: form, headers: { cookie: teacherCookie, origin: BASE } });
  assert.equal(uploaded.status, 201);
  const { asset } = await uploaded.json();

  // Every staff member sees it waiting, with who uploaded it.
  const waiting = (await (await send("/api/studio/lessons", "GET", undefined, colleagueCookie)).json()).pendingRecordings;
  assert.deepEqual(waiting.map((item) => [item.id, item.uploaderName]), [[asset.id, "lessons-teacher"]]);

  const played = await send(`/api/studio/media/${asset.id}`, "GET", undefined, colleagueCookie);
  assert.equal(played.status, 200);
  assert.equal(played.headers.get("content-type"), "audio/ogg");
  assert.match(played.headers.get("cache-control"), /no-store/);
  assert.deepEqual(Buffer.from(await played.arrayBuffer()), bytes);
  assert.equal((await send(`/api/studio/media/${asset.id}`, "GET", undefined, studentCookie)).status, 401);
  assert.equal((await send(`/api/studio/media/${asset.id}`, "GET", undefined, parentCookie)).status, 403);
  assert.equal((await send(`/api/studio/media/${asset.id}`)).status, 401);
  assert.equal((await send("/api/studio/media/not-a-recording", "GET", undefined, colleagueCookie)).status, 404);
  assert.equal((await send("/api/audio/hello-me/dialogue", "GET", undefined, studentCookie)).status, 307, "learners do not get a pending recording");

  assert.equal((await send("/api/studio/media", "PATCH", { id: asset.id, reviewStatus: "approved" }, parentCookie)).status, 403);
  const unheard = await send("/api/studio/media", "PATCH", { id: asset.id, reviewStatus: "approved" }, colleagueCookie);
  assert.equal(unheard.status, 400);
  assert.match((await unheard.json()).error, /Play the recording/);
  const approved = await send("/api/studio/media", "PATCH", { id: asset.id, reviewStatus: "approved", confirmedListened: true }, colleagueCookie);
  assert.equal(approved.status, 200);
  const recording = (await (await send("/api/studio/lessons/hello-me", "GET", undefined, adminCookie)).json()).recordings.find((item) => item.id === asset.id);
  assert.deepEqual([recording.reviewStatus, recording.uploaderName, recording.reviewerName], ["approved", "lessons-teacher", "lessons-colleague"]);
  const learner = await send("/api/audio/hello-me/dialogue", "GET", undefined, studentCookie);
  assert.equal(learner.status, 200);
  assert.deepEqual(Buffer.from(await learner.arrayBuffer()), bytes);
});

test("a video a teacher marks unsuitable is not shown to learners; a YouTube replacement is shown instead", async () => {
  const videoTitle = "5 First Bengali Words: My Family";
  const check = (body, cookie = teacherCookie) => send("/api/studio/video-reviews", "POST", { lessonId: "my-family", status: "approved", captionsStatus: "available", suitabilityStatus: "suitable", replacementUrl: "", notes: "", ...body }, cookie);
  assert.match(await html("/adventure", studentCookie), new RegExp(videoTitle));
  assert.equal((await check({ suitabilityStatus: "unsuitable", replacementUrl: "https://example.com/video" })).status, 400);
  assert.equal((await check({}, parentCookie)).status, 403);
  assert.equal((await check({ suitabilityStatus: "unsuitable" })).status, 201);
  assert.doesNotMatch(await html("/adventure", studentCookie), new RegExp(videoTitle));
  const detail = await (await send("/api/studio/lessons/my-family", "GET", undefined, colleagueCookie)).json();
  assert.equal(detail.learnerVideo, null);
  assert.deepEqual([detail.video.suitabilityStatus, detail.video.checkerName], ["unsuitable", "lessons-teacher"]);

  // A colleague's newer check with a replacement link decides what learners see.
  assert.equal((await check({ status: "replace", replacementUrl: "https://www.youtube.com/watch?v=h-egsGh_VbQ" }, colleagueCookie)).status, 201);
  const page = await html("/adventure", studentCookie);
  assert.doesNotMatch(page, new RegExp(videoTitle));
  assert.match(page, /A video chosen by your teacher/);
  assert.equal((await (await send("/api/studio/lessons/my-family", "GET", undefined, teacherCookie)).json()).learnerVideo.id, "h-egsGh_VbQ");
});

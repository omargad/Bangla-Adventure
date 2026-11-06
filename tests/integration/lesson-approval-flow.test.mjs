import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import Database from "better-sqlite3";
import { approveShippedFixtureContent, currentVideoReviewFixture } from "./content-fixture.mjs";

/**
 * The shared lesson approval against the production server: an administrator withdraws
 * a lesson and students can no longer open it (lesson list, ?module= link,
 * audio, worksheet), new assignments and progress for it are refused and parents
 * stop seeing its assignments; an administrator re-approves it and everything
 * comes back. Fresh shipped content waits for its first explicit Admin review.
 * Recordings waiting for review play for staff only, and a video an administrator
 * marks unsuitable disappears from the learner lesson, even after that administrator
 * deletes their account.
 */

const PORT = 3261;
const BASE = `http://127.0.0.1:${PORT}`;
const stateDir = mkdtempSync(path.join(tmpdir(), "bangla-lessons-"));
const password = "integration-lessons-password";
let server, adminCookie, teacherCookie, colleagueCookie, parentCookie, studentCookie;

const cookieFrom = (response, name = "ba_adult_session") => response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`) && !value.startsWith(`${name}=;`))?.split(";")[0];
const send = (route, method = "GET", body, cookie, headers = {}) => fetch(`${BASE}${route}`, { method, redirect: "manual", headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const fixture = (callback) => { const db = new Database(path.join(stateDir, "test.db")); try { return callback(db); } finally { db.close(); } };
const html = async (route, cookie) => { const response = await send(route, "GET", undefined, cookie); assert.equal(response.status, 200, route); return response.text(); };
const decide = async (lessonId, body, cookie) => {
  if (body.decision === "approve" && cookie) {
    const detail = await (await send(`/api/studio/lessons/${lessonId}`, "GET", undefined, cookie)).json();
    body = { ...body, contentFingerprint: detail.contentFingerprint };
  }
  return send(`/api/studio/lessons/${lessonId}`, "POST", body, cookie);
};

async function adult(email, role) {
  assert.equal((await send("/api/auth/sign-up", "POST", { email, displayName: email.split("@")[0], password }, undefined, { "x-forwarded-for": email })).status, 201);
  // Self sign-ups wait for an administrator: approve directly, then sign in.
  fixture((db) => db.prepare({
    admin: "UPDATE adults SET role = 'admin', approval_status = 'approved' WHERE email = ?",
    teacher: "UPDATE adults SET role = 'teacher', teacher_status = 'approved', approval_status = 'approved' WHERE email = ?",
    parent: "UPDATE adults SET approval_status = 'approved' WHERE email = ?",
  }[role]).run(email));
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
  fixture((db) => db.prepare("UPDATE students SET approval_status = 'approved' WHERE username = ?").run("lessons-maya"));
  const signedIn = await send("/api/student/sign-in", "POST", { username: "lessons-maya", password }, undefined, { "x-forwarded-for": "lessons-student" });
  assert.equal(signedIn.status, 200);
  studentCookie = cookieFrom(signedIn, "ba_student_session");
});
after(async () => {
  if (server && server.exitCode === null) { const closed = once(server, "exit"); server.kill("SIGTERM"); await closed; }
  rmSync(stateDir, { recursive: true, force: true });
});

test("fresh shipped lessons require an Admin review of the current snapshot before any learner access", async () => {
  const list = await (await send("/api/studio/lessons", "GET", undefined, adminCookie)).json();
  assert.equal(list.lessons.length, 18);
  assert.ok(list.lessons.every((lesson) => lesson.status === "waiting" && !lesson.baseline && lesson.pendingRevision === 1));
  const detail = await (await send("/api/studio/lessons/hello-me", "GET", undefined, adminCookie)).json();
  assert.equal(detail.approvedSnapshot, null);
  assert.equal(detail.pendingRevision.version, 1);
  for (const cookie of [studentCookie, parentCookie]) {
    assert.equal((await send("/api/audio/hello-me/dialogue", "GET", undefined, cookie)).status, 404);
    assert.equal((await send("/worksheets/hello-me", "GET", undefined, cookie)).status, 404);
    assert.match(await html("/adventure?module=hello-me", cookie), /That lesson is not available at the moment/);
  }
  assert.equal((await send("/api/studio/lessons/hello-me", "POST", { decision: "approve", confirmedRead: true }, adminCookie)).status, 409, "the reviewed fingerprint is required");
  assert.equal((await send("/api/studio/lessons/hello-me", "POST", { decision: "approve", confirmedRead: true, contentFingerprint: "stale-revision" }, adminCookie)).status, 409, "a stale preview cannot publish");
  assert.equal((await decide("hello-me", { decision: "approve", confirmedRead: true }, teacherCookie)).status, 403);
  const profile = await send("/api/profiles", "POST", { displayName: "Pending lessons learner" }, teacherCookie);
  assert.equal(profile.status, 201);
  const profileId = (await profile.json()).profile.id;
  assert.equal((await send("/api/assignments", "POST", { profileId, lessonId: "hello-me" }, teacherCookie)).status, 400);
  assert.equal((await send("/api/progress", "POST", { profileId, lessonId: "hello-me", sessionId: "session-hello-me-reading", skill: "reading" }, teacherCookie)).status, 400);
  assert.equal(fixture((db) => db.prepare("SELECT COUNT(*) AS n FROM content_approvals WHERE content_type = 'lesson'").get().n), 0, "failed reviews leave every lesson unpublished");
  await approveShippedFixtureContent(BASE, adminCookie, { topics: false, excludeLessons: ["food-please"] });
  assert.equal((await send("/api/audio/hello-me/dialogue", "GET", undefined, studentCookie)).status, 200);
});

test("a withdrawn lesson disappears for students and parents everywhere, and re-approval brings it back", async () => {
  // Explicit fixture reviews publish the lessons used here; Food, please still waits for its first review.
  const list = await (await send("/api/studio/lessons", "GET", undefined, teacherCookie)).json();
  assert.equal(list.lessons.length, 18);
  assert.ok(list.lessons.every((lesson) => lesson.status === (lesson.lessonId === "food-please" ? "waiting" : "approved") && !lesson.baseline));
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

  // Every valid shared-content decision is denied to the owning teacher and a colleague.
  const beforeTeacherReview = fixture((db) => db.prepare("SELECT * FROM content_approvals ORDER BY rowid").all());
  for (const cookie of [teacherCookie, colleagueCookie]) {
    for (const decision of ["approve", "withdraw"]) {
      assert.equal((await decide("six-seasons", { decision, confirmedRead: true, note: "Teacher forged decision" }, cookie)).status, 403);
    }
  }
  assert.deepEqual(fixture((db) => db.prepare("SELECT * FROM content_approvals ORDER BY rowid").all()), beforeTeacherReview);

  // Only administrators decide, withdrawing needs a reason, and the reason is kept.
  assert.equal((await decide("six-seasons", { decision: "withdraw", note: "Check" }, parentCookie)).status, 403);
  assert.equal((await decide("six-seasons", { decision: "withdraw", note: "Check" }, undefined)).status, 401);
  assert.equal((await decide("made-up", { decision: "withdraw", note: "Check" }, adminCookie)).status, 404);
  const noReason = await decide("six-seasons", { decision: "withdraw" }, adminCookie);
  assert.equal(noReason.status, 400);
  assert.match((await noReason.json()).errorBn, /কেন/);
  const withdrawn = await decide("six-seasons", { decision: "withdraw", note: "The season names in Bangla need a check." }, adminCookie);
  assert.equal(withdrawn.status, 200);
  assert.deepEqual([(await withdrawn.json()).approval.status], ["withdrawn"]);
  const seen = (await (await send("/api/studio/lessons", "GET", undefined, adminCookie)).json()).lessons.find((lesson) => lesson.lessonId === "six-seasons");
  assert.deepEqual([seen.status, seen.changedByName, seen.note], ["withdrawn", "lessons-admin", "The season names in Bangla need a check."]);

  // Students cannot open it: not in the deep link, not as audio, not as a worksheet.
  const deepLink = await html("/adventure?module=six-seasons", studentCookie);
  assert.match(deepLink, /That lesson is not available at the moment/);
  assert.doesNotMatch(deepLink, new RegExp(seasonsTitle));
  assert.equal((await send("/api/audio/six-seasons/dialogue", "GET", undefined, studentCookie)).status, 404);
  assert.equal((await send("/api/audio/six-seasons/dialogue", "GET", undefined, parentCookie)).status, 404);
  // Nor by the bundled clip's own address.
  for (const cookie of [studentCookie, parentCookie]) assert.equal((await send("/audio/lesson-six-seasons-dialogue.ogg", "GET", undefined, cookie)).status, 404);
  assert.equal((await send("/api/audio/hello-me/dialogue", "GET", undefined, studentCookie)).status, 200);
  assert.equal((await send("/api/audio/six-seasons/dialogue", "GET", undefined, teacherCookie)).status, 200, "staff still preview it");
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

  // An administrator must confirm a full review to approve it again.
  assert.equal((await decide("six-seasons", { decision: "approve" }, adminCookie)).status, 400);
  const approved = await decide("six-seasons", { decision: "approve", confirmedRead: true, note: "Season names checked." }, adminCookie);
  assert.equal(approved.status, 200);
  const detail = await approved.json();
  assert.deepEqual([detail.approval.status, detail.approval.changedByName], ["approved", "lessons-admin"]);
  assert.deepEqual(detail.history.map((entry) => [entry.status, entry.baseline]), [["approved", false], ["withdrawn", false], ["approved", false]]);
  assert.equal((await decide("six-seasons", { decision: "approve", confirmedRead: true }, adminCookie)).status, 409);

  const restored = await html("/adventure?module=six-seasons", studentCookie);
  assert.match(restored, new RegExp(seasonsTitle));
  assert.doesNotMatch(restored, /That lesson is not available at the moment/);
  assert.equal((await send("/api/audio/six-seasons/dialogue", "GET", undefined, studentCookie)).status, 200);
  assert.equal((await send("/worksheets/six-seasons", "GET", undefined, studentCookie)).status, 200);
  assert.equal((await send("/api/assignments", "POST", { profileId, lessonId: "six-seasons" }, teacherCookie)).status, 201);
  assert.deepEqual(await parentAssignments(), ["hello-me", "six-seasons"]);
  const audit = fixture((db) => db.prepare("SELECT action FROM user_audit_events WHERE target_id = 'six-seasons' ORDER BY created_at, rowid").all().map((row) => row.action));
  assert.deepEqual(audit, ["lesson-approved", "lesson-withdrawn", "lesson-approved"]);
});

test("an administrator records the first full review of a pending shipped lesson before students see it", async () => {
  const foodTitle = "Food, please";
  assert.doesNotMatch(await html("/adventure?module=food-please", studentCookie), new RegExp(foodTitle));
  assert.equal((await send("/api/audio/food-please/dialogue", "GET", undefined, studentCookie)).status, 404);
  assert.equal((await decide("food-please", { decision: "approve" }, adminCookie)).status, 400);
  const reviewed = await decide("food-please", { decision: "approve", confirmedRead: true }, adminCookie);
  assert.equal(reviewed.status, 200);
  const { approval } = await reviewed.json();
  assert.deepEqual([approval.status, approval.baseline, approval.changedByName], ["approved", false, "lessons-admin"]);
  assert.equal((await decide("food-please", { decision: "approve", confirmedRead: true }, adminCookie)).status, 409);
  const listed = (await (await send("/api/studio/lessons", "GET", undefined, adminCookie)).json()).lessons.find((lesson) => lesson.lessonId === "food-please");
  assert.deepEqual([listed.status, listed.baseline, listed.changedByName], ["approved", false, "lessons-admin"]);
  const stillOpen = await html("/adventure?module=food-please", studentCookie);
  assert.match(stillOpen, new RegExp(foodTitle));
  assert.doesNotMatch(stillOpen, /That lesson is not available at the moment/);
});

test("a recording waiting for review plays for staff only, and an administrator approves it after listening", async () => {
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
  assert.equal((await send("/api/audio/hello-me/dialogue", "GET", undefined, studentCookie)).status, 200, "learners do not get a pending recording");

  assert.equal((await send("/api/studio/media", "PATCH", { id: asset.id, reviewStatus: "approved" }, parentCookie)).status, 403);
  for (const cookie of [teacherCookie, colleagueCookie]) {
    for (const reviewStatus of ["pending", "changes-requested", "approved", "retired"]) {
      assert.equal((await send("/api/studio/media", "PATCH", { id: asset.id, reviewStatus, confirmedListened: true }, cookie)).status, 403);
    }
  }
  const waitingAfterDenied = fixture((db) => db.prepare("SELECT review_status, reviewed_by FROM media_assets WHERE id = ?").get(asset.id));
  assert.deepEqual(waitingAfterDenied, { review_status: "pending", reviewed_by: null });
  const unheard = await send("/api/studio/media", "PATCH", { id: asset.id, reviewStatus: "approved" }, adminCookie);
  assert.equal(unheard.status, 400);
  assert.match((await unheard.json()).error, /Play the recording/);
  const approved = await send("/api/studio/media", "PATCH", { id: asset.id, reviewStatus: "approved", confirmedListened: true }, adminCookie);
  assert.equal(approved.status, 200);
  const recording = (await (await send("/api/studio/lessons/hello-me", "GET", undefined, adminCookie)).json()).recordings.find((item) => item.id === asset.id);
  assert.deepEqual([recording.reviewStatus, recording.uploaderName, recording.reviewerName], ["approved", "lessons-teacher", "lessons-admin"]);
  const learner = await send("/api/audio/hello-me/dialogue", "GET", undefined, studentCookie);
  assert.equal(learner.status, 200);
  assert.deepEqual(Buffer.from(await learner.arrayBuffer()), bytes);
});

test("a video an administrator marks unsuitable is not shown to learners; a YouTube replacement is shown instead", async () => {
  const videoTitle = "5 First Bengali Words: My Family";
  const check = async (body, cookie = adminCookie) => send("/api/studio/video-reviews", "POST", await currentVideoReviewFixture(BASE, adminCookie, "my-family", body), cookie);
  assert.doesNotMatch(await html("/adventure", studentCookie), new RegExp(videoTitle), "lesson text approval does not publish unreviewed media");
  assert.equal((await (await send("/api/studio/lessons/my-family", "GET", undefined, adminCookie)).json()).learnerVideo, null);
  for (const status of ["approved", "pending", "replace", "unavailable"]) {
    assert.equal((await check({ status, contentFingerprint: "stale-reviewed-candidate" })).status, 409, `${status} cannot change a video from a stale lesson preview`);
  }
  assert.equal((await check({ videoId: "stale-video-id" })).status, 409, "a video decision is bound to the video that was previewed");
  assert.equal((await check({ contentFingerprint: undefined, videoId: undefined })).status, 409, "reviewed candidate identity is required");
  assert.equal((await check({ suitabilityStatus: "unsuitable", replacementUrl: "https://example.com/video" })).status, 400);
  assert.equal((await check({}, parentCookie)).status, 403);
  for (const cookie of [teacherCookie, colleagueCookie]) {
    for (const status of ["pending", "approved", "replace", "unavailable"]) {
      assert.equal((await check({ status, suitabilityStatus: "unsuitable" }, cookie)).status, 403);
    }
  }
  assert.equal(fixture((db) => db.prepare("SELECT COUNT(*) AS n FROM video_reviews WHERE lesson_id = 'my-family'").get().n), 0);
  assert.doesNotMatch(await html("/adventure", studentCookie), new RegExp(videoTitle), "denied staff decisions cannot publish media");
  assert.equal((await check({ notes: "Fixture media review separate from the lesson text review." })).status, 201);
  assert.match(await html("/adventure", studentCookie), new RegExp(videoTitle));
  assert.equal((await check({ suitabilityStatus: "unsuitable" })).status, 200);
  assert.doesNotMatch(await html("/adventure", studentCookie), new RegExp(videoTitle));
  const detail = await (await send("/api/studio/lessons/my-family", "GET", undefined, colleagueCookie)).json();
  assert.equal(detail.learnerVideo, null);
  assert.deepEqual([detail.video.suitabilityStatus, detail.video.checkerName], ["unsuitable", "lessons-admin"]);

  // The administrator's newer check with a replacement link decides what learners see.
  assert.equal((await check({ status: "replace", replacementUrl: "https://www.youtube.com/watch?v=h-egsGh_VbQ" }, adminCookie)).status, 200);
  const page = await html("/adventure", studentCookie);
  assert.doesNotMatch(page, new RegExp(videoTitle));
  assert.match(page, /A video chosen by an administrator/);
  assert.equal((await (await send("/api/studio/lessons/my-family", "GET", undefined, teacherCookie)).json()).learnerVideo.id, "h-egsGh_VbQ");
});

test("an administrator's video take-down stays in place after demotion and account deletion", async () => {
  const videoTitle = "Basic Bengali: Asking for Directions";
  const leaverEmail = "lessons-leaver@example.com";
  // The deep link opens the lesson's level, where its card shows the video title.
  const lessonPage = "/adventure?module=directions";
  const leaverCookie = await adult(leaverEmail, "admin");
  assert.doesNotMatch(await html(lessonPage, studentCookie), new RegExp(videoTitle));
  assert.equal((await send("/api/studio/video-reviews", "POST", await currentVideoReviewFixture(BASE, leaverCookie, "directions", { notes: "Fixture media review." }), leaverCookie)).status, 201);
  assert.match(await html(lessonPage, studentCookie), new RegExp(videoTitle));
  const takenDown = await send("/api/studio/video-reviews", "POST", await currentVideoReviewFixture(BASE, leaverCookie, "directions", { suitabilityStatus: "unsuitable", notes: "Not for children." }), leaverCookie);
  assert.equal(takenDown.status, 200);
  assert.doesNotMatch(await html(lessonPage, studentCookie), new RegExp(videoTitle));

  assert.equal((await send("/api/account/delete", "POST", { password }, leaverCookie)).status, 409, "administrators cannot delete their own Admin account");
  const leaverId = fixture((db) => db.prepare("SELECT id FROM adults WHERE email = ?").get(leaverEmail).id);
  assert.equal((await send(`/api/admin/users/${leaverId}`, "PATCH", { kind: "adult", role: "parent" }, adminCookie)).status, 200);
  const demotedSignIn = await send("/api/auth/sign-in", "POST", { email: leaverEmail, password }, undefined, { "x-forwarded-for": leaverEmail });
  assert.equal(demotedSignIn.status, 200);
  const deleted = await send("/api/account/delete", "POST", { password }, cookieFrom(demotedSignIn));
  assert.equal(deleted.status, 200);
  assert.equal((await send("/api/auth/sign-in", "POST", { email: leaverEmail, password }, undefined, { "x-forwarded-for": leaverEmail })).status, 401);

  // The check is kept, no longer linked to the deleted account, and learners still do not get the video.
  assert.doesNotMatch(await html(lessonPage, studentCookie), new RegExp(videoTitle));
  const detail = await (await send("/api/studio/lessons/directions", "GET", undefined, teacherCookie)).json();
  assert.equal(detail.learnerVideo, null);
  assert.deepEqual([detail.video.suitabilityStatus, detail.video.checkerName, detail.video.notes], ["unsuitable", null, "Not for children."]);
  const owners = fixture((db) => db.prepare("SELECT owner_email FROM video_reviews WHERE lesson_id = 'directions'").all().map((row) => row.owner_email));
  assert.equal(owners.length, 1);
  assert.match(owners[0], /^deleted-staff:/);
});

test("teacher specialist checks and draft statuses cannot bypass administrator publication", async () => {
  const lessonId = "friendship-help";
  assert.equal((await decide(lessonId, { decision: "withdraw", note: "Wait for the administrator's complete review." }, adminCookie)).status, 200);
  const before = fixture((db) => db.prepare("SELECT * FROM content_approvals WHERE content_id = ? ORDER BY rowid").all(lessonId));
  const specialist = await send("/api/studio/reviews", "POST", {
    lessonId, reviewType: "language", status: "approved", reviewerName: "Demo language teacher", notes: "Language check complete; publication still requires Admin review.",
  }, teacherCookie);
  assert.equal(specialist.status, 201, "teachers may record specialist feedback");
  const draftBody = { lessonId, title: "Friendship lesson draft", level: "b1", status: "ready-for-review", dataJson: JSON.stringify({ title: "Teacher draft" }) };
  const created = await send("/api/studio/drafts", "POST", draftBody, teacherCookie);
  assert.equal(created.status, 201);
  const { draft } = await created.json();
  for (const cookie of [teacherCookie, colleagueCookie]) {
    assert.equal((await send("/api/studio/drafts", "POST", { ...draftBody, id: draft.id, status: "approved-for-release" }, cookie)).status, 403);
  }
  assert.deepEqual(fixture((db) => db.prepare("SELECT status, data_json FROM curriculum_drafts WHERE id = ?").get(draft.id)), { status: "ready-for-review", data_json: draftBody.dataJson });
  assert.deepEqual(fixture((db) => db.prepare("SELECT * FROM content_approvals WHERE content_id = ? ORDER BY rowid").all(lessonId)), before);
  assert.equal((await send(`/api/audio/${lessonId}/dialogue`, "GET", undefined, studentCookie)).status, 404);
  assert.equal((await send("/api/studio/drafts", "POST", { ...draftBody, status: "approved-for-release" }, adminCookie)).status, 201);
  assert.equal((await send(`/api/audio/${lessonId}/dialogue`, "GET", undefined, studentCookie)).status, 404, "an archived Studio draft flag is not a lesson publication decision");
  assert.equal((await decide(lessonId, { decision: "approve", confirmedRead: true }, adminCookie)).status, 200);
  assert.equal((await send(`/api/audio/${lessonId}/dialogue`, "GET", undefined, studentCookie)).status, 200);
});

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import Database from "better-sqlite3";

/**
 * Lesson word and sentence-pattern audio against the production server:
 * /api/audio serves a teacher-approved human recording before the bundled
 * computer voice, learner pages are told which parts have one, and a recording
 * a teacher stops using is no longer served (nor kept in the browser cache).
 */

const PORT = 3263;
const BASE = `http://127.0.0.1:${PORT}`;
const stateDir = mkdtempSync(path.join(tmpdir(), "bangla-voice-"));
const password = "integration-voice-password";
let server, teacherCookie, colleagueCookie, studentCookie;

const cookieFrom = (response, name = "ba_adult_session") => response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`) && !value.startsWith(`${name}=;`))?.split(";")[0];
const send = (route, method = "GET", body, cookie, headers = {}) => fetch(`${BASE}${route}`, { method, redirect: "manual", headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const fixture = (callback) => { const db = new Database(path.join(stateDir, "test.db")); try { return callback(db); } finally { db.close(); } };

async function teacher(email) {
  assert.equal((await send("/api/auth/sign-up", "POST", { email, displayName: email.split("@")[0], password }, undefined, { "x-forwarded-for": email })).status, 201);
  // Self sign-ups wait for an administrator: approve directly, then sign in.
  fixture((db) => db.prepare("UPDATE adults SET role = 'teacher', teacher_status = 'approved', approval_status = 'approved' WHERE email = ?").run(email));
  const signedIn = await send("/api/auth/sign-in", "POST", { email, password }, undefined, { "x-forwarded-for": email });
  assert.equal(signedIn.status, 200, email);
  return cookieFrom(signedIn);
}

/** A teacher uploads a recording for one lesson part and a colleague approves it after listening. */
async function approvedRecording(lessonId, slot, bytes) {
  const form = new FormData();
  form.set("file", new Blob([bytes], { type: "audio/ogg" }), `${slot}.ogg`);
  form.set("lessonId", lessonId); form.set("slot", slot); form.set("speakerName", "Nadia"); form.set("dialect", "Dhaka"); form.set("consentConfirmed", "true");
  const uploaded = await fetch(`${BASE}/api/studio/media`, { method: "POST", body: form, headers: { cookie: teacherCookie, origin: BASE } });
  assert.equal(uploaded.status, 201);
  const { asset } = await uploaded.json();
  const approved = await send("/api/studio/media", "PATCH", { id: asset.id, reviewStatus: "approved", confirmedListened: true }, colleagueCookie);
  assert.equal(approved.status, 200);
  return asset.id;
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
  teacherCookie = await teacher("voice-teacher@example.com");
  colleagueCookie = await teacher("voice-colleague@example.com");
  assert.equal((await send("/api/student/sign-up", "POST", { username: "voice-maya", displayName: "Maya", password }, undefined, { "x-forwarded-for": "voice-student" })).status, 201);
  fixture((db) => db.prepare("UPDATE students SET approval_status = 'approved' WHERE username = ?").run("voice-maya"));
  const signedIn = await send("/api/student/sign-in", "POST", { username: "voice-maya", password }, undefined, { "x-forwarded-for": "voice-student" });
  assert.equal(signedIn.status, 200);
  studentCookie = cookieFrom(signedIn, "ba_student_session");
});
after(async () => {
  if (server && server.exitCode === null) { const closed = once(server, "exit"); server.kill("SIGTERM"); await closed; }
  rmSync(stateDir, { recursive: true, force: true });
});

test("word and pattern audio from /api/audio is the approved human recording, ahead of the bundled computer voice", async () => {
  // Before any recording, learners are sent to the bundled clip, and that answer is not cached.
  const bundled = await send("/api/audio/hello-me/word-1", "GET", undefined, studentCookie);
  assert.equal(bundled.status, 307);
  assert.equal(bundled.headers.get("location"), "/audio/lesson-hello-me-word-1.ogg", "the browser stays on the host it asked");
  assert.match(bundled.headers.get("cache-control"), /no-store/);
  const clip = await send("/audio/lesson-hello-me-word-1.ogg", "GET", undefined, studentCookie);
  assert.equal(clip.status, 200);
  assert.equal(Buffer.from(await clip.arrayBuffer()).subarray(0, 4).toString(), "OggS");

  const wordBytes = Buffer.from("OggS a teacher saying the first word");
  const patternBytes = Buffer.from("OggS a teacher saying the second pattern");
  const wordId = await approvedRecording("hello-me", "word-1", wordBytes);
  const patternId = await approvedRecording("hello-me", "pattern-2", patternBytes);

  const word = await send("/api/audio/hello-me/word-1", "GET", undefined, studentCookie);
  assert.equal(word.status, 200);
  assert.equal(word.headers.get("content-type"), "audio/ogg");
  assert.match(word.headers.get("cache-control"), /no-store/, "a recording is never kept in a cache, so retiring it takes effect at once");
  assert.deepEqual(Buffer.from(await word.arrayBuffer()), wordBytes);
  // Pages ask for the recording they know about by id.
  const versioned = await send(`/api/audio/hello-me/word-1?v=${wordId}`, "GET", undefined, studentCookie);
  assert.equal(versioned.status, 200);
  assert.deepEqual(Buffer.from(await versioned.arrayBuffer()), wordBytes);
  assert.equal((await send("/api/audio/hello-me/word-1?v=some-other-recording", "GET", undefined, studentCookie)).status, 404);
  const pattern = await send("/api/audio/hello-me/pattern-2", "GET", undefined, studentCookie);
  assert.equal(pattern.status, 200);
  assert.deepEqual(Buffer.from(await pattern.arrayBuffer()), patternBytes);
  assert.equal((await send("/api/audio/hello-me/pattern-1", "GET", undefined, studentCookie)).status, 307, "other parts keep the bundled clip");
  assert.equal((await send("/api/audio/hello-me/word-7", "GET", undefined, studentCookie)).status, 404);
  assert.equal((await send("/api/audio/not-a-lesson/word-1", "GET", undefined, studentCookie)).status, 404);
  assert.equal((await send("/api/audio/hello-me/word-1")).status, 401, "lesson audio needs a signed-in learner");

  // Learner pages are told which parts have a recording, so it plays before any device voice.
  const adventure = await send("/adventure", "GET", undefined, studentCookie);
  assert.equal(adventure.status, 200);
  const adventureHtml = await adventure.text();
  assert.ok(adventureHtml.includes(wordId) && adventureHtml.includes(patternId), "the lesson page knows the approved recordings");
  const practice = await send("/practice", "GET", undefined, studentCookie);
  assert.equal(practice.status, 200);
  assert.ok((await practice.text()).includes(wordId), "word practice knows the approved word recording");
  // A page that loaded earlier asks again when the lesson opens.
  const fresh = await send("/api/audio/hello-me", "GET", undefined, studentCookie);
  assert.equal(fresh.status, 200);
  assert.match(fresh.headers.get("cache-control"), /no-store/);
  assert.deepEqual((await fresh.json()).recordings, { "hello-me/word-1": wordId, "hello-me/pattern-2": patternId });
  assert.deepEqual((await (await send("/api/audio/my-day", "GET", undefined, studentCookie)).json()).recordings, {});
  assert.equal((await send("/api/audio/not-a-lesson", "GET", undefined, studentCookie)).status, 404);
  assert.equal((await send("/api/audio/hello-me")).status, 401, "recordings need a signed-in learner");

  // A recording waiting for review is not served to learners.
  const waitingForm = new FormData();
  waitingForm.set("file", new Blob([Buffer.from("OggS waiting")], { type: "audio/ogg" }), "word-3.ogg");
  waitingForm.set("lessonId", "hello-me"); waitingForm.set("slot", "word-3"); waitingForm.set("speakerName", "Nadia"); waitingForm.set("dialect", "Dhaka"); waitingForm.set("consentConfirmed", "true");
  assert.equal((await fetch(`${BASE}/api/studio/media`, { method: "POST", body: waitingForm, headers: { cookie: teacherCookie, origin: BASE } })).status, 201);
  assert.equal((await send("/api/audio/hello-me/word-3", "GET", undefined, studentCookie)).status, 307);

  // Once a teacher stops using it, learners get the bundled clip again; a page still asking for it by id
  // gets 404 and moves on to the next voice.
  assert.equal((await send("/api/studio/media", "PATCH", { id: wordId, reviewStatus: "retired" }, teacherCookie)).status, 200);
  assert.equal((await send("/api/audio/hello-me/word-1", "GET", undefined, studentCookie)).status, 307);
  assert.equal((await send(`/api/audio/hello-me/word-1?v=${wordId}`, "GET", undefined, studentCookie)).status, 404);
  assert.ok(!(await (await send("/adventure", "GET", undefined, studentCookie)).text()).includes(wordId));
  assert.deepEqual((await (await send("/api/audio/hello-me", "GET", undefined, studentCookie)).json()).recordings, { "hello-me/pattern-2": patternId });

  // A withdrawn lesson's recordings are for staff previewing it, not for learners.
  assert.equal((await send("/api/studio/lessons/my-day", "POST", { decision: "withdraw", note: "Checking the audio" }, teacherCookie)).status, 200);
  assert.equal((await send("/api/audio/my-day", "GET", undefined, studentCookie)).status, 404);
  assert.equal((await send("/api/audio/my-day", "GET", undefined, teacherCookie)).status, 200);
});

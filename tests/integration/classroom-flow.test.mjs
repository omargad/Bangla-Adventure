import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import Database from "better-sqlite3";

function approveFixture(email) {
  const fixture = new Database(path.join(stateDir, "test.db"));
  fixture.prepare("UPDATE adults SET role = 'teacher', teacher_status = 'approved' WHERE email = ?").run(email);
  fixture.close();
}

/**
 * End-to-end classroom flow against the production server:
 * teacher signs up → creates a class → sets an activity + announcement →
 * student joins with the code → feed hides the answer key → student submits →
 * teacher sees the graded submission → an administrator's knowledge-source
 * override flows to the library API (teachers cannot change it).
 */

const PORT = 3212;
const BASE = `http://127.0.0.1:${PORT}`;
const stateDir = mkdtempSync(path.join(tmpdir(), "bangla-class-"));
let server;

function cookieFrom(response) {
  const header = response.headers.getSetCookie?.() ?? [];
  const session = header.find((value) => value.startsWith("ba_adult_session="));
  return session ? session.split(";")[0] : null;
}

async function waitForServer(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/safety`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Server did not become ready in time");
}

before(async () => {
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(PORT)], {
    cwd: new URL("../..", import.meta.url).pathname,
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_PATH: path.join(stateDir, "test.db"),
      MEDIA_ROOT: path.join(stateDir, "media"),
    },
    stdio: "ignore",
  });
  await waitForServer();
});

after(() => {
  server?.kill("SIGTERM");
  rmSync(stateDir, { recursive: true, force: true });
});

let teacherCookie;
let classId;
let joinCode;
let activityId;
let studentToken;

test("teacher signs up and creates a class with a join code", async () => {
  const signUp = await fetch(`${BASE}/api/auth/sign-up`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "teacher@example.com", displayName: "Ms Rahman", password: "sunny-river-42" }),
  });
  assert.equal(signUp.status, 201);
  teacherCookie = cookieFrom(signUp);
  assert.ok(teacherCookie, "session cookie issued");
  approveFixture("teacher@example.com");

  const created = await fetch(`${BASE}/api/classes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: teacherCookie },
    body: JSON.stringify({ name: "Sunday Level 2" }),
  });
  assert.equal(created.status, 201);
  const data = await created.json();
  classId = data.class.id;
  joinCode = data.class.joinCode;
  assert.match(joinCode, /^[A-Z2-9]{6}$/);
});

test("teacher publishes an announcement and a quiz activity", async () => {
  const announced = await fetch(`${BASE}/api/classes/${classId}/announcements`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: teacherCookie },
    body: JSON.stringify({ body: "This term's theme is festivals!" }),
  });
  assert.equal(announced.status, 201);

  const activity = await fetch(`${BASE}/api/classes/${classId}/activities`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: teacherCookie },
    body: JSON.stringify({
      title: "Festivals check-in",
      instructions: "Read the Pohela Boishakh topic first.",
      topicId: "pohela-boishakh",
      questions: [
        { prompt: "Which month starts the Bengali year?", options: ["Boishakh", "Poush"], answer: 0 },
        { prompt: "What do shops open on Pohela Boishakh?", options: ["Halkhata", "Umbrellas", "Kites"], answer: 0 },
      ],
    }),
  });
  assert.equal(activity.status, 201);
  const data = await activity.json();
  activityId = data.activity.id;
});

test("activity creation rejects a quiz without a valid answer key", async () => {
  const bad = await fetch(`${BASE}/api/classes/${classId}/activities`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: teacherCookie },
    body: JSON.stringify({ title: "Broken", questions: [{ prompt: "q", options: ["a", "b"], answer: 9 }] }),
  });
  assert.equal(bad.status, 400);
});

test("staff allocate a registered student without a class code", async () => {
  const joined = await fetch(`${BASE}/api/student/sign-up`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "maya", displayName: "Maya", password: "student-test-password" }),
  });
  assert.equal(joined.status, 201);
  studentToken = joined.headers.getSetCookie().find((value) => value.startsWith("ba_student_session=")).split(";")[0];
  assert.ok(studentToken);
  const allocated = await fetch(`${BASE}/api/classes/${classId}/students`, { method: "POST", headers: { "Content-Type": "application/json", cookie: teacherCookie }, body: JSON.stringify({ username: "maya" }) });
  assert.equal(allocated.status, 200);

  const wrongCode = await fetch(`${BASE}/api/classroom/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "ZZZZZ9", name: "Maya" }),
  });
  assert.equal(wrongCode.status, 410);
});

test("the student feed shows the work but never the answer key", async () => {
  const feed = await fetch(`${BASE}/api/student/feed`, { headers: { cookie: studentToken } });
  assert.equal(feed.status, 200);
  const data = await feed.json();
  assert.equal(data.classes[0].announcements.length, 1);
  assert.equal(data.classes[0].activities.length, 1);
  const [activity] = data.classes[0].activities;
  assert.equal(activity.questions.length, 2);
  for (const question of activity.questions) {
    assert.equal(question.answer, undefined, "answer key must not leak to students");
  }
  const raw = JSON.stringify(data);
  assert.ok(!raw.includes('"answer"'), "no answer field anywhere in the student feed");
});

test("submitting grades server-side and the teacher sees it", async () => {
  const submitted = await fetch(`${BASE}/api/student/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: studentToken },
    body: JSON.stringify({ activityId, answers: [0, 1] }),
  });
  assert.equal(submitted.status, 200);
  const result = await submitted.json();
  assert.equal(result.score, 1);
  assert.equal(result.total, 2);
  assert.equal(result.review[0].correct, true);
  assert.equal(result.review[1].correct, false);

  // Resubmission replaces the previous attempt.
  const again = await fetch(`${BASE}/api/student/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: studentToken },
    body: JSON.stringify({ activityId, answers: [0, 0] }),
  });
  assert.equal((await again.json()).score, 2);

  const detail = await fetch(`${BASE}/api/classes/${classId}`, { headers: { cookie: teacherCookie } });
  assert.equal(detail.status, 200);
  const data = await detail.json();
  assert.equal(data.students.length, 1);
  const [activity] = data.activities;
  assert.equal(activity.submissions.length, 1);
  assert.equal(activity.submissions[0].studentName, "Maya");
  assert.equal(activity.submissions[0].score, 2);
});

test("closed activities refuse new submissions", async () => {
  const closed = await fetch(`${BASE}/api/classes/${classId}/activities`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", cookie: teacherCookie },
    body: JSON.stringify({ activityId, status: "closed" }),
  });
  assert.equal(closed.status, 200);

  const rejected = await fetch(`${BASE}/api/student/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: studentToken },
    body: JSON.stringify({ activityId, answers: [0, 0] }),
  });
  assert.equal(rejected.status, 409);
});

test("another teacher cannot read someone else's class", async () => {
  const other = await fetch(`${BASE}/api/auth/sign-up`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "other@example.com", displayName: "Mr Khan", password: "quiet-boat-77" }),
  });
  const otherCookie = cookieFrom(other);
  approveFixture("other@example.com");
  const denied = await fetch(`${BASE}/api/classes/${classId}`, { headers: { cookie: otherCookie } });
  assert.equal(denied.status, 404);
});

test("knowledge-source overrides flow to the library API, and only an administrator may change them", async () => {
  const yearly = JSON.stringify({ id: "bgs-primary", data: { downloadUrl: "https://nctb.gov.bd/some-book.pdf" } });
  const anonymousPut = await fetch(`${BASE}/api/library`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: yearly,
  });
  assert.equal(anonymousPut.status, 401, "editing sources requires a signed-in adult");

  // The yearly NCTB link is the administrator's job; teachers add sources to their own classes instead.
  const teacherPut = await fetch(`${BASE}/api/library`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", cookie: teacherCookie },
    body: yearly,
  });
  assert.equal(teacherPut.status, 403, "a teacher cannot change the shared textbook links");
  const teacherReset = await fetch(`${BASE}/api/library`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", cookie: teacherCookie },
    body: JSON.stringify({ id: "bgs-primary" }),
  });
  assert.equal(teacherReset.status, 403, "a teacher cannot reset the shared textbook links");

  const librarian = await fetch(`${BASE}/api/auth/sign-up`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "librarian@example.com", displayName: "Admin Librarian", password: "yearly-books-2027" }),
  });
  assert.equal(librarian.status, 201);
  const fixture = new Database(path.join(stateDir, "test.db"));
  fixture.prepare("UPDATE adults SET role = 'admin' WHERE email = ?").run("librarian@example.com");
  // Where self sign-up waits for an administrator's approval, approve the account directly.
  if (fixture.prepare("PRAGMA table_info(adults)").all().some((column) => column.name === "approval_status")) {
    fixture.prepare("UPDATE adults SET approval_status = 'approved' WHERE email = ?").run("librarian@example.com");
  }
  fixture.close();
  // Sign in explicitly rather than relying on sign-up starting a session.
  const librarianSignIn = await fetch(`${BASE}/api/auth/sign-in`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "librarian@example.com", password: "yearly-books-2027" }),
  });
  assert.equal(librarianSignIn.status, 200);
  const adminCookie = cookieFrom(librarianSignIn);

  const put = await fetch(`${BASE}/api/library`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", cookie: adminCookie },
    body: yearly,
  });
  assert.equal(put.status, 200);

  const merged = await fetch(`${BASE}/api/library`, { headers: { cookie: teacherCookie } });
  const { books } = await merged.json();
  const updated = books.find((book) => book.id === "bgs-primary");
  assert.equal(updated.downloadUrl, "https://nctb.gov.bd/some-book.pdf");
  assert.equal(updated.customised, true);

  const reset = await fetch(`${BASE}/api/library`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", cookie: adminCookie },
    body: JSON.stringify({ id: "bgs-primary" }),
  });
  assert.equal(reset.status, 200);
  const restored = await (await fetch(`${BASE}/api/library`, { headers: { cookie: teacherCookie } })).json();
  assert.equal(restored.books.find((book) => book.id === "bgs-primary").customised, false);
});

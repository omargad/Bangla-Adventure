import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import Database from "better-sqlite3";

/**
 * Teacher-written topics and the approval gate against the production server:
 * a teacher writes a topic, students and parents cannot see or use it, another
 * teacher previews and approves it, and only then does it reach learners. Edits
 * of approved topics stay hidden until approved, and rejected edits never reach
 * students. Finishing a topic quiz counts as reading and reaches the teacher.
 */

const PORT = 3260;
const BASE = `http://127.0.0.1:${PORT}`;
const stateDir = mkdtempSync(path.join(tmpdir(), "bangla-topics-"));
const password = "integration-topics-password";
let server, adminCookie, authorCookie, reviewerCookie, parentCookie, studentCookie, classId, newTopicId, shippedCount;

const cookieFrom = (response, name = "ba_adult_session") => response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`))?.split(";")[0];
const send = (route, method = "GET", body, cookie, headers = {}) => fetch(`${BASE}${route}`, { method, redirect: "manual", headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const fixture = (callback) => { const db = new Database(path.join(stateDir, "test.db")); try { return callback(db); } finally { db.close(); } };
const curriculum = async (cookie) => (await send("/api/curriculum", "GET", undefined, cookie)).json();
const titles = async (cookie) => Object.fromEntries((await curriculum(cookie)).topics.map((topic) => [topic.id, topic.title.en]));
const pair = (en, bn) => ({ en, bn });
const newTopic = {
  theme: "our-country", emoji: "🍵", title: pair("The tea gardens of Sylhet", "সিলেটের চা-বাগান"), tagline: pair("Green hills where tea grows.", "সবুজ পাহাড়ে চা জন্মায়।"), minutes: 3,
  sections: [{ heading: pair("Rows of tea", "সারি সারি চা-গাছ"), body: pair("Tea bushes grow on the hills of Sylhet.", "সিলেটের পাহাড়ে চা-গাছ জন্মায়।") }],
  quiz: [{ question: pair("Where do the tea gardens grow?", "চা-বাগান কোথায়?"), options: [pair("On the hills", "পাহাড়ে"), pair("In the sea", "সমুদ্রে")], answer: 0 }],
};

async function adult(email, role) {
  const signUp = await send("/api/auth/sign-up", "POST", { email, displayName: email.split("@")[0], password }, undefined, { "x-forwarded-for": email });
  assert.equal(signUp.status, 201);
  if (role === "admin") fixture((db) => db.prepare("UPDATE adults SET role = 'admin' WHERE email = ?").run(email));
  if (role === "teacher") fixture((db) => db.prepare("UPDATE adults SET role = 'teacher', teacher_status = 'approved' WHERE email = ?").run(email));
  return cookieFrom(signUp);
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
  adminCookie = await adult("topics-admin@example.com", "admin");
  authorCookie = await adult("topics-author@example.com", "teacher");
  reviewerCookie = await adult("topics-reviewer@example.com", "teacher");
  parentCookie = await adult("topics-parent@example.com", "parent");
  const student = await send("/api/student/sign-up", "POST", { username: "topics-maya", displayName: "Maya", password }, undefined, { "x-forwarded-for": "topics-student" });
  assert.equal(student.status, 201);
  studentCookie = cookieFrom(student, "ba_student_session");
  const created = await send("/api/classes", "POST", { name: "Sunday 11:30" }, authorCookie);
  assert.equal(created.status, 201);
  classId = (await created.json()).class.id;
  assert.equal((await send(`/api/classes/${classId}/students`, "POST", { username: "topics-maya" }, authorCookie)).status, 200);
  shippedCount = (await curriculum(studentCookie)).topics.length;
});
after(async () => {
  if (server && server.exitCode === null) { const closed = once(server, "exit"); server.kill("SIGTERM"); await closed; }
  rmSync(stateDir, { recursive: true, force: true });
});

test("a teacher's new topic stays hidden from learners until another teacher previews and approves it", async () => {
  const missingBangla = await send("/api/topics", "POST", { ...newTopic, title: pair("Tea", "") }, authorCookie);
  assert.equal(missingBangla.status, 400);
  const refusal = await missingBangla.json();
  assert.match(refusal.error, /Title \(Bangla\)/);
  assert.match(refusal.errorBn, /শিরোনাম/);
  assert.equal((await send("/api/topics", "POST", newTopic, parentCookie)).status, 403);
  assert.equal((await send("/api/topics", "POST", newTopic, undefined, { cookie: studentCookie })).status, 401);
  assert.equal((await send("/api/topics", "POST", newTopic)).status, 401);

  const created = await send("/api/topics", "POST", newTopic, authorCookie);
  assert.equal(created.status, 201);
  ({ topicId: newTopicId } = await created.json());

  // Students, parents and every learner API refuse it while it waits.
  for (const cookie of [studentCookie, parentCookie]) assert.equal((await titles(cookie))[newTopicId], undefined);
  assert.equal((await send("/api/curriculum")).status, 401);
  assert.equal((await send("/api/student/topic-progress", "POST", { topicId: newTopicId }, studentCookie)).status, 400);
  assert.equal((await send("/api/student/topic-progress", "POST", { topicId: "made-up-topic" }, studentCookie)).status, 400);
  assert.equal((await send(`/api/classes/${classId}/activities`, "POST", { title: "Tea check", topicId: newTopicId, questions: [{ prompt: "Tea?", options: ["Yes", "No"], answer: 0 }] }, authorCookie)).status, 400);
  assert.equal((await send(`/api/topics/${newTopicId}`, "GET", undefined, parentCookie)).status, 403);
  assert.equal((await send(`/api/topics/${newTopicId}/versions/1`, "GET", undefined, studentCookie)).status, 401);
  assert.equal((await curriculum(studentCookie)).approval, undefined);

  const listing = await (await send("/api/topics", "GET", undefined, reviewerCookie)).json();
  assert.equal(listing.pendingCount, 1);
  const waiting = listing.topics.find((topic) => topic.id === newTopicId);
  assert.deepEqual(waiting.pendingVersions, [1]);
  assert.equal(waiting.approved, null);
  assert.equal(waiting.latest.authorName, "topics-author");
  const preview = await (await send(`/api/topics/${newTopicId}/versions/1`, "GET", undefined, reviewerCookie)).json();
  assert.equal(preview.version.content.title.bn, "সিলেটের চা-বাগান");
  assert.equal(preview.version.content.sections[0].body.bn, "সিলেটের পাহাড়ে চা-গাছ জন্মায়।");
  assert.match(preview.changes[0].en, /New topic/);

  const unconfirmed = await send(`/api/topics/${newTopicId}/versions/1`, "POST", { decision: "approve" }, reviewerCookie);
  assert.equal(unconfirmed.status, 400);
  assert.match((await unconfirmed.json()).error, /read the whole lesson in English and Bangla/);
  assert.equal((await send(`/api/topics/${newTopicId}/versions/1`, "POST", { decision: "approve", confirmedRead: true }, parentCookie)).status, 403);
  const approved = await send(`/api/topics/${newTopicId}/versions/1`, "POST", { decision: "approve", confirmedRead: true }, reviewerCookie);
  assert.equal(approved.status, 200);
  assert.equal((await approved.json()).status, "approved");

  for (const cookie of [studentCookie, parentCookie]) assert.equal((await titles(cookie))[newTopicId], "The tea gardens of Sylhet");
  const forStudent = (await curriculum(studentCookie)).topics.find((topic) => topic.id === newTopicId);
  assert.equal(forStudent.theme, "our-country");
  assert.equal(forStudent.approval, undefined, "students never receive review records");
  const forStaff = await curriculum(reviewerCookie);
  assert.equal(forStaff.canReview, true);
  const staffTopic = forStaff.topics.find((topic) => topic.id === newTopicId);
  assert.equal(staffTopic.approval.reviewerName, "topics-reviewer");
  assert.equal(staffTopic.approval.baseline, false);
  assert.equal(forStaff.topics.find((topic) => topic.id === "amar-ekushey").approval.baseline, true);
  assert.equal((await (await send("/api/curriculum?summary=1", "GET", undefined, studentCookie)).json()).topicCount, shippedCount + 1);
  assert.equal((await send(`/api/classes/${classId}/activities`, "POST", { title: "Tea check", topicId: newTopicId, questions: [{ prompt: "Tea?", options: ["Yes", "No"], answer: 0 }] }, authorCookie)).status, 201);

  // Finishing the quiz counts as reading, keeps the best score on the server and reaches the class teacher.
  assert.equal((await send("/api/student/topic-progress", "POST", { topicId: newTopicId, answers: [5] }, studentCookie)).status, 400);
  const finished = await (await send("/api/student/topic-progress", "POST", { topicId: newTopicId, answers: [0] }, studentCookie)).json();
  assert.deepEqual(finished.quiz, { score: 1, total: 1, best: 1 });
  const progress = await curriculum(studentCookie);
  assert.deepEqual(progress.readTopicIds, [newTopicId]);
  assert.deepEqual(progress.quizScores, { [newTopicId]: { best: 1, total: 1 } });
  const classProgress = await (await send(`/api/classes/${classId}/topic-progress`, "GET", undefined, authorCookie)).json();
  assert.equal(classProgress.approvedTopics, shippedCount + 1);
  assert.deepEqual(classProgress.students.map(({ displayName, topicsRead, quizzesDone, quizPercent }) => ({ displayName, topicsRead, quizzesDone, quizPercent })), [{ displayName: "Maya", topicsRead: 1, quizzesDone: 1, quizPercent: 100 }]);
  assert.equal((await send(`/api/classes/${classId}/topic-progress`, "GET", undefined, reviewerCookie)).status, 404, "only the class's own teacher (or an administrator)");
  assert.equal((await send(`/api/classes/${classId}/topic-progress`, "GET", undefined, adminCookie)).status, 200);
});

test("an edit of an approved topic stays hidden until approved, and a rejected edit never reaches students", async () => {
  const id = "pohela-boishakh";
  const original = (await titles(studentCookie))[id];
  const { topic } = await (await send(`/api/topics/${id}`, "GET", undefined, authorCookie)).json();
  assert.equal(topic.head.version, 0);
  assert.equal(topic.versions[0].baseline, true);
  const edit = { ...topic.head.content, title: pair("Pohela Boishakh: a new year together", topic.head.content.title.bn), baseVersion: 0 };
  const saved = await send(`/api/topics/${id}`, "PUT", edit, authorCookie);
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).version, 1);
  assert.equal((await titles(studentCookie))[id], original, "students keep the approved version");
  assert.equal((await send(`/api/topics/${id}`, "PUT", edit, reviewerCookie)).status, 409, "a stale editor cannot overwrite the waiting version");

  assert.equal((await send(`/api/topics/${id}/versions/1`, "POST", { decision: "reject" }, reviewerCookie)).status, 400, "sending back needs a note");
  assert.equal((await send(`/api/topics/${id}/versions/1`, "POST", { decision: "reject", note: "Please update the Bangla title as well." }, reviewerCookie)).status, 200);
  assert.equal((await titles(studentCookie))[id], original);
  const afterReject = (await (await send(`/api/topics/${id}`, "GET", undefined, authorCookie)).json()).topic;
  assert.equal(afterReject.head.status, "rejected");
  assert.equal(afterReject.versions.at(-1).reviewNote, "Please update the Bangla title as well.");
  assert.equal(afterReject.versions.at(-1).reviewerName, "topics-reviewer");

  const fixed = { ...edit, title: pair("Pohela Boishakh: a new year together", "পহেলা বৈশাখ: একসঙ্গে নতুন বছর"), baseVersion: 1 };
  assert.equal((await (await send(`/api/topics/${id}`, "PUT", fixed, authorCookie)).json()).version, 2);
  const diff = await (await send(`/api/topics/${id}/versions/2`, "GET", undefined, adminCookie)).json();
  assert.deepEqual(diff.changes.map((change) => change.en), ["Title (English) changed", "Title (Bangla) changed"]);
  assert.equal(diff.approved.version, 0);
  assert.equal((await send(`/api/topics/${id}/versions/2`, "POST", { decision: "approve", confirmedRead: true }, adminCookie)).status, 200);
  assert.equal((await titles(studentCookie))[id], "Pohela Boishakh: a new year together");
  assert.equal((await titles(parentCookie))[id], "Pohela Boishakh: a new year together");
  const history = (await (await send(`/api/topics/${id}`, "GET", undefined, reviewerCookie)).json()).topic.versions;
  assert.deepEqual(history.map((version) => [version.version, version.status]), [[0, "superseded"], [1, "rejected"], [2, "approved"]]);
  const audit = fixture((db) => db.prepare("SELECT action FROM user_audit_events WHERE target_id = ? ORDER BY rowid").all(id).map((row) => row.action));
  assert.deepEqual(audit, ["topic-edit-submitted", "topic-version-rejected", "topic-edit-submitted", "topic-version-approved"]);
});

test("the topics area is for staff, and the old curriculum page leads there", async () => {
  for (const cookie of [authorCookie, adminCookie]) assert.equal((await send("/teach/topics", "GET", undefined, cookie)).status, 200);
  const parentPage = await send("/teach/topics", "GET", undefined, parentCookie);
  assert.equal(parentPage.status, 307);
  assert.equal(new URL(parentPage.headers.get("location"), BASE).pathname, "/teach");
  const old = await send("/admin/curriculum", "GET", undefined, adminCookie);
  assert.equal(old.status, 307);
  assert.equal(new URL(old.headers.get("location"), BASE).pathname, "/teach/topics");
  assert.equal((await send("/api/admin/curriculum", "PUT", {}, adminCookie)).status, 404, "the administrator-only editor API is gone");
  assert.equal((await send("/api/topics/Not%20an%20id", "GET", undefined, authorCookie)).status, 404);
  assert.equal((await send(`/api/topics/${newTopicId}/versions/latest`, "GET", undefined, authorCookie)).status, 404);
  assert.equal((await send("/api/topics/no-such-topic", "GET", undefined, authorCookie)).status, 404);
  const oversized = await send("/api/topics", "POST", { ...newTopic, padding: "x".repeat(450_000) }, authorCookie);
  assert.equal(oversized.status, 413);
});

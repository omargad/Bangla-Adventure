import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import Database from "better-sqlite3";
import { tsImport } from "tsx/esm/api";

const { narrationCacheKey } = await tsImport("../../lib/generated-narration.ts", import.meta.url);
const { splitNarration } = await tsImport("../../lib/narration-model.ts", import.meta.url);
const PORT = 3275;
const BASE = `http://127.0.0.1:${PORT}`;
const stateDir = mkdtempSync(path.join(tmpdir(), "bangla-narration-"));
const mediaRoot = path.join(stateDir, "media");
const cacheRoot = path.join(mediaRoot, "generated-narration", "v1");
const sampleAudio = readFileSync(new URL("../../public/audio/lesson-hello-me-word-1.ogg", import.meta.url));
const password = "Narration-integration-password-2026";
const pair = (en, bn) => ({ en, bn });
const hash = (text) => createHash("sha256").update(text, "utf8").digest("hex");
let server, admin, teacher, otherTeacher, parent, unlinkedParent, student, outsider;

const cookieFrom = (response, name = "ba_adult_session") => response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`) && !value.startsWith(`${name}=;`))?.split(";")[0];
const send = (route, method = "GET", body, cookie) => fetch(`${BASE}${route}`, {
  method, redirect: "manual", headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});
const fixture = (callback) => { const db = new Database(path.join(stateDir, "test.db")); try { return callback(db); } finally { db.close(); } };
const narrate = (request, account) => send("/api/narration", "POST", request, account?.cookie);
const requestFor = (kind, id, slot, text, language = "bn", part = 0) => ({ kind, id, slot, language, hash: hash(text), part });

function seedAudio(text, language = "bn") {
  mkdirSync(cacheRoot, { recursive: true });
  for (const chunk of splitNarration(text)) writeFileSync(path.join(cacheRoot, `${narrationCacheKey(chunk, language)}.ogg`), sampleAudio);
}

async function assertAudio(request, account) {
  const response = await narrate(request, account);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "audio/ogg");
  assert.equal(response.headers.get("x-narration-provider"), "ElevenLabs");
  assert.equal(response.headers.get("x-narration-cache"), "hit");
  assert.match(response.headers.get("cache-control"), /private.*no-store/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), sampleAudio);
}

async function adult(name, role) {
  const email = `narration-${name}@example.com`;
  const response = await fetch(`${BASE}/api/auth/sign-up`, { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": name }, body: JSON.stringify({ email, displayName: name, password }) });
  assert.equal(response.status, 201);
  const id = (await response.json()).adult.id;
  fixture((db) => db.prepare("UPDATE adults SET role=?, teacher_status=?, approval_status='approved' WHERE id=?").run(role, role === "teacher" ? "approved" : "none", id));
  const signedIn = await send("/api/auth/sign-in", "POST", { email, password });
  assert.equal(signedIn.status, 200);
  return { id, email, cookie: cookieFrom(signedIn) };
}

async function learner(username) {
  const response = await send("/api/student/sign-up", "POST", { username, displayName: username, password });
  assert.equal(response.status, 201);
  const id = (await response.json()).student.id;
  fixture((db) => db.prepare("UPDATE students SET approval_status='approved' WHERE id=?").run(id));
  const signedIn = await send("/api/student/sign-in", "POST", { username, password });
  assert.equal(signedIn.status, 200);
  return { id, cookie: cookieFrom(signedIn, "ba_student_session") };
}

async function topic(approved = true, overrides = {}) {
  const suffix = randomUUID().slice(0, 8);
  const content = {
    theme: "our-country", emoji: "🌊", title: pair(`River life ${suffix}`, `নদীর জীবন ${suffix}`), tagline: pair("Learning beside the river.", "নদীর পাশে শেখা।"), minutes: 3,
    sections: [{ heading: pair("River boats", "নদীর নৌকা"), body: pair("Boats carry people across the river.", "নৌকা মানুষকে নদী পার করে।") }],
    funFacts: [pair("The Padma is a river.", "পদ্মা একটি নদী।")],
    quiz: [{ question: pair("Which is a river?", "কোনটি নদী?"), options: [pair("ANSWER-CANARY-Padma", "উত্তর-পদ্মা"), pair("A mountain", "পাহাড়")], answer: 0 }],
    ...overrides,
  };
  const created = await send("/api/topics", "POST", content, teacher.cookie);
  assert.equal(created.status, 201);
  const id = (await created.json()).topicId;
  if (approved) assert.equal((await send(`/api/topics/${id}/versions/1`, "POST", { decision: "approve", confirmedRead: true }, otherTeacher.cookie)).status, 200);
  return { id, content };
}

async function activity() {
  const createdClass = await send("/api/classes", "POST", { name: `Narration class ${randomUUID().slice(0, 8)}` }, teacher.cookie);
  assert.equal(createdClass.status, 201);
  const classId = (await createdClass.json()).class.id;
  assert.equal((await send(`/api/classes/${classId}/students`, "POST", { studentIds: [student.id] }, teacher.cookie)).status, 200);
  const content = { title: "নদীর কুইজ", instructions: "প্রশ্নটি পড়ো এবং একটি উত্তর বেছে নাও।", questions: [{ prompt: "কোনটি নদী?", options: ["ANSWER-CANARY-Padma", "A mountain"], answer: 0 }] };
  const created = await send(`/api/classes/${classId}/activities`, "POST", content, teacher.cookie);
  assert.equal(created.status, 201);
  return { id: (await created.json()).activity.id, classId, content };
}

before(async () => {
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(PORT)], {
    cwd: new URL("../..", import.meta.url).pathname,
    // Empty overrides prevent Next's local environment loading from enabling paid generation.
    env: { ...process.env, NODE_ENV: "production", PLATFORM_MODE: "legacy", DATABASE_PATH: path.join(stateDir, "test.db"), MEDIA_ROOT: mediaRoot, ELEVENLABS_API_KEY: "", ELEVENLABS_VOICE_ID: "6fKdJFZHa5oCXNSVGieE", ELEVENLABS_MODEL_ID: "eleven_v4" }, stdio: "ignore",
  });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) { ready = true; break; } } catch (error) { if (server.exitCode !== null) throw error; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(ready, "Isolated narration server did not start.");
  admin = await adult("admin", "admin");
  teacher = await adult("teacher", "teacher");
  otherTeacher = await adult("other-teacher", "teacher");
  parent = await adult("parent", "parent");
  unlinkedParent = await adult("unlinked-parent", "parent");
  student = await learner("narration.maya");
  outsider = await learner("narration.outsider");
  assert.equal((await send("/api/admin/family-links", "POST", { studentId: student.id, parentEmail: parent.email, confirmed: true }, admin.cookie)).status, 200);
});
after(async () => {
  if (server && server.exitCode === null) { const closed = once(server, "exit"); server.kill("SIGTERM"); await closed; }
  rmSync(stateDir, { recursive: true, force: true });
});

test("narration requires an account, validates bounded requests, and safely reports unavailable generation", async () => {
  const { id, content } = await topic();
  const text = `${content.title.bn}. ${content.tagline.bn}`;
  const valid = requestFor("topic", id, "intro", text);
  assert.equal((await narrate(valid)).status, 401);
  for (const invalid of [null, [], {}, { ...valid, slot: "answer:0" }, { ...valid, language: "fr" }, { ...valid, hash: "arbitrary text" }, { ...valid, part: -1 }, { ...valid, part: 0.5 }]) {
    assert.equal((await narrate(invalid, student)).status, 400);
  }
  assert.equal((await narrate({ ...valid, slot: "section:99" }, student)).status, 400);
  assert.equal((await narrate({ ...valid, part: 1 }, student)).status, 400);
  assert.equal((await narrate({ ...valid, extra: "x".repeat(2048) }, student)).status, 413);
  const missing = await narrate(valid, student);
  assert.equal(missing.status, 503, "an uncached request must not call ElevenLabs without a key");
  assert.match(missing.headers.get("cache-control"), /no-store/);
  assert.doesNotMatch(await missing.text(), /sk_|xi-api-key|password|stack|ANSWER-CANARY/i);
  // Existing audio still works without a key; caller-supplied text cannot replace the canonical source.
  seedAudio(text);
  await assertAudio({ ...valid, text: "Untrusted text that must never be narrated." }, student);
  assert.equal((await narrate({ ...valid, hash: hash("Untrusted text that must never be narrated.") }, student)).status, 409);
});

test("approved topic parts are available to every approved role; pending and withdrawn topics cannot read their cached audio", async () => {
  const approved = await topic();
  for (const language of ["bn", "en"]) {
    const text = `${approved.content.title[language]}. ${approved.content.tagline[language]}`;
    seedAudio(text, language);
    for (const account of [student, parent, teacher, otherTeacher, admin]) await assertAudio(requestFor("topic", approved.id, "intro", text, language), account);
    for (const [slot, partText] of [["section:0", `${approved.content.sections[0].heading[language]}. ${approved.content.sections[0].body[language]}`], ["fact:0", approved.content.funFacts[0][language]]]) {
      seedAudio(partText, language);
      await assertAudio(requestFor("topic", approved.id, slot, partText, language), student);
    }
  }
  const hidden = await topic(false);
  const hiddenText = `${hidden.content.title.bn}. ${hidden.content.tagline.bn}`;
  seedAudio(hiddenText);
  for (const account of [student, parent, teacher, admin]) assert.equal((await narrate(requestFor("topic", hidden.id, "intro", hiddenText), account)).status, 404);
  assert.equal((await send(`/api/topics/${approved.id}`, "POST", { decision: "withdraw", note: "Checking the wording." }, teacher.cookie)).status, 200);
  const oldText = `${approved.content.title.bn}. ${approved.content.tagline.bn}`;
  for (const account of [student, parent, teacher, admin]) assert.equal((await narrate(requestFor("topic", approved.id, "intro", oldText), account)).status, 404);
});

test("a changed topic rejects the old hash, and each chunk is tied to the full canonical Unicode text", async () => {
  const original = await topic(true, { sections: [{ heading: pair("A long reading", "দীর্ঘ পাঠ"), body: pair("River boats. ".repeat(150).trim(), "নদীতে নৌকা চলে। ".repeat(130).trim()) }] });
  const full = `${original.content.sections[0].heading.bn}. ${original.content.sections[0].body.bn}`;
  const chunks = splitNarration(full);
  assert.ok(chunks.length > 1);
  seedAudio(full);
  for (let part = 0; part < chunks.length; part++) await assertAudio(requestFor("topic", original.id, "section:0", full, "bn", part), student);
  assert.equal((await narrate(requestFor("topic", original.id, "section:0", chunks[0]), student)).status, 409, "a chunk hash cannot stand in for the complete text hash");
  const changed = { ...original.content, sections: [{ heading: pair("An updated reading", "হালনাগাদ পাঠ"), body: pair("Boats carry people safely.", "নৌকা মানুষকে নিরাপদে পার করে।") }], baseVersion: 1 };
  const edit = await send(`/api/topics/${original.id}`, "PUT", changed, teacher.cookie);
  assert.equal(edit.status, 200);
  const version = (await edit.json()).version;
  await assertAudio(requestFor("topic", original.id, "section:0", full), student);
  assert.equal((await send(`/api/topics/${original.id}/versions/${version}`, "POST", { decision: "approve", confirmedRead: true }, otherTeacher.cookie)).status, 200);
  assert.equal((await narrate(requestFor("topic", original.id, "section:0", full), student)).status, 409);
  const updated = `${changed.sections[0].heading.bn}. ${changed.sections[0].body.bn}`;
  seedAudio(updated);
  await assertAudio(requestFor("topic", original.id, "section:0", updated), student);
});

test("class narration allows the enrolled learner, linked parent and managing staff, without exposing answers or unrelated classes", async () => {
  const item = await activity();
  const instructions = `${item.content.title}. ${item.content.instructions}`;
  const prompt = item.content.questions[0].prompt;
  seedAudio(instructions); seedAudio(prompt);
  const request = requestFor("activity", item.id, "instructions", instructions);
  for (const account of [student, parent, teacher, admin]) {
    await assertAudio(request, account);
    await assertAudio(requestFor("activity", item.id, "question:0", prompt), account);
  }
  for (const account of [outsider, unlinkedParent, otherTeacher]) assert.equal((await narrate(request, account)).status, 404);
  assert.equal((await narrate({ ...request, language: "en" }, student)).status, 400, "Bangla activity text cannot be sent to an English voice");
  for (const slot of ["answer:0", "options:0", "question:1"]) {
    const response = await narrate({ ...request, slot }, student);
    assert.equal(response.status, 400);
    assert.doesNotMatch(await response.text(), /ANSWER-CANARY|Padma|mountain|"answer"/);
  }
  const leaked = `${prompt}. ${item.content.questions[0].options[0]}`;
  seedAudio(leaked);
  assert.equal((await narrate(requestFor("activity", item.id, "question:0", leaked), student)).status, 409, "a cached answer-bearing text must not bypass canonical prompt resolution");
});

test("closing an activity, unlinking a parent and removing enrollment revoke cached narration immediately", async () => {
  const item = await activity();
  const text = `${item.content.title}. ${item.content.instructions}`;
  seedAudio(text);
  const request = requestFor("activity", item.id, "instructions", text);
  await assertAudio(request, student); await assertAudio(request, parent);
  assert.equal((await send(`/api/classes/${item.classId}/activities`, "PATCH", { activityId: item.id, status: "closed" }, teacher.cookie)).status, 200);
  for (const account of [student, parent]) assert.equal((await narrate(request, account)).status, 404);
  await assertAudio(request, teacher); await assertAudio(request, admin);
  assert.equal((await send(`/api/classes/${item.classId}/activities`, "PATCH", { activityId: item.id, status: "open" }, teacher.cookie)).status, 200);
  assert.equal((await send("/api/admin/family-links", "DELETE", { studentId: student.id, parentId: parent.id }, admin.cookie)).status, 200);
  assert.equal((await narrate(request, parent)).status, 404);
  await assertAudio(request, student);
  assert.equal((await send("/api/admin/family-links", "POST", { studentId: student.id, parentEmail: parent.email, confirmed: true }, admin.cookie)).status, 200);
  await assertAudio(request, parent);
  assert.equal((await send(`/api/classes/${item.classId}/students`, "DELETE", { studentId: student.id }, teacher.cookie)).status, 200);
  for (const account of [student, parent]) assert.equal((await narrate(request, account)).status, 404);
  await assertAudio(request, teacher);
});

test("account status and password requirements are checked again before cached narration is served", async () => {
  const { id, content } = await topic();
  const text = `${content.title.bn}. ${content.tagline.bn}`;
  seedAudio(text);
  const request = requestFor("topic", id, "intro", text);
  for (const account of [student, parent]) {
    const table = account === student ? "students" : "adults";
    await assertAudio(request, account);
    fixture((db) => db.prepare(`UPDATE ${table} SET must_change_password=1 WHERE id=?`).run(account.id));
    assert.equal((await narrate(request, account)).status, 403);
    fixture((db) => db.prepare(`UPDATE ${table} SET must_change_password=0,status='suspended' WHERE id=?`).run(account.id));
    assert.equal((await narrate(request, account)).status, 401);
    fixture((db) => db.prepare(`UPDATE ${table} SET status='active',approval_status='declined' WHERE id=?`).run(account.id));
    assert.equal((await narrate(request, account)).status, 401);
    fixture((db) => db.prepare(`UPDATE ${table} SET approval_status='approved' WHERE id=?`).run(account.id));
    await assertAudio(request, account);
  }
});

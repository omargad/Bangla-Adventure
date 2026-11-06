import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { eq } from "drizzle-orm";

const directory = mkdtempSync(path.join(tmpdir(), "bangla-narration-handler-"));
process.env.DATABASE_PATH = path.join(directory, "test.db");
process.env.ELEVENLABS_API_KEY = "";
const { getDb } = await import("../db/index.ts");
const { adults, students, classes, classStudents, studentClassEnrollments, parentStudentLinks, classActivities } = await import("../db/schema.ts");
const { NarrationSourceError, resolveNarrationSource } = await import("../lib/narration-source.ts");
const { createNarrationHandler } = await import("../lib/narration-handler.ts");
const db = await getDb();
const audio = readFileSync(new URL("../public/audio/lesson-hello-me-word-1.ogg", import.meta.url));
after(() => rmSync(directory, { recursive: true, force: true }));

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const suffix = randomUUID();
  const ids = Object.fromEntries(["admin", "teacher", "otherTeacher", "parent", "student", "class", "roster", "enrollment", "link", "activity"].map((kind) => [kind, `${kind}-${suffix}`]));
  for (const role of ["admin", "teacher", "otherTeacher", "parent"]) {
    db.insert(adults).values({
      id: ids[role], email: `${ids[role]}@example.com`, displayName: role,
      passwordHash: "fixture-only", role: role === "otherTeacher" ? "teacher" : role,
      teacherStatus: role === "teacher" || role === "otherTeacher" ? "approved" : "none",
      approvalStatus: "approved",
    }).run();
  }
  db.insert(students).values({ id: ids.student, username: ids.student, displayName: "Maya", passwordHash: "fixture-only", approvalStatus: "approved" }).run();
  db.insert(classes).values({ id: ids.class, teacherId: ids.teacher, name: "River class", joinCode: suffix }).run();
  db.insert(classStudents).values({ id: ids.roster, classId: ids.class, displayName: "Maya", tokenHash: `fixture-token-${suffix}` }).run();
  db.insert(studentClassEnrollments).values({ id: ids.enrollment, classId: ids.class, classStudentId: ids.roster, studentId: ids.student, active: true }).run();
  db.insert(parentStudentLinks).values({ id: ids.link, parentId: ids.parent, studentId: ids.student }).run();
  const activity = {
    id: ids.activity, classId: ids.class, title: "River reading", instructions: "Read the class story.",
    questionsJson: JSON.stringify([{ prompt: "Which one is a river?", options: ["ANSWER-SECRET-CANARY-Padma", "Mountain"], answer: 0 }]),
    status: "open", approvalStatus: "approved", createdBy: ids.teacher, reviewedBy: ids.admin,
    reviewedAt: new Date().toISOString(),
  };
  db.insert(classActivities).values(activity).run();
  const text = `${activity.title}. ${activity.instructions}`;
  const source = { kind: "activity", id: activity.id, slot: "instructions", language: "en" };
  const request = () => new Request("http://localhost/api/narration", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...source, hash: createHash("sha256").update(text, "utf8").digest("hex"), part: 0 }),
  });
  const actor = (role) => ({ kind: role === "student" ? "student" : "adult", id: ids[role], key: `${role === "student" ? "student" : "adult"}:${ids[role]}` });
  const reject = () => db.update(classActivities).set({ approvalStatus: "rejected", reviewNote: "Admin requested a correction." }).where(eq(classActivities.id, ids.activity)).run();
  return { ids, text, source, request, actor, reject };
}

function delayedHandler(item, role, cached, getActor = async () => item.actor(role)) {
  const started = deferred(), release = deferred();
  const resolutions = [], generations = [];
  const handler = createNarrationHandler({
    getActor,
    resolveSource: async (actor, source) => {
      resolutions.push({ actor, source });
      return resolveNarrationSource(actor, source);
    },
    generate: async (...args) => {
      generations.push(args);
      started.resolve();
      await release.promise;
      return { audio, cached };
    },
    rateLimit: () => ({ allowed: true, retryAfterSeconds: 0 }),
  });
  return { handler, started, release, resolutions, generations };
}

async function assertPrivateRefusal(response, status = 404) {
  assert.equal(response.status, status);
  assert.match(response.headers.get("content-type"), /^application\/json/);
  assert.match(response.headers.get("cache-control"), /private.*no-store/);
  assert.equal(response.headers.get("x-narration-provider"), null);
  assert.doesNotMatch(await response.text(), /ANSWER-SECRET|Padma|Mountain|"answer"|OggS/);
}

test("a completed narration is returned only after the same authorized canonical text is resolved again", { timeout: 5000 }, async () => {
  const item = fixture();
  const pending = delayedHandler(item, "student", false);
  const responsePromise = pending.handler(item.request());
  await pending.started.promise;
  assert.equal(pending.resolutions.length, 1);
  pending.release.resolve();
  const response = await responsePromise;
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "audio/ogg");
  assert.equal(response.headers.get("x-narration-cache"), "miss");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), audio);
  assert.equal(pending.resolutions.length, 2);
  assert.deepEqual(pending.generations, [[item.text, "en", item.actor("student").key]]);
});

test("a session revoked during generation cannot receive the completed audio", { timeout: 5000 }, async () => {
  const item = fixture();
  let sessionChecks = 0;
  const pending = delayedHandler(item, "student", false, async () => {
    sessionChecks += 1;
    if (sessionChecks > 1) throw new NarrationSourceError(401, "Sign in to listen to this content.");
    return item.actor("student");
  });
  const responsePromise = pending.handler(item.request());
  await pending.started.promise;
  assert.equal(sessionChecks, 1);
  pending.release.resolve();
  await assertPrivateRefusal(await responsePromise, 401);
  assert.equal(sessionChecks, 2);
  assert.equal(pending.resolutions.length, 1, "an expired session is rejected before content is resolved again");
  assert.equal(pending.generations.length, 1);
});

for (const [name, role, cached, revoke] of [
  ["Admin rejection during generation revokes the student's response", "student", false, (item) => item.reject()],
  ["Admin rejection during a cache read revokes the linked parent's response", "parent", true, (item) => item.reject()],
  ["removing enrollment during generation revokes the student's response", "student", false, (item) => db.update(studentClassEnrollments).set({ active: false }).where(eq(studentClassEnrollments.id, item.ids.enrollment)).run()],
  ["unlinking a parent during a cache read revokes the parent's response", "parent", true, (item) => db.delete(parentStudentLinks).where(eq(parentStudentLinks.id, item.ids.link)).run()],
  ["changing class management during a cache read revokes the former teacher's preview", "teacher", true, (item) => db.update(classes).set({ teacherId: item.ids.otherTeacher }).where(eq(classes.id, item.ids.class)).run()],
]) {
  test(name, { timeout: 5000 }, async () => {
    const item = fixture();
    const pending = delayedHandler(item, role, cached);
    const responsePromise = pending.handler(item.request());
    await pending.started.promise;
    assert.equal(pending.resolutions.length, 1, "the first authorization completed before generation/cache retrieval");
    revoke(item);
    pending.release.resolve();
    await assertPrivateRefusal(await responsePromise);
    assert.equal(pending.resolutions.length, 2, "authorization was checked again after the delayed audio became available");
    assert.deepEqual(pending.generations, [[item.text, "en", item.actor(role).key]], "only canonical instructions reach the injected generator, never options or answers");
  });
}

test("a used-up account share is answered 429 in English and Bangla", async () => {
  const { NarrationError } = await import("../lib/generated-narration.ts");
  const item = fixture();
  const handler = createNarrationHandler({
    getActor: async () => item.actor("teacher"),
    resolveSource: resolveNarrationSource,
    generate: async () => { throw new NarrationError(429, "This account's narration allowance for today has been used. Saved audio is still available.", "আজকের জন্য এই অ্যাকাউন্টের কণ্ঠ তৈরির সীমা শেষ হয়ে গেছে। সংরক্ষিত অডিও এখনো শোনা যাবে।"); },
    rateLimit: () => ({ allowed: true, retryAfterSeconds: 0, resetAt: 0 }),
  });
  const response = await handler(item.request());
  assert.equal(response.status, 429);
  const body = await response.json();
  assert.equal(body.error, "This account's narration allowance for today has been used. Saved audio is still available.");
  assert.match(body.errorBn, /[ঀ-৿]/);
});

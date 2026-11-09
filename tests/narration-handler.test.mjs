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

test("staff hear an activity that is not approved and open only from saved audio, never newly generated", async () => {
  const { resolveNarration } = await import("../lib/narration-source.ts");
  const { createGeneratedNarration } = await import("../lib/generated-narration.ts");
  const item = fixture();
  const calls = [];
  const handlerFor = (role, generate) => createNarrationHandler({
    getActor: async () => item.actor(role), resolveSource: resolveNarration, rateLimit: () => ({ allowed: true, retryAfterSeconds: 0, resetAt: 0 }),
    generate: generate ?? (async (...args) => { calls.push(args); return { audio, cached: true }; }),
  });
  // Approved and open: generated as usual, for learners and staff alike.
  assert.deepEqual(await resolveNarration(item.actor("teacher"), item.source), { text: item.text, savedOnly: false });
  assert.equal((await handlerFor("student")(item.request())).status, 200);
  assert.deepEqual(calls.at(-1), [item.text, "en", item.actor("student").key]);

  // The owning teacher's activity sent back for changes: their preview may only play saved audio.
  db.update(classActivities).set({ approvalStatus: "pending" }).where(eq(classActivities.id, item.ids.activity)).run();
  for (const role of ["teacher", "admin"]) {
    assert.deepEqual(await resolveNarration(item.actor(role), item.source), { text: item.text, savedOnly: true });
    assert.equal((await handlerFor(role)(item.request())).status, 200);
    assert.deepEqual(calls.at(-1), [item.text, "en", item.actor(role).key, { savedOnly: true }]);
  }
  // With nothing saved, the real generator refuses without calling the provider.
  let provider = 0;
  const generator = createGeneratedNarration({ env: () => ({ MEDIA_ROOT: path.join(directory, "saved-only"), ELEVENLABS_API_KEY: "offline-narration-key" }), transport: async () => { provider += 1; throw new Error("must not call"); } });
  const refused = await handlerFor("teacher", generator)(item.request());
  assert.equal(refused.status, 409);
  assert.deepEqual(await refused.json(), { error: "New narration is made only for approved, open activities. Saved audio still plays.", errorBn: "নতুন কণ্ঠ শুধু অনুমোদিত ও খোলা কার্যক্রমের জন্য তৈরি হয়। সংরক্ষিত অডিও এখনো শোনা যাবে।" });
  assert.equal(provider, 0);
  // A closed activity is treated the same way.
  db.update(classActivities).set({ approvalStatus: "approved", status: "closed" }).where(eq(classActivities.id, item.ids.activity)).run();
  assert.equal((await resolveNarration(item.actor("teacher"), item.source)).savedOnly, true);
});

test("without a key, text with no saved audio is refused 503 with a stable code and both languages; the access checks still run first", async () => {
  const { createGeneratedNarration } = await import("../lib/generated-narration.ts");
  const { resolveNarration } = await import("../lib/narration-source.ts");
  const item = fixture();
  let provider = 0;
  const generator = createGeneratedNarration({ env: () => ({ MEDIA_ROOT: path.join(directory, "no-key"), ELEVENLABS_API_KEY: "" }), transport: async () => { provider += 1; throw new Error("must not call"); } });
  const handlerFor = (role) => createNarrationHandler({
    getActor: async () => item.actor(role), resolveSource: resolveNarration, generate: generator,
    rateLimit: () => ({ allowed: true, retryAfterSeconds: 0, resetAt: 0 }),
  });
  const response = await handlerFor("student")(item.request());
  assert.equal(response.status, 503);
  assert.match(response.headers.get("cache-control"), /private.*no-store/);
  assert.deepEqual(await response.json(), {
    error: "New narration is not configured. Saved audio is still available.",
    errorBn: "নতুন কণ্ঠ তৈরি চালু করা হয়নি। সংরক্ষিত অডিও এখনো শোনা যাবে।",
    code: "narration-not-configured",
  });
  assert.equal(provider, 0);
  // A reader without access is refused as before, and told nothing about configuration.
  item.reject();
  const refused = await handlerFor("student")(item.request());
  assert.equal((await refused.clone().json()).code, undefined);
  await assertPrivateRefusal(refused);
});

test("other narration failures carry no code, so the player shows them as errors", async () => {
  const { NarrationError } = await import("../lib/generated-narration.ts");
  const item = fixture();
  const handler = createNarrationHandler({
    getActor: async () => item.actor("student"), resolveSource: resolveNarrationSource,
    generate: async () => { throw new NarrationError(503, "Narration is busy. Please try again shortly."); },
    rateLimit: () => ({ allowed: true, retryAfterSeconds: 0, resetAt: 0 }),
  });
  const response = await handler(item.request());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Narration is busy. Please try again shortly." });
});

test("the narration status answers a signed-in reader with only a boolean, cached briefly, and refuses everyone else", async () => {
  const { createNarrationStatusHandler, NARRATION_STATUS_MAX_AGE_SECONDS } = await import("../lib/narration-handler.ts");
  const item = fixture();
  const limits = [];
  const statusFor = (getActor, configured, allowed = true) => createNarrationStatusHandler({
    getActor, configured,
    rateLimit: (key, limit, windowMs) => { limits.push([key, limit, windowMs]); return { allowed, retryAfterSeconds: 7, resetAt: 0 }; },
  });
  for (const value of [true, false]) {
    const response = await statusFor(async () => item.actor("student"), () => value)();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), `private, max-age=${NARRATION_STATUS_MAX_AGE_SECONDS}`);
    assert.ok(NARRATION_STATUS_MAX_AGE_SECONDS > 0 && NARRATION_STATUS_MAX_AGE_SECONDS <= 300);
    assert.deepEqual(await response.json(), { configured: value });
  }
  assert.deepEqual(limits.at(-1), [`narration-status:${item.actor("student").key}`, 60, 60_000]);
  // Anything but `true` is reported as false: the answer is only ever a boolean.
  assert.deepEqual(await (await statusFor(async () => item.actor("parent"), () => "secret-key-value")()).json(), { configured: false });
  const signedOut = await statusFor(async () => { throw new NarrationSourceError(401, "Sign in to listen to this content."); }, () => true)();
  assert.equal(signedOut.status, 401);
  assert.deepEqual(await signedOut.json(), { error: "Sign in to listen to this content." });
  assert.match(signedOut.headers.get("cache-control"), /no-store/);
  const passwordChange = await statusFor(async () => { throw new NarrationSourceError(403, "Choose your own password before you continue."); }, () => true)();
  assert.equal(passwordChange.status, 403);
  const limited = await statusFor(async () => item.actor("student"), () => true, false)();
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "7");
  const broken = await statusFor(async () => { throw new Error("database path /secret"); }, () => true)();
  assert.equal(broken.status, 503);
  assert.doesNotMatch(await broken.text(), /secret/);
});

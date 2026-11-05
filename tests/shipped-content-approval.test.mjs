import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema.ts";
import { bootstrapSql } from "../db/bootstrap.ts";
import { migrateAccessControl } from "../db/access-migration.ts";
import { migrateContent } from "../db/content-migration.ts";
import * as catalog from "../lib/curriculum-catalog.ts";
import * as approval from "../lib/lesson-approval.ts";
import { contentFingerprint, shippedLessonSnapshots } from "../lib/lesson-content.ts";
import { resolveNarrationSource } from "../lib/narration-source.ts";
import { createNarrationHandler } from "../lib/narration-handler.ts";
import { topicNarrationText } from "../lib/narration-model.ts";
import { topics } from "../app/topics-content.ts";

const legacy = JSON.parse(readFileSync(new URL("../db/content-baseline-9ca8.json", import.meta.url), "utf8"));
const withoutId = (value) => { const content = { ...value }; delete content.id; return content; };
const withoutMedia = (snapshot) => { const copy = structuredClone(snapshot); for (const field of ["video", "playlist", "extraVideos"]) delete copy.lesson[field]; return copy; };

async function withDatabase(isLegacy, callback, prepareLegacy = () => undefined) {
  const directory = mkdtempSync(path.join(tmpdir(), "bangla-release-snapshots-"));
  const sqlite = new Database(path.join(directory, "fixture.db"));
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(bootstrapSql);
  migrateAccessControl(sqlite);
  if (isLegacy) {
    // The actual pre-versioning publication schema; no new-engine approval shortcut.
    sqlite.exec(`CREATE TABLE content_approvals (
      id text PRIMARY KEY, content_type text NOT NULL, content_id text NOT NULL,
      status text NOT NULL, baseline integer NOT NULL DEFAULT 0,
      changed_by text REFERENCES adults(id), changed_at text NOT NULL, note text NOT NULL DEFAULT ''
    );
    CREATE TABLE content_migration_versions (id text PRIMARY KEY, applied_at text NOT NULL);
    INSERT INTO content_migration_versions VALUES ('admin_content_approval_v1', '2026-11-05T00:00:00Z');`);
    for (const { lesson } of legacy.lessons) sqlite.prepare("INSERT INTO content_approvals VALUES (?, 'lesson', ?, 'approved', 1, NULL, '2026-11-01T00:00:00Z', '')").run(`legacy-${lesson.id}`, lesson.id);
  }
  prepareLegacy(sqlite);
  migrateContent(sqlite);
  const db = drizzle(sqlite, { schema });
  globalThis.__banglaAdventuresDb = db;
  db.insert(schema.adults).values([
    { id: "admin", email: "admin@example.test", displayName: "Admin", role: "admin", passwordHash: "fixture", approvalStatus: "approved" },
    { id: "teacher", email: "teacher@example.test", displayName: "Teacher", role: "teacher", teacherStatus: "approved", passwordHash: "fixture", approvalStatus: "approved" },
  ]).run();
  db.insert(schema.students).values({ id: "student", username: "student", displayName: "Learner", passwordHash: "fixture", approvalStatus: "approved" }).run();
  try { await callback({ sqlite, db }); }
  finally { delete globalThis.__banglaAdventuresDb; sqlite.close(); rmSync(directory, { recursive: true, force: true }); }
}

test("fresh startup stages all 33 items once, exposes no baseline and keeps media separate from text approval", () => withDatabase(false, async ({ sqlite }) => {
  migrateContent(sqlite);
  assert.deepEqual(await catalog.getCatalog(), []);
  assert.deepEqual(await approval.learnerLessonView(), { approvedIds: [], videos: {}, snapshots: {} });
  assert.equal(sqlite.prepare("SELECT count(*) n FROM topic_versions WHERE status='pending'").get().n, 15);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM lesson_versions WHERE status='pending'").get().n, 18);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM content_approvals").get().n, 0);
  const topic = (await catalog.listStaffTopics())[0];
  assert.equal(topic.approved, null);
  await assert.rejects(catalog.getTopicVersion(topic.id, 0), (error) => error.status === 404);
  await catalog.reviewTopicVersion("admin", topic.id, 1, { decision: "approve", confirmedRead: true });
  assert.equal((await catalog.findApprovedTopic(topic.id)).baseline, false);

  const detail = await approval.lessonStudioDetail("hello-me");
  await assert.rejects(approval.decideLesson("teacher", "hello-me", { decision: "approve", confirmedRead: true, contentFingerprint: detail.contentFingerprint }), (error) => error.status === 403);
  for (const fingerprint of [undefined, "stale-fingerprint"]) await assert.rejects(approval.decideLesson("admin", "hello-me", { decision: "approve", confirmedRead: true, contentFingerprint: fingerprint }), (error) => error.status === 409);
  await approval.decideLesson("admin", "hello-me", { decision: "approve", confirmedRead: true, contentFingerprint: detail.contentFingerprint });
  let view = await approval.learnerLessonView();
  assert.deepEqual(view.approvedIds, ["hello-me"]);
  assert.deepEqual(withoutMedia(view.snapshots["hello-me"]), withoutMedia(detail.snapshot));
  assert.equal(view.snapshots["hello-me"].lesson.video.id, "");
  assert.equal(view.snapshots["hello-me"].lesson.playlist.id, "");
  assert.deepEqual(view.snapshots["hello-me"].lesson.extraVideos, []);
  assert.equal(JSON.stringify(view).includes(detail.snapshot.lesson.video.id), false, "withheld video ID cannot leak through the learner payload");
  assert.equal(JSON.stringify(view).includes(detail.snapshot.lesson.playlist.id), false, "withheld playlist cannot leak through the learner payload");
  assert.equal(view.videos["hello-me"], null, "text review does not publish an unreviewed external video");
  await approval.saveVideoReview("admin", { lessonId: "hello-me", videoId: detail.snapshot.lesson.video.id, contentFingerprint: detail.contentFingerprint, status: "approved", captionsStatus: "available", suitabilityStatus: "suitable" });
  view = await approval.learnerLessonView();
  assert.equal(view.videos["hello-me"].id, detail.snapshot.lesson.video.id);
}));

test("upgrading retains the exact old lesson and topic while changed source and Bangla copy wait for review", () => withDatabase(true, async ({ sqlite }) => {
  const before = await catalog.findApprovedTopic("folk-tales");
  const beforeContent = { ...before }; for (const field of ["id", "version", "baseline", "approvedAt"]) delete beforeContent[field];
  assert.deepEqual(withoutId(legacy.topics.find((item) => item.id === before.id)), beforeContent);
  const oldLesson = legacy.lessons.find((item) => item.lesson.id === "hello-me");
  assert.deepEqual(withoutMedia(await approval.getApprovedLessonSnapshot("hello-me")), withoutMedia(oldLesson));
  const candidate = await approval.lessonStudioDetail("hello-me");
  assert.ok(candidate.snapshot.banglaCopy);
  assert.equal(candidate.pendingRevision.version, 1);
  assert.equal(candidate.approval.baseline, true);
  assert.equal((await approval.learnerLessonView()).videos["hello-me"].id, oldLesson.lesson.video.id, "unchanged legacy primary media retains prior availability");
  const versions = sqlite.prepare("SELECT lesson_id, version, data_json, status FROM lesson_versions ORDER BY lesson_id,version").all();
  const topicVersions = sqlite.prepare("SELECT * FROM topic_versions ORDER BY topic_id,version").all();
  migrateContent(sqlite);
  assert.deepEqual(sqlite.prepare("SELECT lesson_id, version, data_json, status FROM lesson_versions ORDER BY lesson_id,version").all(), versions);
  assert.deepEqual(sqlite.prepare("SELECT * FROM topic_versions ORDER BY topic_id,version").all(), topicVersions);
  await approval.decideLesson("admin", "hello-me", { decision: "approve", confirmedRead: true, contentFingerprint: candidate.contentFingerprint });
  assert.deepEqual(withoutMedia(await approval.getApprovedLessonSnapshot("hello-me")), withoutMedia(candidate.snapshot));
  assert.equal((await approval.lessonStudioDetail("hello-me")).approval.baseline, false);
  assert.deepEqual(JSON.parse(sqlite.prepare("SELECT data_json FROM lesson_versions WHERE lesson_id='hello-me' AND version=0").get().data_json), oldLesson, "approved history's content is immutable");
  assert.equal(sqlite.pragma("integrity_check", { simple: true }), "ok");
  assert.deepEqual(sqlite.pragma("foreign_key_check"), []);
}));

test("pending source fixes leave quiz best and canonical narration unchanged; approval switches only the chosen revision", () => withDatabase(true, async ({ sqlite }) => {
  const id = "folk-tales";
  const before = await catalog.findApprovedTopic(id);
  await catalog.recordTopicProgress("student", id, before.quiz.map((question) => question.answer));
  const actor = { kind: "student", id: "student", key: "student:student" };
  const source = { kind: "topic", id, slot: "section:1", language: "en" };
  const spoken = await resolveNarrationSource(actor, source);
  assert.equal(spoken, topicNarrationText(before, "section:1", "en"));
  const progress = sqlite.prepare("SELECT * FROM student_topic_progress").all();
  const users = sqlite.prepare("SELECT * FROM adults ORDER BY id").all();
  migrateContent(sqlite);
  assert.deepEqual(sqlite.prepare("SELECT * FROM student_topic_progress").all(), progress);
  assert.deepEqual(sqlite.prepare("SELECT * FROM adults ORDER BY id").all(), users);
  assert.equal(await resolveNarrationSource(actor, source), spoken);
  assert.equal((await catalog.topicProgressFor("student", await catalog.getCatalog())).quizScores[id].best, before.quiz.length);
  const pending = await catalog.getStaffTopic(id);
  await catalog.reviewTopicVersion("admin", id, pending.head.version, { decision: "approve", confirmedRead: true });
  assert.deepEqual(withoutId(topics.find((item) => item.id === id)), (await catalog.getStaffTopic(id)).approved.content);
  assert.notEqual(await resolveNarrationSource(actor, source), spoken, "old cached text hash no longer matches canonical narration");
  assert.equal((await catalog.topicProgressFor("student", await catalog.getCatalog())).quizScores[id], undefined, "a changed approved quiz invalidates only the reported old best");
  assert.deepEqual(sqlite.prepare("SELECT * FROM student_topic_progress").all(), progress, "historical saved progress is preserved");
  await catalog.decideTopic("admin", id, { decision: "withdraw", note: "Review follow-up" });
  await assert.rejects(resolveNarrationSource(actor, source), (error) => error.status === 404);
}));

test("every canonical lesson field, added Bangla copy and support model belongs to its review fingerprint", () => {
  const original = shippedLessonSnapshots().find((item) => item.lesson.id === "numbers-colours");
  const hash = contentFingerprint(original);
  assert.equal(contentFingerprint(JSON.parse(JSON.stringify(original))), hash);
  for (const change of [
    (item) => { item.lesson.canDo += " changed"; },
    (item) => { item.extension.watch.segment += " changed"; },
    (item) => { item.banglaCopy.extension.listening.focus += " পরিবর্তন"; },
    (item) => { item.banglaCopy.lesson.quiz[0].options[0] += " পরিবর্তন"; },
    (item) => { item.supportModel = null; },
  ]) {
    const candidate = structuredClone(original); change(candidate);
    assert.notEqual(contentFingerprint(candidate), hash);
  }
});

test("a source revision arriving after preview is not approved by a stale confirmation and a withdrawal survives startup", () => withDatabase(true, async ({ sqlite }) => {
  const id = "hello-me", preview = await approval.lessonStudioDetail(id);
  const next = structuredClone(preview.snapshot); next.banglaCopy.lesson.canDo += " পরিবর্তন";
  sqlite.prepare("INSERT INTO lesson_versions (id,lesson_id,version,data_json,fingerprint,status,created_at) VALUES ('later',?,?,?,?,'pending','2026-11-06T00:00:00Z')").run(id, preview.pendingRevision.version + 1, JSON.stringify(next), contentFingerprint(next));
  await assert.rejects(approval.decideLesson("admin", id, { decision: "approve", confirmedRead: true, contentFingerprint: preview.contentFingerprint }), (error) => error.status === 409);
  assert.deepEqual(withoutMedia(await approval.getApprovedLessonSnapshot(id)), withoutMedia(legacy.lessons.find((item) => item.lesson.id === id)));
  await approval.decideLesson("admin", id, { decision: "withdraw", note: "Review this first" });
  migrateContent(sqlite);
  assert.equal(await approval.getApprovedLessonSnapshot(id), null);
  assert.equal(await approval.isLessonApproved(id), false);
  const fresh = await approval.lessonStudioDetail(id);
  await approval.decideLesson("admin", id, { decision: "approve", confirmedRead: true, contentFingerprint: fresh.contentFingerprint });
  assert.deepEqual(withoutMedia(await approval.getApprovedLessonSnapshot(id)), withoutMedia(next));
  assert.equal(sqlite.prepare("SELECT count(*) n FROM lesson_versions WHERE lesson_id=? AND status='approved'").get(id).n, 1);
}));


test("approved custom topic snapshots survive an upgrade; a shipped correction is a later pending proposal", () => {
  const custom = structuredClone(withoutId(legacy.topics.find((item) => item.id === "folk-tales")));
  custom.tagline.en = "A locally reviewed introduction";
  return withDatabase(true, async ({ sqlite }) => {
    const topic = await catalog.findApprovedTopic("folk-tales");
    assert.equal(topic.version, 7);
    assert.equal(topic.baseline, false);
    assert.equal(topic.tagline.en, custom.tagline.en);
    const staff = await catalog.getStaffTopic("folk-tales");
    assert.equal(staff.head.version, 8);
    assert.equal(staff.head.status, "pending");
    assert.equal(staff.versions.find((item) => item.version === 8).basedOn, 7);
    assert.deepEqual(JSON.parse(sqlite.prepare("SELECT data_json FROM topic_versions WHERE topic_id='folk-tales' AND version=7").get().data_json), custom);
    const rows = sqlite.prepare("SELECT * FROM topic_versions WHERE topic_id='folk-tales' ORDER BY version").all();
    migrateContent(sqlite);
    assert.deepEqual(sqlite.prepare("SELECT * FROM topic_versions WHERE topic_id='folk-tales' ORDER BY version").all(), rows);
  }, (sqlite) => {
    sqlite.exec(`CREATE TABLE topic_versions (
      id text PRIMARY KEY, topic_id text NOT NULL, version integer NOT NULL,
      data_json text NOT NULL, status text NOT NULL, baseline integer NOT NULL DEFAULT 0,
      based_on integer, created_by text REFERENCES adults(id), created_at text NOT NULL,
      reviewed_by text REFERENCES adults(id), reviewed_at text, review_note text NOT NULL DEFAULT ''
    );`);
    sqlite.prepare("INSERT INTO topic_versions (id,topic_id,version,data_json,status,created_at,reviewed_at,review_note) VALUES ('custom','folk-tales',7,?,'approved','2026-11-01T00:00:00Z','2026-11-02T00:00:00Z','Approved before this release')").run(JSON.stringify(custom));
  });
});

test("pending and superseded narration hashes are rejected before generation or cached audio retrieval", () => withDatabase(true, async () => {
  const id = "folk-tales", source = { kind: "topic", id, slot: "section:1", language: "en", part: 0 };
  const oldText = topicNarrationText(await catalog.findApprovedTopic(id), source.slot, source.language);
  const staff = await catalog.getStaffTopic(id);
  const newText = topicNarrationText(staff.head.content, source.slot, source.language);
  assert.notEqual(oldText, newText);
  let cacheReads = 0;
  const handler = createNarrationHandler({
    getActor: async () => ({ kind: "student", id: "student", key: "student:student" }),
    resolveSource: resolveNarrationSource,
    rateLimit: () => ({ allowed: true }),
    generate: async () => { cacheReads++; return { audio: new Uint8Array([1,2,3]), cached: true }; },
  });
  const request = (text) => new Request("http://fixture.test/api/narration", { method: "POST", body: JSON.stringify({ ...source, hash: createHash("sha256").update(text).digest("hex") }) });
  assert.equal((await handler(request(newText))).status, 409);
  assert.equal(cacheReads, 0, "unapproved text cannot retrieve a cached clip or cause generation");
  assert.equal((await handler(request(oldText))).status, 200);
  assert.equal(cacheReads, 1);
  await catalog.reviewTopicVersion("admin", id, staff.head.version, { decision: "approve", confirmedRead: true });
  assert.equal((await handler(request(oldText))).status, 409);
  assert.equal(cacheReads, 1, "an old approved hash cannot retrieve the old audio after publication changes");
  assert.equal((await handler(request(newText))).status, 200);
  assert.equal(cacheReads, 2);
}));

test("an empty old approval table is not evidence of a legacy published installation", () => withDatabase(true, async () => {
  assert.deepEqual(await catalog.getCatalog(), []);
  assert.deepEqual(await approval.approvedLessonIds(), []);
}, (sqlite) => sqlite.exec("DELETE FROM content_approvals")));


test("populated pre-approval installations retain their old availability and learner records", async () => {
  let original;
  await withDatabase(false, async ({ sqlite }) => {
    assert.equal((await catalog.getCatalog()).length, 15);
    assert.equal((await approval.approvedLessonIds()).length, 18);
    assert.equal((await approval.getApprovedLessonSnapshot("hello-me")).banglaCopy, null);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM content_approvals WHERE baseline=1").get().n, 18);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM lesson_versions WHERE status='pending'").get().n, 18);
    assert.equal((await approval.lessonStudioDetail("hello-me")).approval.baseline, true);
    migrateContent(sqlite);
    assert.deepEqual(sqlite.prepare("SELECT * FROM skill_progress WHERE id='old-progress'").get(), original);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM content_approvals WHERE baseline=1").get().n, 18);
    assert.deepEqual(sqlite.pragma("foreign_key_check"), []);
  }, (sqlite) => {
    sqlite.exec("INSERT INTO adults (id,email,display_name,password_hash) VALUES ('old-parent','old@example.test','Old parent','fixture'); INSERT INTO learner_profiles (id,owner_email,display_name) VALUES ('old-learner','old@example.test','Old learner'); INSERT INTO skill_progress (id,profile_id,lesson_id,session_id,skill,score) VALUES ('old-progress','old-learner','hello-me','hello-me-reading','reading',2)");
    original = sqlite.prepare("SELECT * FROM skill_progress WHERE id='old-progress'").get();
    assert.equal(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='content_approvals'").get(), undefined);
  });
});

test("an unrelated approval row in an otherwise blank installation does not publish legacy baselines", () => withDatabase(true, async ({ sqlite }) => {
  assert.deepEqual(await catalog.getCatalog(), []);
  assert.deepEqual(await approval.approvedLessonIds(), []);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM lesson_versions WHERE version=0").get().n, 0);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM topic_versions WHERE status='pending'").get().n, 15);
}, (sqlite) => {
  sqlite.exec("DELETE FROM content_approvals; INSERT INTO content_approvals VALUES ('unrelated','unrelated','unknown','approved',1,NULL,'2026-11-01T00:00:00Z','')");
}));

for (const status of ["approved", "withdrawn"]) test(`existing individually reviewed ${status} lesson decisions retain their publication state without baseline rows`, () => withDatabase(true, async ({ sqlite }) => {
  assert.equal((await catalog.getCatalog()).length, 15);
  assert.equal((await approval.approvedLessonIds()).length, status === "approved" ? 18 : 0);
  const detail = await approval.lessonStudioDetail("hello-me");
  assert.equal(detail.approval.status, status);
  assert.equal(detail.approval.baseline, false);
  assert.equal(detail.pendingRevision.version, 1);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM lesson_versions WHERE version=0").get().n, 18);
  migrateContent(sqlite);
  assert.equal((await approval.approvedLessonIds()).length, status === "approved" ? 18 : 0);
}, (sqlite) => {
  sqlite.exec("INSERT INTO adults (id,email,display_name,password_hash,role) VALUES ('old-admin','old-admin@example.test','Old Admin','fixture','admin')");
  sqlite.prepare("UPDATE content_approvals SET baseline=0,changed_by='old-admin',status=?").run(status);
}));

test("video decisions bind the stored preview and new-video approval cannot erase an old-video withdrawal", () => withDatabase(true, async ({ sqlite }) => {
  const id = "hello-me", first = await approval.lessonStudioDetail(id);
  const oldRow = sqlite.prepare("SELECT * FROM video_reviews WHERE id='old-video-decision'").get();
  assert.deepEqual(sqlite.prepare("PRAGMA index_info(video_reviews_lesson_unique)").all().map((column) => column.name), ["owner_email","lesson_id","video_id"]);
  assert.equal((await approval.learnerLessonView()).videos[id], null);
  const body = { lessonId: id, videoId: first.snapshot.lesson.video.id, contentFingerprint: first.contentFingerprint, status: "approved", captionsStatus: "available", suitabilityStatus: "suitable" };
  for (const status of ["approved","pending","replace","unavailable"]) {
    await assert.rejects(approval.saveVideoReview("admin", { ...body, status, contentFingerprint: "stale" }), (error) => error.status === 409);
    await assert.rejects(approval.saveVideoReview("admin", { ...body, status, videoId: "unseen-id" }), (error) => error.status === 409);
  }
  await assert.rejects(approval.saveVideoReview("admin", { lessonId: id, status: "approved" }), (error) => error.status === 409);
  const next = structuredClone(first.snapshot);
  next.lesson.video.id = "ZjUjsrN3qi0";
  const fingerprint = contentFingerprint(next);
  sqlite.prepare("INSERT INTO lesson_versions (id,lesson_id,version,data_json,fingerprint,status,created_at) VALUES ('new-video-candidate',?,?,?,?,'pending','2026-11-06T00:00:00Z')").run(id, first.pendingRevision.version+1, JSON.stringify(next), fingerprint);
  await assert.rejects(approval.saveVideoReview("admin", body), (error) => error.status === 409);
  await assert.rejects(approval.saveVideoReview("admin", { ...body, contentFingerprint: fingerprint }), (error) => error.status === 409, "a current hash cannot authorize the wrong video ID");
  await approval.saveVideoReview("admin", { ...body, videoId: next.lesson.video.id, contentFingerprint: fingerprint });
  assert.equal(sqlite.prepare("SELECT count(*) n FROM video_reviews WHERE owner_email='admin@example.test' AND lesson_id=?").get(id).n, 2);
  assert.deepEqual(sqlite.prepare("SELECT * FROM video_reviews WHERE id='old-video-decision'").get(), oldRow);
  assert.equal((await approval.learnerLessonView()).videos[id], null, "pending candidate media approval cannot revive the withdrawn published video");
  assert.equal((await approval.lessonStudioDetail(id)).learnerVideo, null, "Studio reports the actual published media, not the pending candidate's media");
  assert.equal((await approval.lessonStudioDetail(id)).candidateVideo.id, next.lesson.video.id);
  await approval.decideLesson("admin", id, { decision: "approve", confirmedRead: true, contentFingerprint: fingerprint });
  assert.equal((await approval.learnerLessonView()).videos[id].id, next.lesson.video.id);
  migrateContent(sqlite);
  assert.deepEqual(sqlite.prepare("SELECT * FROM video_reviews WHERE id='old-video-decision'").get(), oldRow);
  assert.deepEqual(sqlite.pragma("foreign_key_check"), []);
}, (sqlite) => {
  sqlite.exec("DROP INDEX video_reviews_lesson_unique; CREATE UNIQUE INDEX video_reviews_lesson_unique ON video_reviews(owner_email,lesson_id); ALTER TABLE video_reviews ADD COLUMN admin_decided_at text");
  sqlite.prepare("INSERT INTO video_reviews (id,owner_email,lesson_id,video_id,status,checked_at,updated_at,admin_decided_at) VALUES ('old-video-decision','admin@example.test','hello-me',?,'unavailable','2026-11-02T00:00:00Z','2026-11-02T00:00:00Z','2026-11-02T00:00:00Z')").run(legacy.lessons.find((item) => item.lesson.id === "hello-me").lesson.video.id);
}));

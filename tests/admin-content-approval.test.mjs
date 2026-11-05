import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const dir = mkdtempSync(path.join(tmpdir(), "bangla-admin-content-"));
process.env.DATABASE_PATH = path.join(dir, "test.db");
const { getDb } = await import("../db/index.ts");
const { adults, mediaAssets } = await import("../db/schema.ts");
const catalog = await import("../lib/curriculum-catalog.ts");
const approval = await import("../lib/lesson-approval.ts");
const { canPublishContent } = await import("../lib/roles.ts");
const db = await getDb();
const accounts = [
  { id: "admin", role: "admin" },
  { id: "teacher", role: "teacher", teacherStatus: "approved" },
  { id: "other-teacher", role: "teacher", teacherStatus: "approved" },
  { id: "parent", role: "parent" },
  { id: "suspended-admin", role: "admin", status: "suspended" },
  { id: "pending-admin", role: "admin", approvalStatus: "pending" },
  { id: "declined-admin", role: "admin", approvalStatus: "declined" },
  { id: "temporary-admin", role: "admin", mustChangePassword: true },
];
db.insert(adults).values(accounts.map((account) => ({
  email: `${account.id}@example.test`, displayName: account.id, passwordHash: "test-fixture-only",
  approvalStatus: "approved", status: "active", teacherStatus: "none", ...account,
}))).run();
const pair = (en, bn) => ({ en, bn });
const topic = {
  theme: "our-country", emoji: "🌊", title: pair("River journeys", "নদীপথে ভ্রমণ"),
  tagline: pair("Learning beside a river.", "নদীর পাশে শেখা।"), minutes: 3,
  sections: [{ heading: pair("Boats", "নৌকা"), body: pair("Boats carry people across rivers.", "নৌকা মানুষকে নদী পার করে।") }],
  funFacts: [], quiz: [],
};
const own = await catalog.createTopic("teacher", topic);
const other = await catalog.createTopic("other-teacher", { ...topic, title: pair("River homes", "নদীর পাশে বাড়ি") });
const media = (id, owner) => ({
  id, ownerEmail: `${owner}@example.test`, lessonId: "hello-me", slot: "dialogue",
  objectKey: `human-audio/${id}.ogg`, originalName: `${id}.ogg`, contentType: "audio/ogg",
  byteSize: 100, speakerName: "Demo speaker", dialect: "Dhaka", consentConfirmed: true, reviewStatus: "pending",
});
db.insert(mediaAssets).values([media("own-recording", "teacher"), media("other-recording", "other-teacher")]).run();
const sqlite = new Database(process.env.DATABASE_PATH);
const snapshot = () => Object.fromEntries(["topic_versions", "content_approvals", "content_reviews", "media_assets", "video_reviews", "user_audit_events"].map((name) => [name, sqlite.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]));
after(() => { sqlite.close(); rmSync(dir, { recursive: true, force: true }); });

const video = { lessonId: "my-family", status: "approved", captionsStatus: "available", suitabilityStatus: "suitable", replacementUrl: "", notes: "Reviewed for the demo class." };
const forbidden = (error) => error.status === 403;

test("publishing requires an approved active administrator with a permanent password", () => {
  assert.equal(canPublishContent(null), false);
  for (const account of db.select().from(adults).all()) assert.equal(canPublishContent(account), account.id === "admin", account.id);
});

test("teachers cannot publish their own or another teacher's topic, recording, lesson or video through direct helpers", async () => {
  const before = snapshot();
  for (const actor of ["teacher", "other-teacher"]) {
    for (const { topicId } of [own, other]) {
      for (const decision of ["approve", "reject"]) {
        await assert.rejects(catalog.reviewTopicVersion(actor, topicId, 1, { decision, confirmedRead: true, note: "Forged review" }), forbidden);
      }
    }
    for (const decision of ["confirm", "withdraw", "approve"]) {
      await assert.rejects(catalog.decideTopic(actor, "national-symbols", { decision, confirmedRead: true, note: "Forged shared decision" }), forbidden);
    }
    for (const decision of ["approve", "withdraw"]) {
      await assert.rejects(approval.decideLesson(actor, "hello-me", { decision, confirmedRead: true, note: "Forged lesson decision" }), forbidden);
    }
    for (const id of ["own-recording", "other-recording"]) {
      for (const reviewStatus of ["pending", "approved", "changes-requested", "retired"]) {
        await assert.rejects(approval.reviewRecording(actor, { id, reviewStatus, confirmedListened: true }), forbidden);
      }
    }
    for (const status of ["pending", "approved", "replace", "unavailable"]) {
      await assert.rejects(approval.saveVideoReview(actor, { ...video, status }), forbidden);
    }
    for (const suitabilityStatus of ["unchecked", "suitable", "supervision-required", "unsuitable"]) {
      await assert.rejects(approval.saveVideoReview(actor, { ...video, suitabilityStatus }), forbidden);
    }
  }
  assert.deepEqual(snapshot(), before, "a denied review changes neither content, publication state nor audit history");
  assert.equal(await catalog.findApprovedTopic(own.topicId), null);
  assert.equal(await approval.approvedRecording("hello-me", "dialogue"), null);
});

test("stale or forged administrator identities cannot mutate publication through direct helpers", async () => {
  const before = snapshot();
  for (const actor of ["parent", "suspended-admin", "pending-admin", "declined-admin", "temporary-admin", "not-an-account"]) {
    await assert.rejects(catalog.reviewTopicVersion(actor, own.topicId, 1, { decision: "approve", confirmedRead: true }), forbidden);
    await assert.rejects(catalog.decideTopic(actor, "national-symbols", { decision: "withdraw", note: "Forged decision" }), forbidden);
    await assert.rejects(approval.decideLesson(actor, "hello-me", { decision: "withdraw", note: "Forged decision" }), forbidden);
    await assert.rejects(approval.reviewRecording(actor, { id: "own-recording", reviewStatus: "approved", confirmedListened: true }), forbidden);
    await assert.rejects(approval.saveVideoReview(actor, video), forbidden);
  }
  assert.deepEqual(snapshot(), before);
});

test("an administrator publishes after explicit review and denied teacher restores cannot undo withdrawal", async () => {
  await catalog.reviewTopicVersion("admin", own.topicId, 1, { decision: "approve", confirmedRead: true });
  assert.equal((await catalog.findApprovedTopic(own.topicId)).title.en, topic.title.en);
  await catalog.decideTopic("admin", own.topicId, { decision: "withdraw", note: "Check the river description." });
  const before = snapshot();
  await assert.rejects(catalog.decideTopic("teacher", own.topicId, { decision: "approve", confirmedRead: true }), forbidden);
  assert.deepEqual(snapshot(), before);
  assert.equal(await catalog.findApprovedTopic(own.topicId), null);
  await catalog.decideTopic("admin", own.topicId, { decision: "approve", confirmedRead: true });
  assert.ok(await catalog.findApprovedTopic(own.topicId));

  await approval.decideLesson("admin", "hello-me", { decision: "withdraw", note: "Check the lesson." });
  await assert.rejects(approval.decideLesson("teacher", "hello-me", { decision: "approve", confirmedRead: true }), forbidden);
  assert.equal(await approval.isLessonApproved("hello-me"), false);
  await approval.decideLesson("admin", "hello-me", { decision: "approve", confirmedRead: true });
  assert.equal(await approval.isLessonApproved("hello-me"), true);
  await approval.reviewRecording("admin", { id: "own-recording", reviewStatus: "approved", confirmedListened: true });
  assert.equal((await approval.approvedRecording("hello-me", "dialogue")).reviewedBy, "admin");
  await approval.saveVideoReview("admin", { ...video, suitabilityStatus: "unsuitable" });
  assert.equal((await approval.learnerLessonView()).videos["my-family"], null);
  const changed = sqlite.prepare("SELECT DISTINCT actor_id FROM user_audit_events WHERE action LIKE 'lesson-%' OR action LIKE 'topic-%' AND action NOT IN ('topic-created', 'topic-edit-submitted')").all();
  assert.deepEqual(changed, [{ actor_id: "admin" }]);
});

test("legacy teacher baseline confirmations remain history until a proven Admin confirms, even after later role changes", async () => {
  const topicId = "folk-tales";
  const original = await catalog.findApprovedTopic(topicId);
  assert.ok(original?.baseline);
  const oldId = "legacy-teacher-confirmation";
  sqlite.prepare("INSERT INTO content_approvals (id, content_type, content_id, status, baseline, changed_by, changed_at, note) VALUES (?, 'topic', ?, 'approved', 0, 'teacher', '2025-01-01T00:00:00Z', 'Historical teacher review')").run(oldId, topicId);
  sqlite.prepare("INSERT INTO user_audit_events (id, actor_id, target_id, target_type, action, details_json) VALUES ('legacy-confirm-audit', 'teacher', ?, 'topic', 'topic-review-confirmed', '{\"version\":0}')").run(topicId);
  const historical = sqlite.prepare("SELECT * FROM content_approvals WHERE id = ?").get(oldId);
  assert.equal((await catalog.getStaffTopic(topicId)).baselineReview, null);
  assert.equal((await catalog.listStaffTopics()).find((item) => item.id === topicId).baselineReview, null);
  assert.deepEqual(await catalog.findApprovedTopic(topicId), original, "the shipped baseline remains available while Admin review waits");

  sqlite.prepare("UPDATE adults SET role = 'admin' WHERE id = 'teacher'").run();
  assert.equal((await catalog.getStaffTopic(topicId)).baselineReview, null, "a later promotion does not turn an old teacher review into an Admin decision");
  sqlite.prepare("UPDATE adults SET role = 'teacher' WHERE id = 'teacher'").run();
  db.insert(adults).values({ id: "baseline-publisher", email: "baseline-publisher@example.test", displayName: "Baseline administrator", passwordHash: "test-fixture-only", role: "admin", approvalStatus: "approved" }).run();
  await catalog.decideTopic("baseline-publisher", topicId, { decision: "confirm", confirmedRead: true, note: "Administrator read the complete baseline." });
  const detail = await catalog.getStaffTopic(topicId);
  assert.deepEqual(detail.decisions.map((item) => [item.kind, item.changedByName]), [["confirmed", "teacher"], ["confirmed", "Baseline administrator"]]);
  assert.equal(detail.baselineReview.changedByName, "Baseline administrator");
  assert.deepEqual(sqlite.prepare("SELECT * FROM content_approvals WHERE id = ?").get(oldId), historical, "the legacy decision is never rewritten or attributed to the administrator");
  const latest = sqlite.prepare("SELECT id FROM content_approvals WHERE content_id = ? ORDER BY rowid DESC LIMIT 1").get(topicId);
  const audit = sqlite.prepare("SELECT details_json FROM user_audit_events WHERE actor_id = 'baseline-publisher' AND target_id = ?").get(topicId);
  assert.deepEqual(JSON.parse(audit.details_json), { version: 0, publicationDecisionId: latest.id, publisherRole: "admin", note: "Administrator read the complete baseline." });

  sqlite.prepare("UPDATE adults SET role = 'parent' WHERE id = 'baseline-publisher'").run();
  assert.equal((await catalog.getStaffTopic(topicId)).baselineReview.changedByName, "Baseline administrator", "authority is recorded at decision time");
  await assert.rejects(catalog.decideTopic("admin", topicId, { decision: "confirm", confirmedRead: true }), (error) => error.status === 409);
  sqlite.prepare("DELETE FROM adults WHERE id = 'baseline-publisher'").run();
  const afterDeletion = await catalog.getStaffTopic(topicId);
  assert.equal(afterDeletion.baselineReview.kind, "confirmed");
  assert.equal(afterDeletion.baselineReview.changedByName, null, "deletion removes account attribution without erasing the actual review");
  assert.equal(afterDeletion.decisions.length, 2);
  await assert.rejects(catalog.decideTopic("admin", topicId, { decision: "confirm", confirmedRead: true }), (error) => error.status === 409);
  assert.deepEqual(await catalog.findApprovedTopic(topicId), original);
});


test("Admin approval of a held legacy custom version records an individual review instead of a baseline", async () => {
  const { topicId } = await catalog.createTopic("teacher", { ...topic, title: pair("Legacy river lesson", "নদীর পুরোনো পাঠ") });
  // The old importer labelled custom versions as baselines; the policy migration holds them pending.
  sqlite.prepare("UPDATE topic_versions SET baseline = 1 WHERE topic_id = ?").run(topicId);
  const before = sqlite.prepare("SELECT data_json, created_by FROM topic_versions WHERE topic_id = ?").get(topicId);
  assert.equal((await catalog.getStaffTopic(topicId)).versions[0].baseline, true);
  assert.equal(await catalog.findApprovedTopic(topicId), null);

  await catalog.reviewTopicVersion("admin", topicId, 1, { decision: "approve", confirmedRead: true, note: "Individually reviewed by the administrator." });
  const shown = await catalog.findApprovedTopic(topicId);
  assert.equal(shown.baseline, false);
  assert.equal(shown.title.en, "Legacy river lesson");
  const detail = await catalog.getStaffTopic(topicId);
  assert.deepEqual(detail.versions.map(({ baseline, status, reviewerName }) => ({ baseline, status, reviewerName })), [{ baseline: false, status: "approved", reviewerName: "admin" }]);
  assert.equal(detail.baselineReview, null, "the UI shows the version's actual Admin reviewer, not an unreviewed baseline label");
  assert.deepEqual(sqlite.prepare("SELECT data_json, created_by FROM topic_versions WHERE topic_id = ?").get(topicId), before, "review leaves authored content and attribution intact");
});

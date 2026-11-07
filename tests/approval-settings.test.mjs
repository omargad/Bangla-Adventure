import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";

// Who approves what: an administrator's own topics and recordings publish at once; a teacher's topic
// waits unless an administrator turns "Teachers' topics need an administrator's approval" off.
const dir = mkdtempSync(path.join(tmpdir(), "bangla-approval-settings-"));
process.env.DATABASE_PATH = path.join(dir, "test.db");
const { getDb } = await import("../db/index.ts");
const { adults, appSettings, mediaAssets, userAuditEvents } = await import("../db/schema.ts");
const { bootstrapSql } = await import("../db/bootstrap.ts");
const { migrateAccessControl } = await import("../db/access-migration.ts");
const { migrateContent } = await import("../db/content-migration.ts");
const settings = await import("../lib/approval-settings.ts");
const catalog = await import("../lib/curriculum-catalog.ts");
const lessons = await import("../lib/lesson-approval.ts");
const { savedMessage, publishedDirectlyLabel } = await import("../app/teach/topics/shared.ts");
const { settingChangedMessage, stillWaiting } = await import("../app/teach/topics/ApprovalSetting.tsx");
const db = await getDb();
db.insert(adults).values([
  { id: "admin", email: "admin@example.com", displayName: "Admin Ayesha", role: "admin", passwordHash: "fixture", approvalStatus: "approved" },
  { id: "temp-admin", email: "temp@example.com", displayName: "Admin Temp", role: "admin", passwordHash: "fixture", approvalStatus: "approved", mustChangePassword: true },
  { id: "teacher", email: "teacher@example.com", displayName: "Teacher Tania", role: "teacher", teacherStatus: "approved", passwordHash: "fixture", approvalStatus: "approved" },
  { id: "parent", email: "parent@example.com", displayName: "Parent", passwordHash: "fixture", approvalStatus: "approved" },
]).run();
after(() => rmSync(dir, { recursive: true, force: true }));

const pair = (en, bn) => ({ en, bn });
const draft = (title, overrides = {}) => ({
  theme: "our-country", emoji: "🏞️", title: pair(title, `${title} (বাংলা)`), tagline: pair("A short reading.", "ছোট একটি লেখা।"), minutes: 4,
  sections: [{ heading: pair("Part one", "প্রথম অংশ"), body: pair("Some reading text.", "কিছু পড়ার লেখা।") }],
  funFacts: [], quiz: [], ...overrides,
});
const events = (targetId) => db.select().from(userAuditEvents).all().filter((event) => event.targetId === targetId).map((event) => [event.action, event.actorId, JSON.parse(event.detailsJson)]);
const learnerIds = async () => (await catalog.getCatalog()).map((topic) => topic.id);
const versionsOf = async (id) => (await catalog.getStaffTopic(id)).versions.filter((version) => version.version > 0).map((version) => [version.version, version.status, version.publishedDirectly]);
const setApproval = (actor, on) => settings.setTeacherTopicApproval(actor, { teacherTopicsNeedApproval: on });

test("with no stored setting a teacher's topic waits, and only an administrator can change the setting", async () => {
  assert.equal(db.select().from(appSettings).all().length, 0, "nothing is stored until an administrator changes it");
  assert.equal(settings.teacherTopicsNeedApproval(db), true, "an absent setting means approval is on");
  assert.deepEqual(await settings.getApprovalSettings(), {
    teacherTopicsNeedApproval: true, teacherActivitiesNeedApproval: true, teacherSourcesNeedApproval: true, changedByName: null, changedAt: null,
    lastChanged: { teacherTopicsNeedApproval: null, teacherActivitiesNeedApproval: null, teacherSourcesNeedApproval: null },
  });
  assert.equal((await catalog.topicPublishing("teacher")).onSave, "review");
  assert.equal((await catalog.topicPublishing("admin")).onSave, "admin");

  const saved = await catalog.createTopic("teacher", draft("River ferries"));
  assert.deepEqual({ status: saved.status, publishedDirectly: saved.publishedDirectly }, { status: "pending", publishedDirectly: null });
  assert.equal((await learnerIds()).includes(saved.topicId), false);
  assert.deepEqual(events(saved.topicId).map(([action]) => action), ["topic-created"]);

  for (const actor of ["teacher", "parent", "temp-admin", "nobody"]) {
    await assert.rejects(setApproval(actor, false), (error) => error.status === 403 && /Only an administrator/.test(error.message) && error.messageBn.length > 0, actor);
  }
  for (const body of [{}, { teacherTopicsNeedApproval: "false" }, null, { teacherTopicsNeedApproval: 0 }]) {
    await assert.rejects(settings.setTeacherTopicApproval("admin", body), (error) => error.status === 400 && error.messageBn.length > 0, JSON.stringify(body));
  }
  assert.equal(settings.teacherTopicsNeedApproval(db), true, "refused changes store nothing");
  assert.equal(events(settings.TEACHER_TOPIC_APPROVAL).length, 0);
});

test("an administrator's own new topic and edits are published at once and audited as their approval", async () => {
  const created = await catalog.createTopic("admin", draft("Boats of the Padma"));
  assert.deepEqual(created, { topicId: created.topicId, version: 1, status: "approved", publishedDirectly: "admin", superseded: [], restored: false });
  assert.ok((await learnerIds()).includes(created.topicId), "students see it without a review step");
  const [summary] = (await catalog.getStaffTopic(created.topicId)).versions;
  assert.equal(summary.reviewerName, "Admin Ayesha");
  assert.equal(summary.publishedDirectly, "admin");
  assert.ok(summary.reviewedAt);
  assert.deepEqual(events(created.topicId), [["topic-created", "admin", { version: 1, theme: "our-country" }], ["topic-version-approved", "admin", { version: 1, self: true }]]);
  assert.deepEqual((await catalog.listStaffTopics()).find((topic) => topic.id === created.topicId).pendingVersions, [], "nothing waits for approval");

  const edited = await catalog.submitTopicEdit("admin", created.topicId, { ...draft("Boats of the Padma", { minutes: 6 }), baseVersion: 1 });
  assert.equal(edited.status, "approved");
  assert.equal((await catalog.findApprovedTopic(created.topicId)).minutes, 6);
  assert.deepEqual(await versionsOf(created.topicId), [[1, "superseded", "admin"], [2, "approved", "admin"]]);
  assert.deepEqual(events(created.topicId).slice(2).map(([action, , details]) => [action, details]), [["topic-edit-submitted", { version: 2, basedOn: 1 }], ["topic-version-approved", { version: 2, self: true }]]);

  // A shipped topic an administrator edits is published over the shipped text too.
  const head = (await catalog.getStaffTopic("national-symbols")).head;
  const shipped = await catalog.submitTopicEdit("admin", "national-symbols", { ...head.content, minutes: head.content.minutes + 1, baseVersion: head.version });
  assert.equal(shipped.status, "approved");
  assert.equal((await catalog.findApprovedTopic("national-symbols")).minutes, head.content.minutes + 1);
});

test("an administrator editing over a teacher's waiting edit publishes a version that includes it and supersedes it", async () => {
  const { topicId } = await catalog.createTopic("admin", draft("Tea gardens"));
  const teacherEdit = await catalog.submitTopicEdit("teacher", topicId, { ...draft("Tea gardens", { tagline: pair("Teacher's tagline.", "শিক্ষকের পরিচিতি।") }), baseVersion: 1 });
  assert.equal(teacherEdit.status, "pending");
  assert.equal(await catalog.topicSaveFor("admin", topicId), "admin");
  // A stale administrator still cannot overwrite the teacher's waiting version unseen.
  await assert.rejects(catalog.submitTopicEdit("admin", topicId, { ...draft("Tea gardens", { minutes: 9 }), baseVersion: 1 }), (error) => error.status === 409);
  const admin = await catalog.submitTopicEdit("admin", topicId, { ...draft("Tea gardens", { tagline: pair("Teacher's tagline.", "শিক্ষকের পরিচিতি।"), minutes: 7 }), baseVersion: 2 });
  assert.deepEqual({ status: admin.status, superseded: admin.superseded }, { status: "approved", superseded: [2] });
  const now = await catalog.findApprovedTopic(topicId);
  assert.equal(now.tagline.en, "Teacher's tagline.", "the teacher's change, which the administrator built on, is published");
  assert.equal(now.minutes, 7);
  assert.deepEqual(await versionsOf(topicId), [[1, "superseded", "admin"], [2, "superseded", null], [3, "approved", "admin"]]);
  assert.deepEqual((await catalog.listStaffTopics()).find((topic) => topic.id === topicId).pendingVersions, []);
  await assert.rejects(catalog.reviewTopicVersion("admin", topicId, 2, { decision: "approve", confirmedRead: true }), (error) => error.status === 409, "the replaced version cannot be approved over the newer one");
  assert.deepEqual(events(topicId).at(-1).slice(2), [{ version: 3, self: true, superseded: [2] }]);
  assert.match(savedMessage(admin).en, /^Published as version 3\. Students see it now: an administrator's own topics do not wait for approval\. Version 2, which was waiting for approval, is included in it and is marked as replaced\.$/);
  assert.match(savedMessage(admin).bn, /সংস্করণ ৩ হিসেবে প্রকাশিত/);
});

test("an administrator's edit of a withdrawn topic shows it again; an administrator with a temporary password publishes nothing", async () => {
  const { topicId } = await catalog.createTopic("admin", draft("Folk songs"));
  await catalog.decideTopic("admin", topicId, { decision: "withdraw", note: "A verse needs checking." });
  assert.equal((await learnerIds()).includes(topicId), false);
  const saved = await catalog.submitTopicEdit("admin", topicId, { ...draft("Folk songs", { minutes: 5 }), baseVersion: 1 });
  assert.deepEqual({ status: saved.status, restored: saved.restored }, { status: "approved", restored: true });
  assert.ok((await learnerIds()).includes(topicId));
  assert.equal((await catalog.getStaffTopic(topicId)).withdrawn, false);
  assert.match(savedMessage(saved).en, /The topic was withdrawn and is shown to students again\.$/);

  await assert.rejects(catalog.createTopic("temp-admin", draft("Never published")), (error) => error.status === 403);
  await assert.rejects(catalog.submitTopicEdit("temp-admin", topicId, { ...draft("Folk songs", { minutes: 8 }), baseVersion: 2 }), (error) => error.status === 403);
  assert.equal((await catalog.topicPublishing("temp-admin")).onSave, "review", "a temporary password never counts as an administrator who publishes");
});

test("turning approval off publishes teachers' later saves at once but leaves waiting edits waiting", async () => {
  const waiting = await catalog.createTopic("teacher", draft("Rickshaw art"));
  assert.equal(waiting.status, "pending");
  const changed = await setApproval("admin", false);
  assert.equal(changed.changed, true);
  assert.equal(changed.teacherTopicsNeedApproval, false);
  assert.equal(changed.changedByName, "Admin Ayesha");
  assert.ok(changed.changedAt);
  assert.deepEqual(events(settings.TEACHER_TOPIC_APPROVAL), [["approval-setting-changed", "admin", { setting: settings.TEACHER_TOPIC_APPROVAL, from: true, to: false, targetLabel: settings.TEACHER_TOPIC_APPROVAL_LABEL }]]);
  assert.equal((await setApproval("admin", false)).changed, false, "setting the same value again changes nothing");
  assert.equal(events(settings.TEACHER_TOPIC_APPROVAL).length, 1, "and records nothing");

  // What was waiting stays waiting until an administrator approves it.
  assert.deepEqual(await versionsOf(waiting.topicId), [[1, "pending", null]]);
  assert.equal((await learnerIds()).includes(waiting.topicId), false);
  assert.deepEqual((await catalog.listStaffTopics()).find((topic) => topic.id === waiting.topicId).pendingVersions, [1]);

  const publishing = await catalog.topicPublishing("teacher");
  assert.deepEqual({ on: publishing.teacherTopicsNeedApproval, onSave: publishing.onSave }, { on: false, onSave: "setting" });
  const direct = await catalog.createTopic("teacher", draft("Kantha stitching"));
  assert.deepEqual({ status: direct.status, publishedDirectly: direct.publishedDirectly }, { status: "approved", publishedDirectly: "setting" });
  assert.ok((await learnerIds()).includes(direct.topicId));
  const [summary] = (await catalog.getStaffTopic(direct.topicId)).versions;
  assert.equal(summary.reviewerName, null, "no administrator is named as having reviewed it");
  assert.equal(summary.authorName, "Teacher Tania");
  assert.deepEqual(events(direct.topicId).map(([action, actor, details]) => [action, actor, details]), [
    ["topic-created", "teacher", { version: 1, theme: "our-country" }],
    ["topic-version-approved", "teacher", { version: 1, automatic: true, setting: settings.TEACHER_TOPIC_APPROVAL }],
  ]);
  assert.match(savedMessage(direct).en, /teachers' topics do not need an administrator's approval at the moment/);
  assert.equal(publishedDirectlyLabel(summary, "en"), "Published at once (teachers' topics did not need approval)");

  // A teacher's edit of the waiting topic builds on it and is published, superseding it.
  const edit = await catalog.submitTopicEdit("teacher", waiting.topicId, { ...draft("Rickshaw art", { minutes: 5 }), baseVersion: 1 });
  assert.deepEqual({ status: edit.status, superseded: edit.superseded }, { status: "approved", superseded: [1] });

  // Only an administrator shows a withdrawn topic again: a teacher's edit of one still waits.
  await catalog.decideTopic("admin", direct.topicId, { decision: "withdraw", note: "Check the stitch names." });
  assert.equal(await catalog.topicSaveFor("teacher", direct.topicId), "review");
  const held = await catalog.submitTopicEdit("teacher", direct.topicId, { ...draft("Kantha stitching", { minutes: 6 }), baseVersion: 1 });
  assert.equal(held.status, "pending");
  assert.equal((await learnerIds()).includes(direct.topicId), false);

  assert.equal(settingChangedMessage(false, 2).en, "Approval for teachers' topics is off. Teachers' new topics and edits are now published to students as soon as they save them. 2 topics are still waiting for approval: turning approval off does not publish them, so an administrator still reviews them below.");
  assert.match(settingChangedMessage(false, 1).bn, /১টি বিষয় এখনো অনুমোদনের অপেক্ষায়/);
  assert.equal(stillWaiting(1, "en"), "1 topic is still waiting for approval: turning approval off does not publish it, so an administrator still reviews it below.");
});

test("turning approval on again makes teachers' saves wait once more", async () => {
  const changed = await setApproval("admin", true);
  assert.equal(changed.teacherTopicsNeedApproval, true);
  assert.deepEqual(events(settings.TEACHER_TOPIC_APPROVAL).at(-1).slice(0, 2), ["approval-setting-changed", "admin"]);
  assert.deepEqual(events(settings.TEACHER_TOPIC_APPROVAL).at(-1)[2].to, true);
  const saved = await catalog.createTopic("teacher", draft("Monsoon rain"));
  assert.equal(saved.status, "pending");
  assert.equal((await catalog.topicPublishing("teacher")).onSave, "review");
  assert.equal(settingChangedMessage(true, 0).en, "Approval for teachers' topics is on. Teachers' new topics and edits wait for an administrator again.");
});

test("a stored value that is not false keeps approval on", () => {
  db.update(appSettings).set({ valueJson: "not json" }).where(eq(appSettings.key, settings.TEACHER_TOPIC_APPROVAL)).run();
  assert.equal(settings.teacherTopicsNeedApproval(db), true);
  db.update(appSettings).set({ valueJson: '"off"' }).where(eq(appSettings.key, settings.TEACHER_TOPIC_APPROVAL)).run();
  assert.equal(settings.teacherTopicsNeedApproval(db), true);
  db.update(appSettings).set({ valueJson: "true" }).where(eq(appSettings.key, settings.TEACHER_TOPIC_APPROVAL)).run();
});

test("an administrator's uploaded recording is approved at once and replaces the slot's track; a teacher's waits", async () => {
  const lessonId = "hello-me";
  const file = (name) => ({ lessonId, slot: "dialogue", objectKey: `human-audio/${lessonId}/dialogue/${name}.mp3`, originalName: `${name}.mp3`, contentType: "audio/mpeg", byteSize: 10, speakerName: "Speaker", dialect: "Dhaka", consentConfirmed: true });
  const teacher = await lessons.saveUploadedRecording("teacher", file("teacher"));
  assert.equal(teacher.reviewStatus, "pending");
  assert.equal(teacher.reviewedBy, null);
  const first = await lessons.saveUploadedRecording("admin", file("admin-one"));
  assert.equal(first.reviewStatus, "approved");
  assert.equal(first.reviewedBy, "admin");
  assert.ok(first.reviewedAt);
  assert.equal((await lessons.approvedRecording(lessonId, "dialogue")).id, first.id);
  const second = await lessons.saveUploadedRecording("admin", file("admin-two"));
  assert.equal((await lessons.approvedRecording(lessonId, "dialogue")).id, second.id);
  assert.equal(db.select().from(mediaAssets).where(eq(mediaAssets.id, first.id)).get().reviewStatus, "retired", "the previous approved track is retired, as an approval does");
  assert.equal(db.select().from(mediaAssets).where(eq(mediaAssets.id, teacher.id)).get().reviewStatus, "pending", "a waiting recording stays waiting");
  const audit = db.select().from(userAuditEvents).all().filter((event) => event.targetId === lessonId).map((event) => [event.action, event.actorId, JSON.parse(event.detailsJson)]);
  assert.deepEqual(audit, [
    ["lesson-audio-uploaded", "teacher", { recordingId: teacher.id, slot: "dialogue" }],
    ["lesson-audio-uploaded", "admin", { recordingId: first.id, slot: "dialogue" }],
    ["lesson-audio-approved", "admin", { recordingId: first.id, slot: "dialogue", self: true }],
    ["lesson-audio-uploaded", "admin", { recordingId: second.id, slot: "dialogue" }],
    ["lesson-audio-approved", "admin", { recordingId: second.id, slot: "dialogue", self: true }],
  ]);
  const temp = await lessons.saveUploadedRecording("temp-admin", file("temp"));
  assert.equal(temp.reviewStatus, "pending", "an administrator with a temporary password does not publish");
  await assert.rejects(lessons.saveUploadedRecording("nobody", file("nobody")), (error) => error.status === 401);
});

test("an existing installation gains the settings table and column without any stored setting, so approval stays on", () => {
  const sqlite = new Database(":memory:");
  sqlite.exec(bootstrapSql);
  migrateAccessControl(sqlite);
  // An installation from before the setting: topic_versions without published_directly and no app_settings table.
  sqlite.exec(`CREATE TABLE topic_versions (
    id text PRIMARY KEY NOT NULL, topic_id text NOT NULL, version integer NOT NULL, data_json text NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'superseded')),
    baseline integer NOT NULL DEFAULT 0, based_on integer, created_by text, created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_by text, reviewed_at text, review_note text NOT NULL DEFAULT ''
  )`);
  sqlite.prepare("INSERT INTO topic_versions (id, topic_id, version, data_json, status) VALUES ('v', 'custom', 1, '{}', 'pending')").run();
  migrateContent(sqlite);
  migrateContent(sqlite);
  const columns = sqlite.prepare("PRAGMA table_info(topic_versions)").all().map((column) => column.name);
  assert.ok(columns.includes("published_directly"));
  assert.equal(sqlite.prepare("SELECT published_directly FROM topic_versions WHERE id = 'v'").get().published_directly, null);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM app_settings").get().n, 0, "no setting is written: an absent one is on");
  assert.throws(() => sqlite.prepare("UPDATE topic_versions SET published_directly = 'teacher' WHERE id = 'v'").run(), /CHECK constraint/);
  sqlite.close();
});

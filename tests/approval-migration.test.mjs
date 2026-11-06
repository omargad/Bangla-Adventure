import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { bootstrapSql } from "../db/bootstrap.ts";
import { migrateAccessControl } from "../db/access-migration.ts";
import { migrateContent, migrateAdminContentApproval } from "../db/content-migration.ts";
import { seedLegacyLessonApprovals } from "./helpers/publish-shipped-fixture.mjs";

function legacyDatabase() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  // These deliberately predate the approval columns: bootstrap must not recreate
  // a real client's content tables or silently discard their existing work.
  db.exec(`
    CREATE TABLE class_activities (id text PRIMARY KEY NOT NULL, class_id text NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      title text NOT NULL, instructions text NOT NULL DEFAULT '', topic_id text, questions_json text NOT NULL DEFAULT '[]',
      status text NOT NULL DEFAULT 'open', created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE class_sources (id text PRIMARY KEY NOT NULL, class_id text NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      title_en text NOT NULL DEFAULT '', title_bn text NOT NULL DEFAULT '', url text NOT NULL, note text NOT NULL DEFAULT '',
      created_by text REFERENCES adults(id) ON DELETE SET NULL, created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE topic_versions (id text PRIMARY KEY NOT NULL, topic_id text NOT NULL, version integer NOT NULL, data_json text NOT NULL,
      status text NOT NULL DEFAULT 'pending', baseline integer NOT NULL DEFAULT 0, based_on integer, created_by text REFERENCES adults(id),
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, reviewed_by text REFERENCES adults(id), reviewed_at text, review_note text NOT NULL DEFAULT '');
    CREATE TABLE content_approvals (id text PRIMARY KEY NOT NULL, content_type text NOT NULL, content_id text NOT NULL,
      status text NOT NULL, baseline integer NOT NULL DEFAULT 0, changed_by text REFERENCES adults(id), changed_at text NOT NULL, note text NOT NULL DEFAULT '');
  `);
  db.exec(bootstrapSql);
  migrateAccessControl(db);
  for (const [id, role] of [["teacher", "teacher"], ["admin", "admin"]]) {
    db.prepare("INSERT INTO adults(id,email,display_name,password_hash,role,teacher_status,approval_status) VALUES(?,?,?,?,?,?,?)").run(id, `${id}@example.com`, id, "unchanged-fixture-hash", role, role === "teacher" ? "approved" : "none", "approved");
  }
  db.prepare("INSERT INTO user_audit_events(id,actor_id,target_id,target_type,action,details_json,created_at) VALUES('original-admin-grant',NULL,'admin','adult','administrator-granted-by-server-operator','{}','2025-01-01T00:00:00.000Z')").run();
  db.prepare("INSERT INTO classes(id,teacher_id,name,join_code) VALUES('class','teacher','Existing Sunday class','OLD234')").run();
  db.prepare("INSERT INTO class_students(id,class_id,display_name,token_hash) VALUES('roster','class','Existing learner','unchanged-token')").run();
  db.prepare("INSERT INTO class_activities(id,class_id,title,instructions,questions_json) VALUES('activity','class','Existing river quiz','Existing instructions',?)").run(JSON.stringify([{ prompt: "River?", options: ["Padma", "Hill"], answer: 0 }]));
  db.prepare("INSERT INTO activity_submissions(id,activity_id,student_id,answers_json,score,total) VALUES('attempt','activity','roster','[0]',1,1)").run();
  for (const author of ["teacher", "admin"]) db.prepare("INSERT INTO class_sources(id,class_id,title_en,url,created_by) VALUES(?,'class',?,?,?)").run(`source-${author}`, `Existing ${author} source`, `https://example.org/${author}`, author);
  const insertTopic = db.prepare("INSERT INTO topic_versions(id,topic_id,version,data_json,status,baseline,created_by,reviewed_by,reviewed_at,review_note) VALUES(?,?,1,?,'approved',?,?,?,'2026-01-01T00:00:00.000Z','Original reviewer note')");
  insertTopic.run("teacher-topic", "custom-teacher-topic", '{"title":{"en":"Original teacher text","bn":"বাংলা"}}', 0, "teacher", "teacher");
  insertTopic.run("missing-reviewer-topic", "custom-uncredited-topic", '{"title":{"en":"Original unattributed text","bn":"বাংলা"}}', 0, "teacher", null);
  insertTopic.run("carried-topic", "national-symbols", '{"title":{"en":"Old custom baseline edit","bn":"বাংলা"}}', 1, "teacher", null);
  insertTopic.run("admin-topic", "custom-admin-topic", '{"title":{"en":"Admin reviewed text","bn":"বাংলা"}}', 0, "teacher", "admin");
  db.prepare("INSERT INTO content_approvals(id,content_type,content_id,status,baseline,changed_by,changed_at,note) VALUES('teacher-lesson','lesson','hello-me','approved',0,'teacher','2026-01-01','Original teacher decision')").run();
  db.prepare("INSERT INTO content_approvals(id,content_type,content_id,status,baseline,changed_by,changed_at,note) VALUES('admin-lesson','lesson','my-family','approved',0,'admin','2026-01-01','Original admin decision')").run();
  // This is an old installation, not a fresh database. Its other shipped
  // lessons already had inherited publication rows before revision gating.
  // Keep the explicit teacher/Admin decisions above as their original evidence.
  seedLegacyLessonApprovals(db);
  const mediaColumns = db.prepare("PRAGMA table_info(media_assets)").all().map((column) => column.name);
  if (!mediaColumns.includes("reviewed_by")) db.exec("ALTER TABLE media_assets ADD COLUMN reviewed_by text REFERENCES adults(id)");
  if (!mediaColumns.includes("reviewed_at")) db.exec("ALTER TABLE media_assets ADD COLUMN reviewed_at text");
  for (const reviewer of ["teacher", "admin"]) db.prepare("INSERT INTO media_assets(id,owner_email,lesson_id,slot,object_key,original_name,content_type,byte_size,consent_confirmed,review_status,reviewed_by,reviewed_at,notes) VALUES(?,?,'hello-me','word:0',?,?,'audio/ogg',500,1,'approved',?,'2026-01-01','Original recording note')").run(`recording-${reviewer}`, "teacher@example.com", `${reviewer}.ogg`, `${reviewer}.ogg`, reviewer);
  db.prepare("INSERT INTO video_reviews(id,owner_email,lesson_id,video_id,status,notes) VALUES('teacher-video','teacher@example.com','hello-me','existing-video','approved','Original video note')").run();
  return db;
}

function snapshot(db) {
  return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
}

function auditedRole(db, id, actor, role, at, previousRole = "teacher") {
  db.prepare("INSERT INTO user_audit_events(id,actor_id,target_id,target_type,action,details_json,created_at) VALUES(?,NULL,?,'adult','updated',?,?)").run(id, actor, JSON.stringify({ previousRole, role }), at);
}

function historicalApprovals(db, actor) {
  const at = "2026-01-01T12:00:00.500Z";
  const topicId = `historical-topic-${actor}`, lessonId = `historical-lesson-${actor}`, mediaId = `historical-media-${actor}`, videoId = `historical-video-${actor}`;
  db.prepare("INSERT INTO topic_versions(id,topic_id,version,data_json,status,created_by,reviewed_by,reviewed_at,review_note) VALUES(?,?,1,?,'approved','teacher',?,?,'Keep original reviewer note')").run(topicId, topicId, JSON.stringify({ title: { en: `Original ${actor} topic`, bn: "বাংলা" } }), actor, at);
  db.prepare("INSERT INTO content_approvals(id,content_type,content_id,status,baseline,changed_by,changed_at,note) VALUES(?,'lesson',?,'approved',0,?,?,'Keep original lesson decision')").run(lessonId, lessonId, actor, at);
  db.prepare("INSERT INTO media_assets(id,owner_email,lesson_id,slot,object_key,original_name,content_type,byte_size,consent_confirmed,review_status,reviewed_by,reviewed_at,notes) VALUES(?,?,'hello-me','word:0',?,?,'audio/ogg',500,1,'approved',?,?,'Keep original recording')").run(mediaId, "teacher@example.com", `${mediaId}.ogg`, `${mediaId}.ogg`, actor, at);
  db.prepare("INSERT INTO video_reviews(id,owner_email,lesson_id,video_id,status,suitability_status,checked_at,notes) VALUES(?,?,?,?,'approved','suitable',?,'Keep original video decision')").run(videoId, `${actor}@example.com`, lessonId, videoId, at);
  db.prepare("INSERT INTO user_audit_events(id,actor_id,target_id,target_type,action,details_json,created_at) VALUES(?,?,?,'lesson','lesson-video-checked',?,?)").run(`video-decision-${actor}`, actor, lessonId, JSON.stringify({ status: "approved", suitabilityStatus: "suitable", replacementUrl: "" }), at);
  return {
    topic: db.prepare("SELECT * FROM topic_versions WHERE id = ?").get(topicId),
    lesson: db.prepare("SELECT * FROM content_approvals WHERE id = ?").get(lessonId),
    media: db.prepare("SELECT * FROM media_assets WHERE id = ?").get(mediaId),
    video: db.prepare("SELECT * FROM video_reviews WHERE id = ?").get(videoId),
  };
}

test("Admin approval migration holds legacy class content without inventing approvals and preserves learner work", () => {
  const db = legacyDatabase();
  try {
    const originalActivity = db.prepare("SELECT * FROM class_activities").get();
    const originalSources = db.prepare("SELECT * FROM class_sources ORDER BY id").all();
    const originalAttempt = db.prepare("SELECT * FROM activity_submissions").get();
    const originalAccounts = db.prepare("SELECT * FROM adults ORDER BY id").all();
    migrateContent(db);
    const activity = db.prepare("SELECT * FROM class_activities").get();
    for (const [key, value] of Object.entries(originalActivity)) assert.deepEqual(activity[key], value, `activity ${key} preserved`);
    for (const row of [activity, ...db.prepare("SELECT * FROM class_sources ORDER BY id").all()]) {
      assert.equal(row.approval_status, "pending", "legacy authorship alone is not evidence of an Admin review");
      assert.equal(row.revision, 1);
      assert.equal(row.reviewed_by, null);
      assert.equal(row.reviewed_at, null);
    }
    for (const source of originalSources) {
      const migrated = db.prepare("SELECT * FROM class_sources WHERE id = ?").get(source.id);
      for (const [key, value] of Object.entries(source)) assert.deepEqual(migrated[key], value, `source ${key} preserved`);
    }
    assert.deepEqual(db.prepare("SELECT * FROM activity_submissions").get(), originalAttempt);
    assert.deepEqual(db.prepare("SELECT * FROM adults ORDER BY id").all(), originalAccounts);
    assert.deepEqual(db.pragma("foreign_key_check"), []);
  } finally { db.close(); }
});

test("legacy teacher publication is held while real Admin decisions and shipped baselines are retained", () => {
  const db = legacyDatabase();
  try {
    const originalTopics = db.prepare("SELECT * FROM topic_versions ORDER BY id").all();
    const originalTeacherLesson = db.prepare("SELECT * FROM content_approvals WHERE id = 'teacher-lesson'").get();
    const originalRecording = db.prepare("SELECT * FROM media_assets WHERE id = 'recording-teacher'").get();
    migrateContent(db);
    for (const original of originalTopics) {
      const topic = db.prepare("SELECT * FROM topic_versions WHERE id = ?").get(original.id);
      assert.equal(topic.status, original.id === "admin-topic" ? "approved" : "pending");
      for (const field of ["data_json", "created_by", "reviewed_by", "reviewed_at", "review_note", "version"]) assert.equal(topic[field], original[field], `original topic ${field} is not forged or lost`);
    }
    assert.deepEqual(db.prepare("SELECT * FROM content_approvals WHERE id = 'teacher-lesson'").get(), originalTeacherLesson, "the old decision remains part of the audit trail");
    const heldLesson = db.prepare("SELECT * FROM content_approvals WHERE content_type = 'lesson' AND content_id = 'hello-me' ORDER BY rowid DESC LIMIT 1").get();
    assert.equal(heldLesson.status, "withdrawn");
    assert.equal(heldLesson.changed_by, null, "a migration never impersonates an Admin");
    assert.equal(heldLesson.baseline, 0);
    assert.equal(db.prepare("SELECT status FROM content_approvals WHERE content_id = 'my-family' ORDER BY rowid DESC LIMIT 1").get().status, "approved");
    const baseline = db.prepare("SELECT status,baseline,changed_by FROM content_approvals WHERE content_id = 'numbers-colours' ORDER BY rowid DESC LIMIT 1").get();
    assert.deepEqual(baseline, { status: "approved", baseline: 1, changed_by: null }, "unchanged shipped lessons remain explicitly labelled as baselines");
    const recording = db.prepare("SELECT * FROM media_assets WHERE id = 'recording-teacher'").get();
    assert.equal(recording.review_status, "pending");
    for (const [field, value] of Object.entries(originalRecording)) if (field !== "review_status") assert.equal(recording[field], value, `recording ${field} retained`);
    assert.equal(db.prepare("SELECT review_status FROM media_assets WHERE id = 'recording-admin'").get().review_status, "approved");
    const video = db.prepare("SELECT * FROM video_reviews WHERE id = 'teacher-video'").get();
    assert.equal(video.admin_decided_at, null);
    assert.equal(video.notes, "Original video note");
    assert.equal(db.prepare("SELECT count(*) AS n FROM topic_versions WHERE version = 0").get().n, 0, "migration does not fabricate reviews for bundled topic version zero");
  } finally { db.close(); }
});

test("historical Admin authority requires a role audit before the decision, never a later promotion or an untracked current role", () => {
  const db = legacyDatabase();
  try {
    const heldActors = ["promoted-later", "untracked-admin", "demoted-before-review", "same-second-grant"];
    for (const actor of heldActors) db.prepare("INSERT INTO adults(id,email,display_name,password_hash,role,approval_status) VALUES(?,?,?,'fixture','admin','approved')").run(actor, `${actor}@example.com`, actor);
    auditedRole(db, "old-teacher-role", "promoted-later", "teacher", "2025-01-01T00:00:00.000Z", "parent");
    auditedRole(db, "later-admin-promotion", "promoted-later", "admin", "2026-02-01T00:00:00.000Z");
    auditedRole(db, "earlier-admin-promotion", "demoted-before-review", "admin", "2025-01-01T00:00:00.000Z");
    auditedRole(db, "demotion-before-decision", "demoted-before-review", "teacher", "2025-12-01T00:00:00.000Z", "admin");
    auditedRole(db, "promotion-after-decision", "demoted-before-review", "admin", "2026-02-01T00:00:00.000Z");
    auditedRole(db, "ambiguous-second-promotion", "same-second-grant", "admin", "2026-01-01T12:00:00.000Z");
    const originals = new Map(["admin", ...heldActors].map((actor) => [actor, historicalApprovals(db, actor)]));
    const originalAudit = db.prepare("SELECT * FROM user_audit_events ORDER BY rowid").all();
    migrateContent(db);
    for (const [actor, original] of originals) {
      const proven = actor === "admin";
      const topic = db.prepare("SELECT * FROM topic_versions WHERE id = ?").get(original.topic.id);
      assert.equal(topic.status, proven ? "approved" : "pending", `${actor}: historical topic approval`);
      // The upgrade adds published_directly empty: none of these versions was published without a review.
      assert.deepEqual({ ...topic, status: original.topic.status }, { ...original.topic, published_directly: null }, `${actor}: authored topic and original review evidence remain intact`);
      assert.deepEqual(db.prepare("SELECT * FROM content_approvals WHERE id = ?").get(original.lesson.id), original.lesson, `${actor}: original lesson decision preserved`);
      const lesson = db.prepare("SELECT * FROM content_approvals WHERE content_type = 'lesson' AND content_id = ? ORDER BY rowid DESC LIMIT 1").get(original.lesson.content_id);
      assert.equal(lesson.status, proven ? "approved" : "withdrawn", `${actor}: historical lesson approval`);
      if (!proven) assert.equal(lesson.changed_by, null, "migration does not fabricate an administrator decision");
      const media = db.prepare("SELECT * FROM media_assets WHERE id = ?").get(original.media.id);
      assert.equal(media.review_status, proven ? "approved" : "pending", `${actor}: historical audio approval`);
      assert.deepEqual({ ...media, review_status: original.media.review_status }, original.media, `${actor}: audio bytes metadata and reviewer evidence are preserved`);
      const { admin_decided_at: decision, ...video } = db.prepare("SELECT * FROM video_reviews WHERE id = ?").get(original.video.id);
      assert.equal(decision, proven ? original.video.checked_at : null, `${actor}: matching video audit alone does not establish historical Admin authority`);
      assert.deepEqual(video, original.video);
    }
    assert.deepEqual(db.prepare("SELECT * FROM user_audit_events WHERE action != 'admin-approval-required' ORDER BY rowid").all(), originalAudit, "historical role and content decision evidence is never rewritten");
    const first = snapshot(db);
    migrateContent(db);
    assert.deepEqual(snapshot(db), first);
  } finally { db.close(); }
});

test("the migration is one-time and does not withdraw new authentic Admin approvals on subsequent starts", () => {
  const db = legacyDatabase();
  try {
    migrateContent(db);
    const first = snapshot(db);
    migrateAdminContentApproval(db);
    migrateContent(db);
    assert.deepEqual(snapshot(db), first, "repeat startup adds no duplicate decision or audit event");
    assert.equal(db.prepare("SELECT count(*) AS n FROM content_migration_versions WHERE id = 'admin_content_approval_v1'").get().n, 1);
    db.prepare("UPDATE class_activities SET approval_status = 'approved', reviewed_by = 'admin', reviewed_at = '2026-11-05T12:00:00Z' WHERE id = 'activity'").run();
    db.prepare("UPDATE class_sources SET approval_status = 'approved', reviewed_by = 'admin', reviewed_at = '2026-11-05T12:00:00Z' WHERE id = 'source-teacher'").run();
    const afterReview = snapshot(db);
    migrateContent(db);
    assert.deepEqual(snapshot(db), afterReview, "subsequent startup preserves decisions made under the new rules");
  } finally { db.close(); }
});

test("a failed migration rolls back content changes, schema additions, audit rows and its completion marker", () => {
  const db = legacyDatabase();
  try {
    const before = snapshot(db);
    const originalColumns = db.prepare("PRAGMA table_info(class_activities)").all();
    db.exec("CREATE TRIGGER simulate_failed_content_write BEFORE UPDATE ON topic_versions BEGIN SELECT RAISE(ABORT, 'fixture migration write failure'); END");
    assert.throws(() => migrateAdminContentApproval(db), /fixture migration write failure/);
    assert.deepEqual(snapshot(db), before, "part of a failed release must not become an effective content decision");
    assert.deepEqual(db.prepare("PRAGMA table_info(class_activities)").all(), originalColumns);
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'content_migration_versions'").get(), undefined);
    db.exec("DROP TRIGGER simulate_failed_content_write");
    migrateContent(db);
    assert.equal(db.prepare("SELECT status FROM topic_versions WHERE id = 'teacher-topic'").get().status, "pending", "the next startup can retry successfully");
  } finally { db.close(); }
});

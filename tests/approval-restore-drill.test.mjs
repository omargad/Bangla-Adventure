import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { bootstrapSql } from "../db/bootstrap.ts";
import { migrateAccessControl } from "../db/access-migration.ts";
import { migrateContent } from "../db/content-migration.ts";
import { topics } from "../app/topics-content.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const at = "2026-01-02T12:00:00.000Z";
const quoted = (name) => `"${name.replaceAll('"', '""')}"`;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function insert(db, table, row) {
  const columns = Object.keys(row);
  db.prepare(`INSERT INTO ${quoted(table)} (${columns.map(quoted).join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...Object.values(row));
}

function snapshot(db) {
  const schema = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
  const tables = Object.fromEntries(schema.filter((item) => item.type === "table").map(({ name }) => [name, db.prepare(`SELECT rowid AS fixture_rowid, * FROM ${quoted(name)} ORDER BY rowid`).all()]));
  return { schema, tables };
}

function healthy(db) {
  assert.deepEqual(db.pragma("integrity_check"), [{ integrity_check: "ok" }]);
  assert.deepEqual(db.pragma("foreign_key_check"), []);
}

function mediaBytes(directory) {
  const files = {};
  function walk(folder, prefix = "") {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) walk(path.join(folder, entry.name), `${name}/`);
      else {
        assert.ok(entry.isFile(), "fixture media must contain only directories and regular files");
        files[name] = readFileSync(path.join(folder, entry.name));
      }
    }
  }
  walk(directory);
  return files;
}

function backupCommand(directory, database, media, ...args) {
  // No inherited DATABASE_PATH, media path, provider key or application configuration.
  const result = spawnSync("python3", [path.join(root, "scripts/backup_restore.py"), ...args], {
    cwd: directory,
    env: { PATH: process.env.PATH, DATABASE_PATH: database, MEDIA_ROOT: media, PYTHONDONTWRITEBYTECODE: "1" },
    encoding: "utf8", timeout: 30_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function legacyDatabase(file, media, withMedia) {
  const db = new Database(file);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("wal_autocheckpoint = 0");
  db.exec(bootstrapSql);
  migrateAccessControl(db);
  // These are the pre-Admin-approval content tables. Do not call the candidate
  // content migration to construct its own input or remove its completion marker.
  db.exec(`
    CREATE TABLE topic_versions (
      id text PRIMARY KEY NOT NULL, topic_id text NOT NULL, version integer NOT NULL, data_json text NOT NULL,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','superseded')),
      baseline integer NOT NULL DEFAULT 0, based_on integer, created_by text REFERENCES adults(id) ON DELETE SET NULL,
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP, reviewed_by text REFERENCES adults(id) ON DELETE SET NULL,
      reviewed_at text, review_note text NOT NULL DEFAULT '');
    CREATE UNIQUE INDEX topic_versions_topic_version_unique ON topic_versions(topic_id,version);
    CREATE TABLE content_approvals (
      id text PRIMARY KEY NOT NULL, content_type text NOT NULL, content_id text NOT NULL,
      status text NOT NULL CHECK (status IN ('approved','withdrawn')), baseline integer NOT NULL DEFAULT 0,
      changed_by text REFERENCES adults(id) ON DELETE SET NULL, changed_at text NOT NULL, note text NOT NULL DEFAULT '');
    CREATE TABLE class_sources (
      id text PRIMARY KEY NOT NULL, class_id text NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      title_en text NOT NULL DEFAULT '', title_bn text NOT NULL DEFAULT '', url text NOT NULL, note text NOT NULL DEFAULT '',
      created_by text REFERENCES adults(id) ON DELETE SET NULL, created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP);
    ALTER TABLE media_assets ADD COLUMN reviewed_by text REFERENCES adults(id) ON DELETE SET NULL;
    ALTER TABLE media_assets ADD COLUMN reviewed_at text;
    ALTER TABLE student_topic_progress ADD COLUMN quiz_best_score integer;
    ALTER TABLE student_topic_progress ADD COLUMN quiz_total integer;
    ALTER TABLE student_topic_progress ADD COLUMN quiz_key text;
    ALTER TABLE student_topic_progress ADD COLUMN quiz_completed_at text;
  `);
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.transaction(() => {
    for (const [id, role, approval, temporary] of [["admin", "admin", "approved", 0], ["teacher", "teacher", "approved", 0], ["parent", "parent", "approved", 0], ["applicant", "parent", "pending", 1]]) {
      insert(db, "adults", { id, email: `${id}@example.test`, display_name: id, password_hash: `fixture-only-${id}-password-hash`, role, teacher_status: role === "teacher" ? "approved" : id === "applicant" ? "pending" : "none", approval_status: approval, must_change_password: temporary });
    }
    insert(db, "adult_sessions", { token_hash: hash("fixture-admin-session"), adult_id: "admin", expires_at: "2030-01-01T00:00:00Z" });
    insert(db, "recovery_codes", { id: "recovery", adult_id: "parent", code_hash: hash("fixture-recovery-code") });
    for (const [id, approved] of [["maya", "approved"], ["removed", "approved"], ["waiting", "pending"]]) {
      insert(db, "students", { id, username: id, display_name: id === "maya" ? "মায়া" : id, password_hash: `fixture-only-${id}-password-hash`, approval_status: approved, must_change_password: id === "waiting" ? 1 : 0 });
    }
    insert(db, "student_sessions", { token_hash: hash("fixture-maya-session"), student_id: "maya", expires_at: "2030-01-01T00:00:00Z" });
    insert(db, "classes", { id: "class", teacher_id: "teacher", name: "Sunday Bangla class", join_code: "DRL234" });
    for (const id of ["maya", "removed"]) {
      insert(db, "class_students", { id: `roster-${id}`, class_id: "class", display_name: id, token_hash: hash(`fixture-roster-${id}`) });
      insert(db, "student_class_enrollments", { id: `enrollment-${id}`, student_id: id, class_id: "class", class_student_id: `roster-${id}`, active: id === "maya" ? 1 : 0 });
      insert(db, "class_attendance", { id: `attendance-${id}`, class_id: "class", student_id: id, session_date: "2026-01-02", present: id === "maya" ? 1 : 0, recorded_by: "teacher", recorded_at: at });
    }
    insert(db, "parent_student_links", { id: "family", parent_id: "parent", student_id: "maya" });
    insert(db, "class_activities", { id: "quiz", class_id: "class", title: "River journeys", instructions: "নদীর গল্প পড়ো। Read the river story.", questions_json: JSON.stringify([{ prompt: "Which is a river?", options: ["Padma", "Hill"], answer: 0 }]), status: "open" });
    for (const id of ["maya", "removed"]) insert(db, "activity_submissions", { id: `attempt-${id}`, activity_id: "quiz", student_id: `roster-${id}`, answers_json: id === "maya" ? "[0]" : "[1]", score: id === "maya" ? 1 : 0, total: 1, submitted_at: at });
    insert(db, "student_topic_progress", { student_id: "maya", topic_id: topics[0].id, completed_at: at, quiz_best_score: 2, quiz_total: 3, quiz_key: "unchanged-quiz-fingerprint", quiz_completed_at: at });
    insert(db, "class_sources", { id: "source", class_id: "class", title_en: "River reference", title_bn: "নদীর তথ্য", url: "https://example.test/rivers", created_by: "teacher" });
    insert(db, "class_announcements", { id: "notice", class_id: "class", body: "Next class is Sunday.", audience: "parents", author_id: "teacher" });
    insert(db, "learner_profiles", { id: "home-profile", owner_email: "parent@example.test", display_name: "Home learning", created_at: at, updated_at: at });
    insert(db, "skill_progress", { id: "home-progress", profile_id: "home-profile", lesson_id: "hello-me", session_id: "home-session", skill: "reading", score: 80 });
    insert(db, "assignments", { id: "home-assignment", owner_email: "parent@example.test", profile_id: "home-profile", lesson_id: "hello-me", title: "Practise greetings" });
    insert(db, "curriculum_drafts", { id: "draft", owner_email: "teacher@example.test", lesson_id: "hello-me", title: "Teacher draft", level: "beginner", status: "ready-for-review", data_json: '{"text":"বাংলা খসড়া"}' });
    insert(db, "content_reviews", { id: "specialist", owner_email: "teacher@example.test", lesson_id: "hello-me", review_type: "language", status: "complete", notes: "Keep internal review history." });
    insert(db, "user_audit_events", { id: "admin-grant", target_id: "admin", target_type: "adult", action: "administrator-granted-by-server-operator", created_at: "2025-01-01T00:00:00.000Z" });
    for (const reviewer of ["teacher", "admin"]) {
      insert(db, "topic_versions", { id: `topic-${reviewer}`, topic_id: `custom-${reviewer}`, version: 1, data_json: JSON.stringify({ ...topics[0], id: undefined, title: { en: `${reviewer} reviewed story`, bn: "নদীর গল্প" } }), status: "approved", created_by: "teacher", reviewed_by: reviewer, reviewed_at: at, review_note: "Original review evidence" });
      const lesson = reviewer === "teacher" ? "hello-me" : "my-family";
      insert(db, "content_approvals", { id: `lesson-${reviewer}`, content_type: "lesson", content_id: lesson, status: "approved", changed_by: reviewer, changed_at: at, note: "Original lesson decision" });
      insert(db, "video_reviews", { id: `video-${reviewer}`, owner_email: `${reviewer}@example.test`, lesson_id: lesson, video_id: "fixture-video", status: "approved", suitability_status: "suitable", checked_at: at, updated_at: at });
      insert(db, "user_audit_events", { id: `video-audit-${reviewer}`, actor_id: reviewer, target_id: lesson, target_type: "lesson", action: "lesson-video-checked", details_json: JSON.stringify({ status: "approved", suitabilityStatus: "suitable", replacementUrl: "" }), created_at: at });
    }
    if (withMedia) {
      const objectKey = "human-audio/hello-me/reading/বাংলা.ogg";
      const bytes = Buffer.from("fixture recording bytes\0\xff", "latin1");
      mkdirSync(path.dirname(path.join(media, objectKey)), { recursive: true });
      writeFileSync(path.join(media, objectKey), bytes);
      insert(db, "media_assets", { id: "recording", owner_email: "teacher@example.test", lesson_id: "hello-me", slot: "reading", object_key: objectKey, original_name: "বাংলা.ogg", content_type: "audio/ogg", byte_size: bytes.length, consent_confirmed: 1, review_status: "approved", reviewed_by: "teacher", reviewed_at: at });
      const narration = path.join(media, "generated-narration", "v1");
      mkdirSync(narration, { recursive: true });
      writeFileSync(path.join(narration, `${hash("fixture canonical narration")}.ogg`), Buffer.from("fixture generated clip\0\xff", "latin1"));
      writeFileSync(path.join(narration, "daily-budget.json"), JSON.stringify({ schema: 1, day: "2026-01-02", characters: 1234, lastActor: hash("student:maya") }));
    }
  })();
  healthy(db);
  return db;
}

for (const withMedia of [false, true]) test(`on-disk approval migration and full restore preserve ${withMedia ? "recordings and narration budget" : "an empty-media demo"}`, () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "bangla-approval-drill-"));
  const database = path.join(directory, "legacy.db");
  const media = path.join(directory, "media");
  mkdirSync(media);
  const connections = [];
  try {
    const source = legacyDatabase(database, media, withMedia);
    connections.push(source);
    const before = snapshot(source);
    const originalMedia = mediaBytes(media);
    assert.equal(Object.keys(originalMedia).length, withMedia ? 3 : 0);
    if (withMedia) assert.equal(JSON.parse(originalMedia["generated-narration/v1/daily-budget.json"].toString("utf8")).characters, 1234);
    assert.ok(!before.tables.content_migration_versions);
    assert.ok(!source.pragma("table_info(class_activities)").some(({ name }) => name === "approval_status"));
    assert.ok(statSync(`${database}-wal`).size > 32, "committed fixture data remains in WAL, not just the main DB file");
    // The fixture's only connection stays idle to retain WAL; all fixture writes
    // have finished. No app is started and no production environment is read.
    const backup = backupCommand(directory, database, media, "backup", path.join(directory, "backups"), "--application-stopped");
    assert.equal(backup.verified, true);
    const archiveHash = hash(readFileSync(backup.archive));
    assert.equal(archiveHash, backup.sha256);
    assert.equal(statSync(backup.archive).mode & 0o777, 0o600);
    assert.equal(backupCommand(directory, database, media, "verify", backup.archive).verified, true);
    const restored = backupCommand(directory, database, media, "restore", backup.archive, path.join(directory, "candidate"));
    const candidate = new Database(restored.database);
    connections.push(candidate);
    candidate.pragma("foreign_keys = ON");
    assert.deepEqual(snapshot(candidate), before, "the real backup/restore CLI includes committed WAL rows and the exact original schema");
    assert.deepEqual(mediaBytes(restored.media), originalMedia);

    // Run the same initialization sequence as getDb against this isolated copy.
    candidate.pragma("journal_mode = WAL");
    candidate.exec(bootstrapSql);
    migrateAccessControl(candidate);
    migrateContent(candidate);
    healthy(candidate);
    const migrated = snapshot(candidate);
    const changedTables = new Set(["class_activities", "class_sources", "topic_versions", "media_assets", "content_approvals", "video_reviews", "user_audit_events"]);
    for (const [table, rows] of Object.entries(before.tables)) {
      if (!changedTables.has(table)) assert.deepEqual(migrated.tables[table], rows, `${table}: all fields and rows preserved, including inactive enrollments and pending accounts`);
    }
    for (const table of ["class_activities", "class_sources"]) {
      const row = migrated.tables[table][0];
      for (const [key, value] of Object.entries(before.tables[table][0])) assert.deepEqual(row[key], value, `${table}.${key} retained`);
      assert.equal(row.approval_status, "pending");
      assert.equal(row.reviewed_by, null);
      assert.equal(row.reviewed_at, null);
    }
    for (const original of before.tables.topic_versions) {
      const row = migrated.tables.topic_versions.find((item) => item.id === original.id);
      assert.equal(row.status, original.reviewed_by === "admin" ? "approved" : "pending");
      assert.deepEqual({ ...row, status: original.status }, original, "topic content and original reviewer evidence remain intact");
    }
    for (const original of before.tables.content_approvals) assert.deepEqual(migrated.tables.content_approvals.find((row) => row.id === original.id), original);
    const latestLesson = (id) => candidate.prepare("SELECT status,baseline FROM content_approvals WHERE content_type='lesson' AND content_id=? ORDER BY rowid DESC LIMIT 1").get(id);
    assert.deepEqual(latestLesson("hello-me"), { status: "withdrawn", baseline: 0 });
    assert.deepEqual(latestLesson("my-family"), { status: "approved", baseline: 0 });
    assert.deepEqual(latestLesson("numbers-colours"), { status: "approved", baseline: 1 });
    for (const original of before.tables.video_reviews) {
      const { admin_decided_at: decision, ...row } = migrated.tables.video_reviews.find((item) => item.id === original.id);
      assert.equal(decision, original.id === "video-admin" ? at : null);
      assert.deepEqual(row, original);
    }
    assert.deepEqual(migrated.tables.user_audit_events.filter((row) => row.action !== "admin-approval-required"), before.tables.user_audit_events);
    assert.ok(migrated.tables.user_audit_events.some((row) => row.action === "admin-approval-required"));
    if (withMedia) {
      assert.equal(migrated.tables.media_assets[0].review_status, "pending");
      assert.deepEqual({ ...migrated.tables.media_assets[0], review_status: "approved" }, before.tables.media_assets[0]);
    } else assert.deepEqual(migrated.tables.media_assets, []);
    assert.deepEqual(mediaBytes(restored.media), originalMedia, "migration changes no recording, generated clip or persisted budget bytes");
    assert.equal(migrated.tables.content_migration_versions.filter((row) => row.id === "admin_content_approval_v1").length, 1);

    candidate.close();
    const restarted = new Database(restored.database);
    connections.push(restarted);
    restarted.pragma("foreign_keys = ON");
    restarted.exec(bootstrapSql);
    migrateAccessControl(restarted);
    migrateContent(restarted);
    healthy(restarted);
    assert.deepEqual(snapshot(restarted), migrated, "a genuine close/reopen/startup does not duplicate holds or change review state");

    // Roll back data using the original archive into a NEW destination. An old
    // image alone would retain the migrated schema and publication holds.
    const rollback = backupCommand(directory, database, media, "restore", backup.archive, path.join(directory, "rollback"));
    const recovered = new Database(rollback.database, { readonly: true, fileMustExist: true });
    connections.push(recovered);
    healthy(recovered);
    assert.deepEqual(snapshot(recovered), before, "full restore recovers every original table, index, column, row and publication status");
    assert.deepEqual(mediaBytes(rollback.media), originalMedia);
    assert.equal(JSON.parse(readFileSync(path.join(rollback.destination, "restore-receipt.json"), "utf8")).archive_sha256, archiveHash);
    assert.equal(hash(readFileSync(backup.archive)), archiveHash, "the rollback archive remains unchanged throughout rehearsal");
    assert.deepEqual(snapshot(source), before, "rehearsal never migrates or changes the source database");
    assert.deepEqual(mediaBytes(media), originalMedia);
  } finally {
    for (const db of connections) if (db.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

#!/usr/bin/env node
// Clean, unpublished staging only. This never creates an account or approves content.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const businessTables = [
  'adults', 'students', 'adult_sessions', 'student_sessions', 'learner_profiles',
  'classes', 'class_students', 'student_class_enrollments', 'parent_student_links',
  'class_activities', 'activity_submissions', 'class_announcements', 'class_attendance',
  'assignments', 'skill_progress', 'student_topic_progress', 'curriculum_drafts',
  'content_reviews', 'media_assets', 'video_reviews', 'class_sources', 'topic_updates',
  'knowledge_sources', 'recovery_codes', 'user_audit_events', 'content_approvals',
];
const populatedTables = new Set(['topic_versions', 'lesson_versions', 'shipped_content_state', 'content_migration_versions']);
const canonical = (value) => JSON.stringify(normalize(value));
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]));
  return value;
}
const digest = (value) => createHash('sha256').update(canonical(value)).digest('hex');
const quote = (name) => `"${name.replaceAll('"', '""')}"`;
function check(condition, code) {
  if (!condition) throw new Error(`Clean staging verification failed: ${code}.`);
}
function requiredPath(value, directory) {
  check(typeof value === 'string' && path.isAbsolute(value), 'absolute-path-required');
  const resolved = path.resolve(value);
  check(fs.realpathSync(resolved) === resolved, 'symlink-path-refused');
  const info = fs.lstatSync(resolved);
  check(directory ? info.isDirectory() : info.isFile(), 'unexpected-path-type');
  return resolved;
}
function fileCount(directory) {
  let count = 0;
  for (const name of fs.readdirSync(directory)) {
    const target = path.join(directory, name), stat = fs.lstatSync(target);
    check(!stat.isSymbolicLink(), 'media-symlink-refused');
    if (stat.isDirectory()) count += fileCount(target);
    else { check(stat.isFile(), 'unexpected-media-type'); count++; }
  }
  return count;
}
function inspect(db, mediaRoot) {
  check(db.pragma('integrity_check', { simple: true }) === 'ok', 'sqlite-integrity');
  check(db.pragma('foreign_key_check').length === 0, 'foreign-keys');
  const schema = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
  const tableNames = schema.filter((row) => row.type === 'table').map((row) => row.name);
  check([...businessTables, ...populatedTables].every((name) => tableNames.includes(name)), 'required-schema');
  const counts = {}, records = {};
  for (const table of tableNames) {
    const rows = db.prepare(`SELECT * FROM ${quote(table)}`).all();
    counts[table] = rows.length;
    if (!populatedTables.has(table)) check(rows.length === 0, 'users-or-business-data');
    records[table] = rows.map(normalize).sort((a, b) => canonical(a).localeCompare(canonical(b), 'en'));
  }
  check(counts.topic_versions === 15 && counts.lesson_versions === 18 && counts.shipped_content_state === 33, 'pending-catalogue-counts');
  check(counts.content_migration_versions === 1 && records.content_migration_versions[0].id === 'admin_content_approval_v1', 'migration-marker');
  const states = records.shipped_content_state;
  check(states.every((row) => row.baseline_json === null && /^[a-f0-9]{64}$/.test(row.last_source_fingerprint)), 'legacy-baseline-or-invalid-fingerprint');
  for (const [kind, table, expected] of [['topic', 'topic_versions', 15], ['lesson', 'lesson_versions', 18]]) {
    const selected = states.filter((row) => row.content_type === kind);
    check(selected.length === expected, 'shipped-state-counts');
    const ids = new Set();
    for (const row of records[table]) {
      const id = row[`${kind}_id`], state = selected.find((item) => item.content_id === id);
      check(!ids.has(id), 'duplicate-content-revision'); ids.add(id);
      check(typeof row.id === 'string' && row.id.length > 0 && row.version === 1 && row.status === 'pending' && row.baseline === 0,
        'published-or-unexpected-revision');
      check(row.reviewed_by === null && row.reviewed_at === null && (kind !== 'topic' || row.created_by === null), 'authored-or-reviewed-content');
      const fingerprint = digest(JSON.parse(row.data_json));
      check(state?.last_source_fingerprint === fingerprint && (kind !== 'lesson' || row.fingerprint === fingerprint), 'snapshot-fingerprint');
    }
  }
  const mediaFiles = fileCount(mediaRoot);
  check(mediaFiles === 0, 'unexpected-media');
  return { stateDigest: digest({ schema, records }), counts, mediaFiles };
}

export function verifyCleanStage({ databasePath, mediaRoot, expectedStateDigest, writeProbes = false }) {
  check(expectedStateDigest === undefined || /^[a-f0-9]{64}$/.test(expectedStateDigest), 'expected-digest-format');
  const database = requiredPath(databasePath, false), media = requiredPath(mediaRoot, true);
  const db = new Database(database, { readonly: !writeProbes, fileMustExist: true, timeout: 5000 });
  try {
    db.pragma('foreign_keys = ON');
    const before = inspect(db, media);
    if (expectedStateDigest !== undefined) check(before.stateDigest === expectedStateDigest, 'state-changed');
    if (writeProbes) {
      const probeTable = `private_stage_probe_${randomUUID().replaceAll('-', '')}`;
      db.exec('BEGIN IMMEDIATE');
      try {
        db.exec(`CREATE TABLE ${quote(probeTable)} (value TEXT NOT NULL)`);
        db.prepare(`INSERT INTO ${quote(probeTable)} (value) VALUES (?)`).run('disposable storage probe');
        assert.equal(db.prepare(`SELECT value FROM ${quote(probeTable)}`).get().value, 'disposable storage probe');
      } finally { if (db.inTransaction) db.exec('ROLLBACK'); }
      const probeFile = path.join(media, `.private-stage-probe-${randomUUID()}`);
      let owned = false;
      try {
        const fd = fs.openSync(probeFile, 'wx', 0o600); owned = true;
        try { fs.writeFileSync(fd, 'disposable media probe'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        assert.equal(fs.readFileSync(probeFile, 'utf8'), 'disposable media probe');
      } finally { if (owned) fs.unlinkSync(probeFile); }
      check(inspect(db, media).stateDigest === before.stateDigest, 'write-probe-changed-state');
    }
    return {
      verified: true, stateDigest: before.stateDigest,
      paths: { database, media },
      counts: { pendingTopics: 15, pendingLessons: 18, shippedStates: 33, users: 0, approvals: 0, baselines: 0, businessRows: 0, mediaFiles: 0 },
      checks: { integrity: true, foreignKeys: true, unpublished: true, cleanIdentities: true,
        expectedStateMatched: expectedStateDigest === undefined ? null : true,
        databaseWriteRolledBack: writeProbes ? true : null, mediaWriteRemoved: writeProbes ? true : null },
    };
  } finally { db.close(); }
}

// Also supports piping this exact file to `node --input-type=module -` in the image.
if (process.argv[1] === '-' || (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)) {
  try {
    let writeProbes = false, expectedStateDigest;
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--write-probes') writeProbes = true;
      else if (args[i] === '--expected-state-digest' && args[i + 1]) expectedStateDigest = args[++i];
      else throw new Error('Invalid verification argument.');
    }
    console.log(JSON.stringify(verifyCleanStage({ databasePath: process.env.DATABASE_PATH, mediaRoot: process.env.MEDIA_ROOT, expectedStateDigest, writeProbes })));
  } catch {
    // Never print row values, supplied paths, environment or SQLite diagnostics on failure.
    console.error(JSON.stringify({ verified: false, error: 'Clean staging verification failed; inspect the isolated staging state.' }));
    process.exitCode = 1;
  }
}

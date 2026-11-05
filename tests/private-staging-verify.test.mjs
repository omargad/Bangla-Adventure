import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import Database from 'better-sqlite3';
import { bootstrapSql } from '../db/bootstrap.ts';
import { migrateAccessControl } from '../db/access-migration.ts';
import { migrateContent } from '../db/content-migration.ts';
import { verifyCleanStage } from '../scripts/private-staging-verify.mjs';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bangla-private-verify-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const databasePath = path.join(directory, 'app.db'), mediaRoot = path.join(directory, 'media');
  fs.mkdirSync(mediaRoot);
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON'); db.exec(bootstrapSql); migrateAccessControl(db); migrateContent(db); db.close();
  return { databasePath, mediaRoot };
}
function change(config, callback) { const db = new Database(config.databasePath); try { callback(db); } finally { db.close(); } }

test('clean verifier proves pending state, leaves no probe data, and matches exact state after another startup', (t) => {
  const config = fixture(t), initial = verifyCleanStage(config);
  const probe = verifyCleanStage({ ...config, writeProbes: true, expectedStateDigest: initial.stateDigest });
  assert.deepEqual(probe.counts, { pendingTopics: 15, pendingLessons: 18, shippedStates: 33, users: 0, approvals: 0, baselines: 0, businessRows: 0, mediaFiles: 0 });
  assert.equal(probe.checks.databaseWriteRolledBack, true);
  assert.equal(probe.checks.mediaWriteRemoved, true);
  assert.deepEqual(fs.readdirSync(config.mediaRoot), []);
  change(config, (db) => { db.exec(bootstrapSql); migrateAccessControl(db); migrateContent(db); });
  assert.equal(verifyCleanStage({ ...config, expectedStateDigest: initial.stateDigest }).checks.expectedStateMatched, true);
});

test('restart comparison detects a replaced revision ID despite unchanged content and counts', (t) => {
  const config = fixture(t), before = verifyCleanStage(config);
  change(config, (db) => db.prepare("UPDATE lesson_versions SET id='different-revision' WHERE rowid=(SELECT min(rowid) FROM lesson_versions)").run());
  assert.throws(() => verifyCleanStage({ ...config, expectedStateDigest: before.stateDigest }), /state-changed/);
});

test('an account, human decision or stray file prevents a clean-stage pass', (t) => {
  for (const kind of ['account', 'decision', 'media']) {
    const config = fixture(t);
    if (kind === 'account') change(config, (db) => db.prepare("INSERT INTO adults(id,email,display_name,password_hash) VALUES('private-id','do-not-print@example.invalid','Do not print','not-a-password')").run());
    if (kind === 'decision') change(config, (db) => db.prepare("UPDATE lesson_versions SET status='approved' WHERE rowid=(SELECT min(rowid) FROM lesson_versions)").run());
    if (kind === 'media') fs.writeFileSync(path.join(config.mediaRoot, 'do-not-print'), 'private-data');
    assert.throws(() => verifyCleanStage(config));
  }
});

test('foreign-key damage and tampered candidate text are detected', (t) => {
  const broken = fixture(t);
  change(broken, (db) => { db.pragma('foreign_keys = OFF'); db.prepare("UPDATE lesson_versions SET reviewed_by='missing-account' WHERE rowid=(SELECT min(rowid) FROM lesson_versions)").run(); });
  assert.throws(() => verifyCleanStage(broken), /foreign-keys/);
  const changed = fixture(t);
  change(changed, (db) => db.prepare("UPDATE topic_versions SET data_json='{}' WHERE rowid=(SELECT min(rowid) FROM topic_versions)").run());
  assert.throws(() => verifyCleanStage(changed), /snapshot-fingerprint/);
});

test('the verifier refuses missing databases, media links and nonempty unexpected tables', (t) => {
  const config = fixture(t);
  assert.throws(() => verifyCleanStage({ ...config, databasePath: path.join(path.dirname(config.databasePath), 'missing.db') }));
  const linked = path.join(path.dirname(config.databasePath), 'linked-media');
  fs.symlinkSync(config.mediaRoot, linked);
  assert.throws(() => verifyCleanStage({ ...config, mediaRoot: linked }), /symlink/);
  change(config, (db) => db.exec("CREATE TABLE unexpected_records(value TEXT); INSERT INTO unexpected_records VALUES('must remain private')"));
  assert.throws(() => verifyCleanStage(config), /users-or-business-data/);
});

test('the stdin CLI returns aggregate state and keeps failure diagnostics private', (t) => {
  const config = fixture(t);
  const source = fs.readFileSync(new URL('../scripts/private-staging-verify.mjs', import.meta.url), 'utf8');
  const env = { ...process.env, DATABASE_PATH: config.databasePath, MEDIA_ROOT: config.mediaRoot, NODE_NO_WARNINGS: '1' };
  const result = spawnSync(process.execPath, ['--input-type=module', '-', '--write-probes'], { input: source, env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).verified, true);
  const failed = spawnSync(process.execPath, ['--input-type=module', '-', '--expected-state-digest', 'private-invalid-value'], { input: source, env, encoding: 'utf8' });
  assert.equal(failed.status, 1);
  assert.doesNotMatch(failed.stderr, /private-invalid-value|app\.db|MEDIA_ROOT/);
  assert.equal(JSON.parse(failed.stderr).verified, false);
});

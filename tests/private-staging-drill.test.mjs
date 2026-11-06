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

const script = new URL('../scripts/private-staging-drill.sh', import.meta.url);
const image = `ghcr.io/omargad/bangla-adventure@sha256:${'a'.repeat(64)}`;
function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bangla-private-drill-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('embedded drill performs real SQLite/media backup, tampering, full restores and verifies untouched source', (t) => {
  const directory = temporary(t), source = path.join(directory, 'source'), drill = path.join(directory, 'drill');
  fs.mkdirSync(source); fs.mkdirSync(drill); fs.mkdirSync(path.join(source, 'media'));
  const dbFile = path.join(source, 'bangla-adventures.db'), db = new Database(dbFile);
  db.pragma('foreign_keys = ON'); db.exec(bootstrapSql); migrateAccessControl(db); migrateContent(db); db.close();
  const before = fs.readFileSync(dbFile);
  let program = fs.readFileSync(script, 'utf8').split("<<'PY'\n")[1].split('\nPY\n')[0];
  program = program.replace("pathlib.Path('/source')", `pathlib.Path(${JSON.stringify(source)})`)
    .replace("pathlib.Path('/drill')", `pathlib.Path(${JSON.stringify(drill)})`)
    .replace("'/app/scripts/backup_restore.py'", JSON.stringify(new URL('../scripts/backup_restore.py', import.meta.url).pathname))
    .replace("'/app/staging-tools/private-staging-verify.mjs'", JSON.stringify(new URL('../scripts/private-staging-verify.mjs', import.meta.url).pathname));
  const result = spawnSync('python3', ['-'], { input: program, encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.verified, true);
  assert.ok(Object.values(report.checks).every((value) => value === true));
  assert.equal(report.counts.probeRecords, 3); assert.equal(report.counts.probeMediaFiles, 2);
  assert.deepEqual(fs.readFileSync(dbFile), before);
  assert.deepEqual(fs.readdirSync(path.join(source, 'media')), []);
  const restored = new Database(path.join(drill, 'restored-clean/bangla-adventures.db'), { readonly: true });
  assert.equal(restored.prepare('SELECT count(*) AS n FROM adults').get().n, 0);
  assert.equal(restored.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='private_staging_drill_probe'").get().n, 0);
  restored.close();
});

// No Docker command is forwarded: only known fixture operations are interpreted.
const dockerStub = String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2), env = process.env;
const state = fs.existsSync(env.DRILL_STATE) ? JSON.parse(fs.readFileSync(env.DRILL_STATE)) : {};
fs.appendFileSync(env.DRILL_LOG, JSON.stringify({args, host:env.DOCKER_HOST, context:env.DOCKER_CONTEXT ?? null})+'\n');
const save = () => fs.writeFileSync(env.DRILL_STATE, JSON.stringify(state));
const out = value => { if(value !== undefined) process.stdout.write(String(value)+'\n'); process.exit(0); };
const fail = () => process.exit(1);
if(args[0]==='info') out('["name=rootless"]');
if(args[0]==='ps') out(args.includes('--all') ? 'fixture-app\nfixture-proxy' : '');
if(args[0]==='inspect') {
  const name=args.at(-1), format=args[2];
  if(name.startsWith('bangla-private-drill-')) fail();
  if(format.includes('State.Running')) out(env.DRILL_MODE==='running' ? 'true':'false');
  if(format.includes('compose.service')) out(name==='fixture-app' ? 'app':'proxy');
  if(format.includes('Config.Image')) out(env.DRILL_MODE==='wrong-image' ? 'old-image':env.DRILL_IMAGE);
  if(format.includes('.Mounts')) out('bangla-adventures-staging_bangla-data');
  fail();
}
if(args[0]==='volume' && args[1]==='inspect') {
  const name=args.at(-1);
  if(name==='bangla-adventures-staging_bangla-data') out('bangla-adventures-staging');
  if(!state.volume) fail();
  if(name!==state.volume) fail();
  out(env.DRILL_MODE==='lost-label' ? 'not-owned':state.token);
}
if(args[0]==='volume' && args[1]==='create') { state.volume=args.at(-1); state.token=args[args.indexOf('--label')+1].split('=')[1]; save(); out(state.volume); }
if(args[0]==='volume' && args[1]==='rm') { if(args[2]!==state.volume) fail(); state.removed=true; save(); out(state.volume); }
if(args[0]==='run') {
  const entry=args[args.indexOf('--entrypoint')+1];
  if(entry==='sh') out();
  if(entry==='python3') { fs.readFileSync(0); if(env.DRILL_MODE==='helper-failure') fail(); out(JSON.stringify({verified:true})); }
}
fail();
`;
function shellFixture(t, mode, drillImage = image) {
  const directory = temporary(t), bin = path.join(directory, 'bin'); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'docker'), dockerStub, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'id'), '#!/bin/sh\nprintf "1002\\n"\n', { mode: 0o755 });
  const log = path.join(directory, 'calls.jsonl'), state = path.join(directory, 'state.json');
  const result = spawnSync('bash', [script.pathname, drillImage], { encoding: 'utf8', env: {
    ...process.env, PATH: `${bin}:${process.env.PATH}`, DOCKER_CONTEXT: 'must-be-cleared',
    DOCKER_HOST: 'unix:///wrong.sock', DRILL_STATE: state, DRILL_LOG: log, DRILL_IMAGE: drillImage, DRILL_MODE: mode,
  } });
  return { result, calls: fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : [], state: fs.existsSync(state) ? JSON.parse(fs.readFileSync(state)) : {} };
}
test('drill refuses running writers or a different image before creating any resources', (t) => {
  for (const mode of ['running', 'wrong-image']) {
    const { result, calls } = shellFixture(t, mode);
    assert.notEqual(result.status, 0);
    assert.ok(!calls.some(({ args }) => args[0] === 'run' || args[1] === 'create'));
    assert.ok(calls.every(({ host, context }) => host === 'unix:///run/user/1002/docker.sock' && context === null));
  }
});
test('drill mounts source read-only, publishes no port, and removes only its owned temporary volume', (t) => {
  const { result, calls, state } = shellFixture(t, 'success');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(state.removed, true);
  const run = calls.find(({ args }) => args.includes('python3')).args;
  assert.ok(run.includes('type=volume,source=bangla-adventures-staging_bangla-data,target=/source,readonly'));
  assert.ok(run.includes('--network') && run.includes('none'));
  assert.ok(!run.some((arg) => arg === '-p' || arg.startsWith('--publish')));
  assert.deepEqual(calls.filter(({ args }) => args[0] === 'volume' && args[1] === 'rm').map(({ args }) => args[2]), [state.volume]);
});
test('drill runs the digest under any owner\'s bangla-adventure package and refuses other names before Docker', (t) => {
  // After a repository transfer the stage may run a byte-identical copy under the new owner's package.
  const copy = shellFixture(t, 'success', image.replace('ghcr.io/omargad/', 'ghcr.io/client-org/'));
  assert.equal(copy.result.status, 0, copy.result.stderr);
  assert.ok(copy.calls.find(({ args }) => args.includes('python3')).args.includes(image.replace('ghcr.io/omargad/', 'ghcr.io/client-org/')));
  for (const other of [image.replace('/bangla-adventure@', '/other@'), image.replace('ghcr.io/', 'docker.io/'),
    image.replace('ghcr.io/omargad/', 'ghcr.io/Client-Org/'), image.replace('@sha256:', ':latest@sha256:')]) {
    const { result, calls } = shellFixture(t, 'success', other);
    assert.notEqual(result.status, 0, other);
    assert.match(result.stderr, /an immutable application image digest is required/, other);
    assert.deepEqual(calls, [], other);
  }
});
test('helper failure cleans its owned volume; changed ownership refuses deletion and success reporting', (t) => {
  const failed = shellFixture(t, 'helper-failure');
  assert.notEqual(failed.result.status, 0); assert.equal(failed.state.removed, true);
  const moved = shellFixture(t, 'lost-label');
  assert.notEqual(moved.result.status, 0);
  assert.ok(!moved.calls.some(({ args }) => args[0] === 'volume' && args[1] === 'rm'));
  assert.equal(moved.result.stdout, '');
});

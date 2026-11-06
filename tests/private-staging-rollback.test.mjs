import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const script = fs.readFileSync(new URL('../scripts/private-staging-rollback.sh', import.meta.url), 'utf8');
const image = 'ghcr.io/omargad/bangla-adventure@sha256:5f9ac5508771eb97c6b1e4aa4bff8db0fe69569b1f00b08a2e0e02e263d93f13';
const runId = 'a'.repeat(24), project = `ba-private-rollback-${runId}`, volume = `${project}-data`, network = `${project}_default`;
const fixtureRoot = `/opt/bangla-adventures/private-staging/rollback/${runId}`;
function pythonAfter(anchor) {
  const selected = script.slice(script.indexOf(anchor));
  assert.ok(script.includes(anchor));
  return selected.match(/<<'PY'[^\n]*\n([\s\S]*?)\nPY/)[1];
}
const graph = script.slice(script.indexOf('inspect_graph()'), script.indexOf('owned_container()')).match(/python3 -c '\n([\s\S]*?)\n' "\$project"/)[1];
function validateGraph(containers) {
  return spawnSync('python3', ['-c', graph, project, runId, volume, network, fixtureRoot, image, `${project}:unhealthy`], { input: JSON.stringify(containers), encoding: 'utf8' });
}
function app() {
  return {
    Config: { Image: image, User: 'node', Labels: {
      'com.docker.compose.project': project, 'com.docker.compose.service': 'app',
      'io.bangla.scope': 'private-rollback', 'io.bangla.private-rollback.id': runId,
      'io.bangla.private-rollback.phase': 'previous',
    } },
    HostConfig: { NetworkMode: network, PortBindings: {}, PublishAllPorts: false, Privileged: false, CapAdd: null, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges:true'] },
    NetworkSettings: { Ports: { '3000/tcp': null }, Networks: { [network]: {} } },
    Mounts: [
      { Type: 'volume', Name: volume, Destination: '/app/.data', RW: true },
      { Type: 'bind', Source: `${fixtureRoot}/private-staging-verify.mjs`, Destination: '/app/staging-tools/private-staging-verify.mjs', RW: false },
    ],
  };
}

test('rollback clone Compose has only the scoped external clone volume and no published service', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rollback-compose-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const run = spawnSync('python3', ['-', directory, project, volume, runId], { input: pythonAfter('python3 - "$root" "$project" "$volume" "$run_id"'), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const value = JSON.parse(fs.readFileSync(path.join(directory, 'compose.yaml'), 'utf8'));
  assert.deepEqual(Object.keys(value.services), ['app']);
  assert.equal(value.services.app.image, '${APP_IMAGE:?APP_IMAGE required}');
  assert.equal(value.services.app.user, 'node');
  assert.equal(value.services.app.ports, undefined);
  assert.equal(value.networks.default.internal, true);
  assert.deepEqual(value.volumes.data, { name: volume, external: true });
  assert.deepEqual(value.services.app.volumes.map((m) => m.target), ['/app/.data', '/app/staging-tools/private-staging-verify.mjs']);
  assert.ok(!JSON.stringify(value).includes('bangla-adventures-staging_bangla-data'));
  assert.equal(value.services.app.healthcheck.interval, '1s');
});

test('actual inspect guard accepts the clone and rejects original staging volumes, ports and foreign resources', () => {
  assert.equal(validateGraph([app()]).status, 0);
  for (const change of [
    (x) => { x.Mounts[0].Name = 'bangla-adventures-staging_bangla-data'; },
    (x) => { x.HostConfig.PortBindings = { '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: '3001' }] }; },
    (x) => { x.HostConfig.PublishAllPorts = true; },
    (x) => { x.NetworkSettings.Ports['3000/tcp'] = [{ HostIp: '0.0.0.0', HostPort: '3001' }]; },
    (x) => { x.Config.Labels['io.bangla.private-rollback.id'] = 'b'.repeat(24); },
    (x) => { x.Config.Labels['com.docker.compose.service'] = 'foreign'; },
    (x) => { x.HostConfig.CapAdd = ['SYS_ADMIN']; },
    (x) => { x.Mounts[1].Source = '/run/user/1002/docker.sock'; },
    (x) => { x.Mounts.push({ Type: 'bind', Source: '/opt/bangla-adventures', Destination: '/host', RW: true }); },
  ]) {
    const value = app(); change(value);
    assert.notEqual(validateGraph([value]).status, 0);
  }
});

const exportCleanup = script.slice(script.indexOf('remove_source_export()'), script.indexOf('cleanup()')).match(/<<'JS'\n([\s\S]*?)\nJS/)[1];
function cleanupExport(directory, token) {
  return spawnSync(process.execPath, ['--input-type=module', '-', directory, token], { input: exportCleanup, encoding: 'utf8' });
}
function exportFixture(t, token) {
  const directory = `/tmp/ba-private-rollback-${randomBytes(12).toString('hex')}`;
  fs.mkdirSync(directory, { mode: 0o700 });
  fs.writeFileSync(path.join(directory, '.owner'), token, { mode: 0o600 });
  fs.writeFileSync(path.join(directory, 'snapshot.db'), 'disposable online snapshot', { mode: 0o600 });
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('owned online export is removed, while a colliding prior export is preserved', (t) => {
  const token = 'c'.repeat(32), owned = exportFixture(t, token);
  assert.equal(cleanupExport(owned, token).status, 0);
  assert.equal(fs.existsSync(owned), false);
  const previous = exportFixture(t, 'd'.repeat(32));
  assert.notEqual(cleanupExport(previous, token).status, 0);
  assert.equal(fs.readFileSync(path.join(previous, 'snapshot.db'), 'utf8'), 'disposable online snapshot');
  assert.equal(fs.readFileSync(path.join(previous, '.owner'), 'utf8'), 'd'.repeat(32));
});

test('online export cleanup validates the entire directory before deleting any file', (t) => {
  const token = 'c'.repeat(32);
  const extra = exportFixture(t, token);
  fs.writeFileSync(path.join(extra, 'unrelated'), 'retain');
  assert.notEqual(cleanupExport(extra, token).status, 0);
  assert.equal(fs.existsSync(path.join(extra, '.owner')), true);
  assert.equal(fs.existsSync(path.join(extra, 'snapshot.db')), true);
  const linked = exportFixture(t, token);
  fs.unlinkSync(path.join(linked, 'snapshot.db'));
  fs.symlinkSync(path.join(extra, 'unrelated'), path.join(linked, 'snapshot.db'));
  assert.notEqual(cleanupExport(linked, token).status, 0);
  assert.equal(fs.readFileSync(path.join(extra, 'unrelated'), 'utf8'), 'retain');
  assert.equal(fs.existsSync(path.join(linked, '.owner')), true);
});

test('candidate proof requires an actual unhealthy event from the exact derived image and phase', () => {
  const code = pythonAfter('python3 - "$root/events.jsonl" "$candidate" "$candidate_id"');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rollback-events-'));
  try {
    const file = path.join(directory, 'events.jsonl'), candidate = `${project}:unhealthy`, candidateId = `sha256:${'d'.repeat(64)}`;
    const event = { Action: 'health_status: unhealthy', Actor: { Attributes: { image: candidate, 'io.bangla.private-rollback.phase': 'candidate' } } };
    const run = (e) => { fs.writeFileSync(file, `${JSON.stringify(e)}\n`); return spawnSync('python3', ['-', file, candidate, candidateId], { input: code, encoding: 'utf8' }); };
    assert.equal(run(event).status, 0);
    assert.notEqual(run({ ...event, Action: 'health_status: healthy' }).status, 0);
    assert.notEqual(run({ ...event, Actor: { Attributes: { image, 'io.bangla.private-rollback.phase': 'candidate' } } }).status, 0);
    assert.notEqual(run({ ...event, Actor: { Attributes: { image: candidate, 'io.bangla.private-rollback.phase': 'previous' } } }).status, 0);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('the rehearsal invokes the actual unchanged deployment engine and keeps private overrides inside the clone', () => {
  assert.equal(spawnSync('bash', ['-n'], { input: script, encoding: 'utf8' }).status, 0);
  assert.match(script, /cp -- "\$payload\/deploy-remote\.sh" "\$incoming\/deploy-remote\.sh"/);
  assert.match(script, /\[ "\$\(sha256sum "\$incoming\/deploy-remote\.sh" \| cut -d' ' -f1\)" = "\$engine_hash" \]/);
  assert.match(script, /bash "\$incoming\/deploy-remote\.sh" "\$candidate" '' 1 15 "\$daemon" '' true '' false "\$root" "\$incoming"/);
  assert.match(script, /--filter label=io\.bangla\.private-rollback\.phase=candidate/);
  assert.match(script, /chown 0:0 \/backups && chmod 0700 \/backups/);
  const builder = script.match(/docker container create --name "\$builder"[^\n]+/)[0];
  assert.doesNotMatch(builder, /--mount|--volume|--env|\scp\s/);
  assert.match(builder, /--network none --user node "\$image"/);
  assert.doesNotMatch(script, /docker (?:system|volume) prune|DEPLOY_ENABLED=true|docker (?:stop|restart) "\$source_id"/);
});

test('the rehearsal uses the image path the stage release records, with the reviewed digest only', (t) => {
  const reader = script.match(/^image="\$\(python3 -c '([^']+)' "\$stage\/release\.json" "\$digest"\)"/m)[1];
  const digest = image.split('@')[1];
  assert.match(script, new RegExp(`^readonly digest=${digest}$`, 'm'));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rollback-release-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const release = path.join(directory, 'release.json');
  const read = (value) => {
    fs.writeFileSync(release, JSON.stringify(value));
    return spawnSync('python3', ['-c', reader, release, digest], { encoding: 'utf8' });
  };
  // The original package by default, or a byte-identical copy under the repository's new owner.
  for (const stageImage of [image, `ghcr.io/client-org/bangla-adventure@${digest}`]) {
    const result = read({ scope: 'private-staging', image: stageImage });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `${stageImage}\n`);
  }
  for (const stageImage of [`ghcr.io/omargad/bangla-adventure@sha256:${'0'.repeat(64)}`, `ghcr.io/client-org/other@${digest}`,
    `docker.io/client-org/bangla-adventure@${digest}`, `ghcr.io/Client-Org/bangla-adventure@${digest}`, 7]) {
    assert.notEqual(read({ image: stageImage }).status, 0, String(stageImage));
  }
  assert.notEqual(read({}).status, 0);
});

test('bad invocation reports only a fixed rollback phase before any platform or Docker operation', () => {
  const run = spawnSync('bash', ['-s', '--', 'not-a-run-id'], { input: script, encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /^PRIVATE_ROLLBACK_DIAGNOSTIC:platform\n/m);
  assert.doesNotMatch(run.stderr, /not-a-run-id|REGISTRY|PRIVATE KEY/);
  assert.equal(run.stdout, '');
  const phases = [...script.matchAll(/^phase=([-a-z]+)$/gm)].map((x) => x[1]);
  assert.deepEqual(phases, ['platform', 'export', 'clone', 'known-good', 'candidate', 'engine', 'verify']);
  assert.match(script, /  phase=cleanup/);
});

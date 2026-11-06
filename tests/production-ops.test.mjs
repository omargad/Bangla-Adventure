import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import yaml from 'js-yaml';

const root = new URL('../', import.meta.url).pathname;
const read = (name) => readFileSync(path.join(root, name), 'utf8');
const workflow = (name) => yaml.load(read(`.github/workflows/${name}`));

test('production operations prove deferral, recovery, monitoring codes, off-site rules, status and installer safety', () => {
  const result = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'production_ops_test.py', '-v'],
    { cwd: root, encoding: 'utf8', timeout: 120_000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('both production workflows are gated on an enabled production deployment on main', () => {
  const ops = workflow('vps-production-ops.yml');
  const status = workflow('vps-production-status.yml');
  const deploy = workflow('ci.yml').jobs.deploy.steps.find((step) => step.env?.DEPLOY_HOST_FINGERPRINT);
  assert.deepEqual(Object.keys(ops.on), ['workflow_dispatch']);
  const { action, confirm } = ops.on.workflow_dispatch.inputs;
  assert.equal(action.type, 'choice');
  assert.deepEqual(action.options, ['install', 'status', 'backup-now']);
  assert.equal(confirm.type, 'boolean');
  assert.equal(confirm.default, false);
  assert.match(action.description, /DEPLOY_ENABLED/);
  assert.equal(ops.jobs.operate.environment, 'production');
  assert.deepEqual([].concat(ops.jobs.operate.needs), ['validate']);
  assert.match(status.on.schedule[0].cron, /^([1-9]|[1-5][0-9]) /, 'the schedule avoids minute 0');
  assert.ok('workflow_dispatch' in status.on);
  // The daily alert never waits for a deploy approval, so it has its own environment.
  assert.equal(status.jobs.status.environment, 'production-status');
  for (const [file, job] of [['ops', ops.jobs.validate], ['ops', ops.jobs.operate], ['status', status.jobs.status]]) {
    for (const gate of ["vars.DEPLOY_ENABLED == 'true'", "github.ref == 'refs/heads/main'", "github.repository == 'omargad/Bangla-Adventure'"]) {
      assert.ok(job.if.includes(gate), `${file}: ${gate}`);
    }
  }
  for (const job of [ops.jobs.validate, ops.jobs.operate]) assert.ok(job.if.includes('inputs.confirm == true'));
  for (const document of [ops, status]) assert.deepEqual(document.permissions, { contents: 'read' });
  for (const [job, command] of [[ops.jobs.operate, 'bash scripts/production-ops-controller.sh "$OPERATION"'], [status.jobs.status, 'bash scripts/production-ops-controller.sh status']]) {
    const step = job.steps.find((item) => item.env?.DEPLOY_HOST);
    assert.equal(step.run, command);
    assert.equal(step.env.DEPLOY_HOST, '${{ secrets.DEPLOY_HOST }}');
    assert.equal(step.env.DEPLOY_USER, '${{ secrets.DEPLOY_USER }}');
    assert.equal(step.env.DEPLOY_SSH_KEY, '${{ secrets.DEPLOY_SSH_KEY }}');
    assert.equal(step.env.DEPLOY_KNOWN_HOSTS, '${{ vars.DEPLOY_KNOWN_HOSTS }}');
    assert.equal(step.env.DEPLOY_ENABLED, '${{ vars.DEPLOY_ENABLED }}');
    for (const name of ['DEPLOY_HOST_FINGERPRINT', 'DEPLOY_KEY_FINGERPRINT', 'DEPLOY_PORT', 'DEPLOY_PATH', 'DEPLOY_DOCKER_HOST', 'DEPLOY_DOCKER_CONTEXT']) {
      assert.equal(step.env[name], deploy.env[name], name);
    }
  }
  for (const name of ['vps-production-ops.yml', 'vps-production-status.yml', '../../scripts/production-ops-controller.sh']) {
    const text = read(`.github/workflows/${name}`);
    const addresses = (text.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) || []).filter((value) => value !== '127.0.0.1');
    assert.deepEqual(addresses, [], `${name} holds no literal address`);
    assert.doesNotMatch(text, /PRODUCTION_OPS_/);
  }
  assert.doesNotMatch(read('scripts/production-ops-controller.sh'), /(printf|echo)[^\n]*\$\{?DEPLOY_(HOST|USER)/);
});

function keys(folder) {
  const make = (name) => {
    const file = path.join(folder, name);
    const made = spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', '', '-f', file], { encoding: 'utf8' });
    assert.equal(made.status, 0, made.stderr);
    const fingerprint = spawnSync('ssh-keygen', ['-l', '-E', 'sha256', '-f', file + '.pub'], { encoding: 'utf8' }).stdout.split(' ')[1];
    return { file, fingerprint, public: readFileSync(file + '.pub', 'utf8').trim() };
  };
  return { deploy: make('deploy'), host: make('host'), other: make('other') };
}

const stub = String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const command = args.at(-1);
const input = fs.readFileSync(0);
fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ args, input: input.length }) + '\n');
const out = (text, code = 0) => { process.stdout.write(text + '\n'); process.exit(code); };
if (command.includes('mktemp -d')) out('/opt/bangla-adventures/ops/.incoming.AbCdEf123456');
if (command.includes('tar --extract')) { fs.writeFileSync(process.env.STUB_TAR, input); process.exit(0); }
if (command.includes('production-ops-install.sh')) out(process.env.STUB_RESULT, Number(process.env.STUB_EXIT || 0));
if (command.includes('production-ops.sh status')) out(process.env.STUB_RESULT, Number(process.env.STUB_EXIT || 0));
if (command === 'bash -s') out('{"started":1000,"exitStatus":"' + process.env.STUB_RUN + '"}\n' + process.env.STUB_RESULT);
if (command.includes('rm -rf')) process.exit(0);
process.exit(9);
`;

const sshKeygen = spawnSync('ssh-keygen', ['-?'], { encoding: 'utf8' }).error === undefined;

test('the controller verifies the pinned keys before SSH, prints no address and fails on a failing status', { skip: !sshKeygen && 'ssh-keygen is not installed' }, () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'production-ops-controller-'));
  try {
    const bin = path.join(folder, 'bin');
    mkdirSync(bin);
    writeFileSync(path.join(bin, 'ssh'), stub);
    chmodSync(path.join(bin, 'ssh'), 0o755);
    const pair = keys(folder);
    const log = path.join(folder, 'ssh.log');
    const healthy = { scope: 'production-operations', action: 'status', verified: true, status: 'healthy', codes: [],
      backup: { status: 'passed', ageSeconds: 3600, codes: [], checkedAtEpoch: 2000 }, monitor: { status: 'healthy', ageSeconds: 60, codes: [] },
      offsite: { status: 'not-configured', ageSeconds: null, codes: [] }, timers: { backup: true, monitor: true, offsite: true } };
    const base = {
      PATH: `${bin}:${process.env.PATH}`, HOME: folder, STUB_LOG: log, STUB_TAR: path.join(folder, 'payload.tar'),
      DEPLOY_ENABLED: 'true', GITHUB_REPOSITORY: 'omargad/Bangla-Adventure', GITHUB_REF: 'refs/heads/main',
      DEPLOY_HOST: 'vps.example.test', DEPLOY_USER: 'deployer', DEPLOY_SSH_KEY: readFileSync(pair.deploy.file, 'utf8'),
      DEPLOY_KNOWN_HOSTS: `vps.example.test ${pair.host.public}`, DEPLOY_HOST_FINGERPRINT: pair.host.fingerprint,
      DEPLOY_KEY_FINGERPRINT: pair.deploy.fingerprint, STUB_RESULT: JSON.stringify(healthy),
    };
    const run = (action, env = {}) => {
      rmSync(log, { force: true });
      const result = spawnSync('bash', [path.join(root, 'scripts/production-ops-controller.sh'), action], { env: { ...base, ...env }, encoding: 'utf8', timeout: 60_000 });
      const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : [];
      const output = result.stdout + result.stderr;
      assert.doesNotMatch(output, /vps\.example\.test|deployer/, 'the address and account are never printed');
      return { status: result.status, output, calls };
    };

    const good = run('status');
    assert.equal(good.status, 0, good.output);
    assert.match(good.output, /status: healthy/);
    assert.equal(good.calls.length, 1);
    const options = good.calls[0].args;
    assert.equal(options.at(-2), 'deployer@vps.example.test');
    for (const option of ['StrictHostKeyChecking=yes', 'BatchMode=yes', 'IdentitiesOnly=yes', 'GlobalKnownHostsFile=/dev/null', 'UpdateHostKeys=no', 'ClearAllForwardings=yes']) {
      assert.ok(options.includes(option), option);
    }

    const failing = run('status', { STUB_RESULT: JSON.stringify({ ...healthy, verified: false, status: 'failed', codes: ['monitor-report-failed'],
      monitor: { status: 'failed', ageSeconds: 60, codes: ['disk-low'] } }), STUB_EXIT: '1' });
    assert.equal(failing.status, 1);
    assert.match(failing.output, /monitor-report-failed/);
    assert.match(failing.output, /disk-low/);

    for (const [env, message] of [
      [{ DEPLOY_ENABLED: 'false' }, /not enabled/], [{ GITHUB_REF: 'refs/heads/feature' }, /main branch/],
      [{ DEPLOY_KEY_FINGERPRINT: pair.other.fingerprint }, /deploy key fingerprint/],
      [{ DEPLOY_KNOWN_HOSTS: `vps.example.test ${pair.other.public}` }, /known_hosts fingerprint/],
      [{ DEPLOY_KNOWN_HOSTS: `vps.example.test ${pair.host.public}\nvps.example.test ${pair.other.public}` }, /known_hosts fingerprint/],
      [{ DEPLOY_KNOWN_HOSTS: `@cert-authority vps.example.test ${pair.host.public}` }, /markers/],
      [{ DEPLOY_KNOWN_HOSTS: `other.example.test ${pair.host.public}` }, /do not cover/],
      [{ DEPLOY_PATH: '/srv/elsewhere' }, /DEPLOY_PATH/], [{ DEPLOY_DOCKER_HOST: 'unix:///var/run/docker.sock' }, /DEPLOY_DOCKER_HOST/],
      [{ DEPLOY_USER: 'Root;id' }, /DEPLOY_USER secret/],
    ]) {
      const refused = run('status', env);
      assert.equal(refused.status, 1, JSON.stringify(env));
      assert.match(refused.output, message);
      assert.equal(refused.calls.length, 0, 'nothing reaches SSH before the pins pass');
    }

    const installed = run('install', { STUB_RESULT: JSON.stringify({ scope: 'production-operations', action: 'install', verified: true, status: 'passed', codes: [],
      timers: { backup: true, monitor: true, offsite: true }, initialRuns: { backup: {}, monitor: {} } }) });
    assert.equal(installed.status, 0, installed.output);
    const listing = spawnSync('tar', ['-tf', base.STUB_TAR], { encoding: 'utf8' }).stdout.trim().split('\n').sort();
    assert.deepEqual(listing, ['ba-production-backup.service', 'ba-production-backup.timer', 'ba-production-monitor.service', 'ba-production-monitor.timer',
      'ba-production-offsite.service', 'ba-production-offsite.timer', 'production-ops-install.py', 'production-ops-install.sh', 'production-ops.py', 'production-ops.sh']);
    assert.match(installed.calls.at(-1).args.at(-1), /rm -rf -- '\/opt\/bangla-adventures\/ops\/\.incoming\.AbCdEf123456'/, 'the incoming folder is removed');

    const backup = run('backup-now', { STUB_RUN: '0' });
    assert.equal(backup.status, 0, backup.output);
    assert.match(backup.output, /backup-now: passed/);
    const deferred = run('backup-now', { STUB_RUN: '75' });
    assert.equal(deferred.status, 1);
    assert.match(deferred.output, /deferred/);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

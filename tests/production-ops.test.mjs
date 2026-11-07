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
  const guarded = "${{ secrets.DEPLOY_HOST != '' && vars.DEPLOY_KNOWN_HOSTS || '' }}";
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
  // The daily alert never waits for a deploy approval, so it has its own environment, and with it
  // its own status key that the server limits to status: it never sees the deploy key.
  assert.equal(status.jobs.status.environment, 'production-status');
  assert.doesNotMatch(read('.github/workflows/vps-production-status.yml'), /DEPLOY_SSH_KEY/);
  // The status key's public line replaced the old fingerprint variable everywhere.
  const retired = ['STATUS', 'KEY', 'FINGERPRINT'].join('_');
  for (const name of ['.github/workflows/vps-production-ops.yml', '.github/workflows/vps-production-status.yml', 'scripts/production-ops-controller.sh',
    'scripts/production-ops-install.py', 'docs/PRODUCTION_OPERATIONS.md', 'docs/VPS_DEPLOYMENT.md', 'docs/DEPLOYMENT.md',
    'deploy/vps.github-variables.env.example', 'tests/production_ops_test.py', 'tests/production-ops.test.mjs']) {
    assert.ok(!read(name).includes(retired), `${name} no longer names the fingerprint variable`);
  }
  assert.match(read('deploy/vps.github-variables.env.example'), /^STATUS_SSH_PUBLIC_KEY=$/m);
  for (const [file, job] of [['ops', ops.jobs.validate], ['ops', ops.jobs.operate], ['status', status.jobs.status]]) {
    // The repository is recognised by its numeric ID, which a transfer keeps; no owner name is written.
    for (const gate of ["vars.DEPLOY_ENABLED == 'true'", "github.ref == 'refs/heads/main'", "github.repository_id == (vars.PRODUCTION_REPOSITORY_ID || '1436643374')"]) {
      assert.ok(job.if.includes(gate), `${file}: ${gate}`);
    }
    assert.doesNotMatch(job.if, /omargad|github\.repository ==/);
    for (const step of job.steps.filter((item) => item.run?.startsWith('bash scripts/production-ops-controller.sh'))) {
      assert.equal(step.env.PRODUCTION_REPOSITORY_ID, '${{ vars.PRODUCTION_REPOSITORY_ID }}', `${file}: ${step.run}`);
    }
  }
  // Elsewhere a requested run fails with an explanation instead of skipping silently, and touches nothing.
  for (const [file, document] of [['ops', ops], ['status', status]]) {
    const other = document.jobs['other-repository'];
    assert.ok(other.if.includes("github.repository_id != (vars.PRODUCTION_REPOSITORY_ID || '1436643374')"), file);
    assert.ok(other.if.includes("vars.DEPLOY_ENABLED == 'true'"), file);
    assert.deepEqual(other.permissions, {});
    assert.equal(other.environment, undefined);
    assert.match(other.steps.at(-1).run, /PRODUCTION_REPOSITORY_ID[\s\S]*exit 1/);
    assert.doesNotMatch(JSON.stringify(other), /secrets\./);
  }
  for (const job of [ops.jobs.validate, ops.jobs.operate]) assert.ok(job.if.includes('inputs.confirm == true'));
  for (const document of [ops, status]) assert.deepEqual(document.permissions, { contents: 'read' });
  for (const [job, command] of [[ops.jobs.operate, 'bash scripts/production-ops-controller.sh "$OPERATION"'], [status.jobs.status, 'bash scripts/production-ops-controller.sh scheduled-status']]) {
    const step = job.steps.find((item) => item.env?.DEPLOY_HOST);
    assert.equal(step.run, command);
    assert.equal(step.env.DEPLOY_HOST, '${{ secrets.DEPLOY_HOST }}');
    assert.equal(step.env.DEPLOY_USER, '${{ secrets.DEPLOY_USER }}');
    // A repository variable, so both the install (production) and the daily check (production-status) read it.
    assert.equal(step.env.STATUS_SSH_PUBLIC_KEY, '${{ vars.STATUS_SSH_PUBLIC_KEY }}');
    if (job === ops.jobs.operate) {
      assert.equal(step.env.DEPLOY_SSH_KEY, '${{ secrets.DEPLOY_SSH_KEY }}');
      assert.equal(step.env.STATUS_SSH_KEY, undefined);
    } else {
      assert.equal(step.env.DEPLOY_SSH_KEY, undefined);
      assert.equal(step.env.STATUS_SSH_KEY, '${{ secrets.STATUS_SSH_KEY }}');
    }
    assert.deepEqual(Object.keys(step.env).filter((name) => /^STATUS_/.test(name)).sort(),
      job === ops.jobs.operate ? ['STATUS_SSH_PUBLIC_KEY'] : ['STATUS_SSH_KEY', 'STATUS_SSH_PUBLIC_KEY']);
    // Only with the address secret, which masks the address inside an unhashed line.
    assert.equal(step.env.DEPLOY_KNOWN_HOSTS, guarded);
    assert.equal(step.env.DEPLOY_ENABLED, '${{ vars.DEPLOY_ENABLED }}');
    for (const name of ['DEPLOY_HOST_FINGERPRINT', 'DEPLOY_KEY_FINGERPRINT', 'DEPLOY_PORT', 'DEPLOY_PATH', 'DEPLOY_DOCKER_HOST', 'DEPLOY_DOCKER_CONTEXT']) {
      assert.equal(step.env[name], deploy.env[name], name);
    }
  }
  // The reviewer sees the status key change before approving, and install gets exactly that request.
  const request = ops.jobs.validate.steps.find((item) => item.id === 'status_key');
  assert.equal(request.run, 'bash scripts/production-ops-controller.sh status-key-request');
  assert.equal(request.if, "inputs.action == 'install'");
  assert.deepEqual(Object.keys(request.env).sort(), ['DEPLOY_ENABLED', 'DEPLOY_KEY_FINGERPRINT', 'PRODUCTION_REPOSITORY_ID', 'STATUS_SSH_PUBLIC_KEY']);
  assert.equal(request.env.STATUS_SSH_PUBLIC_KEY, '${{ vars.STATUS_SSH_PUBLIC_KEY }}');
  assert.equal(ops.jobs.validate.environment, undefined, 'validate runs before the approval');
  assert.doesNotMatch(JSON.stringify(ops.jobs.validate), /secrets\./, 'validate holds no credential');
  assert.equal(ops.jobs.validate.outputs.status_key, '${{ steps.status_key.outputs.status_key }}');
  assert.equal(ops.jobs.operate.steps.find((item) => item.env?.DEPLOY_HOST).env.APPROVED_STATUS_KEY, '${{ needs.validate.outputs.status_key }}');
  // Every VPS workflow passes the known_hosts line only with the address secret.
  for (const name of ['ci.yml', 'vps-ssh-preflight.yml', 'vps-image-preflight.yml', 'vps-private-staging.yml', 'vps-acceptance.yml',
    'vps-offsite-rehearsal.yml', 'vps-production-ops.yml', 'vps-production-status.yml']) {
    const lines = read(`.github/workflows/${name}`).split('\n').filter((line) => /^\s+DEPLOY_KNOWN_HOSTS:/.test(line));
    assert.ok(lines.length > 0, name);
    for (const line of lines) assert.equal(line.trim(), `DEPLOY_KNOWN_HOSTS: ${guarded}`, name);
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
    const line = readFileSync(file + '.pub', 'utf8').trim();
    return { file, fingerprint, public: line, blob: line.split(' ')[1] };
  };
  const ecdsa = path.join(folder, 'ecdsa');
  assert.equal(spawnSync('ssh-keygen', ['-q', '-t', 'ecdsa', '-N', '', '-C', '', '-f', ecdsa]).status, 0);
  const locked = path.join(folder, 'locked');
  assert.equal(spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', 'throwaway-passphrase', '-C', '', '-f', locked]).status, 0);
  return { deploy: make('deploy'), host: make('host'), other: make('other'), status: make('status'), ecdsa: readFileSync(ecdsa + '.pub', 'utf8').trim(),
    locked: readFileSync(locked, 'utf8') };
}

const stub = String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const command = args.at(-1);
const input = fs.readFileSync(0);
fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ args, input: input.length }) + '\n');
const out = (text, code = 0) => { process.stdout.write(text + '\n'); process.exit(code); };
// ssh's own failure: its message names the account and server, and it exits 255.
const fault = (text = '') => { process.stdout.write(text); process.stderr.write(process.env.STUB_SSH_ERROR + '\n'); process.exit(255); };
// Only the account whose authorized_keys holds the key is let in.
const account = args.at(-2).split('@')[0];
if (process.env.STUB_ACCOUNT && account !== process.env.STUB_ACCOUNT) { process.stderr.write(account + '@vps.example.test: Permission denied (publickey).\n'); process.exit(255); }
if (process.env.STUB_SSH_ERROR && !process.env.STUB_DROP) fault();
if (command.includes('mktemp -d')) out('/opt/bangla-adventures/ops/.incoming.AbCdEf123456');
if (command.includes('tar --extract')) { fs.writeFileSync(process.env.STUB_TAR, input); process.exit(0); }
if (command.includes('production-ops-install.sh')) out(process.env.STUB_RESULT, Number(process.env.STUB_EXIT || 0));
if (command.includes('production-ops.sh status')) out(process.env.STUB_RESULT, Number(process.env.STUB_EXIT || 0));
// STUB_DROP: the connection is lost once the backup is being started, after what the server sent so far.
if (command === 'bash -s' && process.env.STUB_DROP) fault(process.env.STUB_DROP);
if (command === 'bash -s') out('starting\n{"started":1000,"exitStatus":"' + process.env.STUB_RUN + '"}\n' + process.env.STUB_RESULT);
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
      DEPLOY_ENABLED: 'true', GITHUB_REPOSITORY_ID: '1436643374', GITHUB_REF: 'refs/heads/main',
      DEPLOY_HOST: 'vps.example.test', DEPLOY_USER: 'deployer', DEPLOY_SSH_KEY: readFileSync(pair.deploy.file, 'utf8'),
      DEPLOY_KNOWN_HOSTS: `vps.example.test ${pair.host.public}`, DEPLOY_HOST_FINGERPRINT: pair.host.fingerprint,
      DEPLOY_KEY_FINGERPRINT: pair.deploy.fingerprint, STUB_RESULT: JSON.stringify(healthy), APPROVED_STATUS_KEY: 'unchanged',
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

    // The owner name plays no part; only a re-created repository names its own ID.
    assert.equal(run('status', { GITHUB_REPOSITORY: 'client-org/Bangla-Adventure' }).status, 0);
    assert.equal(run('status', { GITHUB_REPOSITORY_ID: '1', PRODUCTION_REPOSITORY_ID: '1' }).status, 0);

    const failing = run('status', { STUB_RESULT: JSON.stringify({ ...healthy, verified: false, status: 'failed', codes: ['monitor-report-failed'],
      monitor: { status: 'failed', ageSeconds: 60, codes: ['disk-low'] } }), STUB_EXIT: '1' });
    assert.equal(failing.status, 1);
    assert.match(failing.output, /monitor-report-failed/);
    assert.match(failing.output, /disk-low/);

    for (const [env, message] of [
      [{ DEPLOY_ENABLED: 'false' }, /not enabled/], [{ GITHUB_REF: 'refs/heads/feature' }, /main branch/],
      [{ GITHUB_REPOSITORY_ID: '1' }, /main branch/], [{ GITHUB_REPOSITORY_ID: '' }, /main branch/],
      [{ DEPLOY_KEY_FINGERPRINT: pair.other.fingerprint }, /key fingerprint does not match DEPLOY_KEY_FINGERPRINT/],
      [{ DEPLOY_KNOWN_HOSTS: `vps.example.test ${pair.other.public}` }, /known_hosts fingerprint/],
      [{ DEPLOY_KNOWN_HOSTS: `vps.example.test ${pair.host.public}\nvps.example.test ${pair.other.public}` }, /known_hosts fingerprint/],
      [{ DEPLOY_KNOWN_HOSTS: `@cert-authority vps.example.test ${pair.host.public}` }, /markers/],
      [{ DEPLOY_KNOWN_HOSTS: `other.example.test ${pair.host.public}` }, /do not cover/],
      [{ DEPLOY_PATH: '/srv/elsewhere' }, /DEPLOY_PATH/], [{ DEPLOY_DOCKER_HOST: 'unix:///var/run/docker.sock' }, /DEPLOY_DOCKER_HOST/],
      [{ DEPLOY_USER: 'Root;id' }, /DEPLOY_USER secret is invalid/],
      // The owner keeps these on the production environment, so the message names that environment and the exact name.
      [{ DEPLOY_HOST: '' }, /the secret DEPLOY_HOST is missing: add it under Settings > Environments > production > Environment secrets, named exactly DEPLOY_HOST \(or make it a repository secret\)\./],
      [{ DEPLOY_USER: '' }, /the secret DEPLOY_USER is missing: add it under Settings > Environments > production > Environment secrets, named exactly DEPLOY_USER/],
      [{ DEPLOY_KNOWN_HOSTS: '' }, /the variable DEPLOY_KNOWN_HOSTS is missing: add it under Settings > Environments > production > Environment variables, named exactly DEPLOY_KNOWN_HOSTS \(or make it a repository variable\)\./],
      // The workflow passes no known_hosts line without the address secret, and the address is named first.
      [{ DEPLOY_HOST: '', DEPLOY_KNOWN_HOSTS: '' }, /the secret DEPLOY_HOST is missing/],
      [{ DEPLOY_SSH_KEY: pair.locked }, /the DEPLOY_SSH_KEY secret is not an unencrypted private key/],
    ]) {
      const refused = run('status', env);
      assert.equal(refused.status, 1, JSON.stringify(env));
      assert.match(refused.output, message);
      assert.equal(refused.calls.length, 0, 'nothing reaches SSH before the pins pass');
    }
    // Only install reads the status key's public line.
    assert.equal(run('status', { STATUS_SSH_PUBLIC_KEY: 'not a key' }).status, 0);

    // The daily alert: its own key, which must be exactly the public line install restricted; the deploy key must not reach it.
    const statusKey = { DEPLOY_SSH_KEY: '', STATUS_SSH_KEY: readFileSync(pair.status.file, 'utf8'),
      STATUS_SSH_PUBLIC_KEY: `${pair.status.public} bangla-adventures-status\r\n` };
    const scheduled = run('scheduled-status', statusKey);
    assert.equal(scheduled.status, 0, scheduled.output);
    assert.match(scheduled.output, /status: healthy/);
    assert.equal(scheduled.calls.length, 1);
    assert.match(scheduled.calls[0].args.at(-1), /production-ops\.sh status$/);
    assert.ok(scheduled.calls[0].args.includes('StrictHostKeyChecking=yes'), 'host-key pinning is unchanged');
    for (const [env, message] of [
      [{ DEPLOY_SSH_KEY: base.DEPLOY_SSH_KEY }, /must not receive the DEPLOY_SSH_KEY/],
      [{ STATUS_SSH_KEY: '' }, /the secret STATUS_SSH_KEY is missing: add it under Settings > Environments > production-status > Environment secrets, named exactly STATUS_SSH_KEY \(there only, never as a repository secret\)\./],
      [{ STATUS_SSH_PUBLIC_KEY: ' \n' }, /the variable STATUS_SSH_PUBLIC_KEY is missing: add it as a repository variable/],
      // Production environment settings are invisible here, and the message says so.
      [{ DEPLOY_HOST: '' }, /the secret DEPLOY_HOST is missing: this check runs in the production-status environment, which cannot see production environment secrets; add it under Settings > Environments > production-status > Environment secrets, named exactly DEPLOY_HOST \(or make it a repository secret\)\./],
      [{ DEPLOY_KNOWN_HOSTS: '' }, /the variable DEPLOY_KNOWN_HOSTS is missing: this check runs in the production-status environment, which cannot see production environment variables; add it under Settings > Environments > production-status > Environment variables/],
      [{ STATUS_SSH_KEY: pair.locked }, /the STATUS_SSH_KEY secret is not an unencrypted private key \(make the pair again and press Enter at both passphrase prompts\)/],
      [{ DEPLOY_KNOWN_HOSTS: `other.example.test ${pair.host.public}` }, /DEPLOY_KNOWN_HOSTS lines do not cover the DEPLOY_HOST secret and DEPLOY_PORT/],
      [{ STATUS_SSH_PUBLIC_KEY: 'remove' }, /STATUS_SSH_PUBLIC_KEY variable is remove/],
      [{ STATUS_SSH_PUBLIC_KEY: pair.other.public }, /STATUS_SSH_KEY secret does not match the STATUS_SSH_PUBLIC_KEY variable/],
      [{ STATUS_SSH_PUBLIC_KEY: pair.ecdsa }, /one ssh-ed25519 public key line/],
      [{ STATUS_SSH_PUBLIC_KEY: pair.deploy.public }, /must not be the deploy key/],
      [{ STATUS_SSH_KEY: readFileSync(pair.deploy.file, 'utf8'), STATUS_SSH_PUBLIC_KEY: pair.deploy.public }, /must not be the deploy key/],
      [{ STATUS_SSH_KEY: readFileSync(pair.other.file, 'utf8') }, /does not match the STATUS_SSH_PUBLIC_KEY variable/],
    ]) {
      const refused = run('scheduled-status', { ...statusKey, ...env });
      assert.equal(refused.status, 1, JSON.stringify(env));
      assert.match(refused.output, message);
      assert.equal(refused.calls.length, 0, 'nothing reaches SSH before the status key passes');
    }
    // The ordinary actions still need the deploy key.
    assert.match(run('status', { DEPLOY_SSH_KEY: '', STATUS_SSH_KEY: statusKey.STATUS_SSH_KEY }).output,
      /the secret DEPLOY_SSH_KEY is missing: add it under Settings > Environments > production > Environment secrets, named exactly DEPLOY_SSH_KEY\./);

    // ssh's own failure (exit 255) gets a fixed message that names the setting, never ssh's own text.
    // The texts are OpenSSH's own: a reset or a time-out in the first exchange means no session either.
    const connect = /could not connect over SSH: check the DEPLOY_HOST secret, DEPLOY_PORT and that the server is running\./;
    const lost = /the SSH connection was lost before the run finished: run it again\./;
    const carriesOn = /the SSH connection was lost during the run; that does not stop the backup, which runs on the server as ba-production-backup\.service: run status in a few minutes to see its result\./;
    const closed = 'Connection to vps.example.test closed by remote host.';
    const silent = 'Timeout, server vps.example.test not responding.';
    for (const [action, env, error, message] of [
      ['scheduled-status', statusKey, 'deployer@vps.example.test: Permission denied (publickey).', /the server refused the status key: run VPS production operations install with the repository variable STATUS_SSH_PUBLIC_KEY set/],
      ['status', {}, 'deployer@vps.example.test: Permission denied (publickey).', /the server refused the DEPLOY_SSH_KEY secret: its public half must be in the authorized_keys of the account that the DEPLOY_USER secret names\./],
      ['scheduled-status', statusKey, 'Host key verification failed.', /host key does not match DEPLOY_KNOWN_HOSTS and DEPLOY_HOST_FINGERPRINT/],
      ['status', {}, 'ssh: connect to host vps.example.test port 22: Connection timed out', connect],
      ['install', {}, 'deployer@vps.example.test: Permission denied (publickey).', /the server refused the DEPLOY_SSH_KEY secret/],
      ['backup-now', {}, 'ssh: connect to host vps.example.test port 22: Connection refused', connect],
      ['status', {}, 'ssh: Could not resolve hostname vps.example.test: Name or service not known', connect],
      ['scheduled-status', statusKey, 'kex_exchange_identification: read: Connection reset by peer\nConnection reset by vps.example.test port 22', connect],
      ['backup-now', {}, 'Connection timed out during banner exchange\nConnection to vps.example.test port 22 timed out', connect],
      // A session that was made and then lost: the result is missing, the settings are not at fault.
      ['status', {}, closed, lost], ['scheduled-status', statusKey, silent, lost], ['install', {}, closed, lost],
      // backup-now: the server says just before the start that it is starting the backup, so a drop
      // after that leaves the backup running, and the remote errors in the log are not ssh's.
      ['backup-now', { STUB_DROP: 'starting\n' }, closed, carriesOn],
      ['backup-now', { STUB_DROP: 'starting\n' }, silent, carriesOn],
      ['backup-now', { STUB_DROP: 'starting\n' }, `Failed to connect to bus: Permission denied\n${closed}`, carriesOn],
      ['backup-now', {}, closed, /the SSH connection was lost before the server confirmed that the backup started: run backup-now again, which never runs two backups at once\./],
    ]) {
      const refused = run(action, { ...env, STUB_SSH_ERROR: error });
      assert.equal(refused.status, 1, `${action}: ${error}`);
      assert.match(refused.output, message, `${action}: ${error}`);
      assert.doesNotMatch(refused.output, /Permission denied|verification failed|timed out|refused$|closed by|not responding|reset by|resolve|kex_|banner/m, 'ssh\'s own text is never printed');
      assert.doesNotMatch(refused.output, /no valid result|backup could not be started/);
      if (/lost/.test(message.source)) assert.doesNotMatch(refused.output, /DEPLOY_|secret/, 'a lost connection points at no setting');
    }
    // A mistyped account in production-status is refused like a missing key, and the message names DEPLOY_USER.
    const account = { ...statusKey, STUB_ACCOUNT: 'deployer' };
    assert.equal(run('scheduled-status', account).status, 0);
    for (const [action, env, message] of [
      ['scheduled-status', account, /then run this check again\. If install already reports already-present, the DEPLOY_USER secret in production-status must name the same account as in production: enter it again under Settings > Environments > production-status > Environment secrets\./],
      ['status', { STUB_ACCOUNT: 'deployer' }, /the authorized_keys of the account that the DEPLOY_USER secret names/],
    ]) {
      const refused = run(action, { ...env, DEPLOY_USER: 'deployr' });
      assert.equal(refused.status, 1, action);
      assert.match(refused.output, message, action);
      assert.doesNotMatch(refused.output, /deployr|Permission denied/);
    }
    // A failing status is still reported as such: only ssh's own exit, with no result, is a connection failure.
    const unhealthy = run('scheduled-status', { ...statusKey, STUB_RESULT: JSON.stringify({ ...healthy, verified: false, status: 'failed', codes: ['timer-inactive-backup'] }), STUB_EXIT: '1' });
    assert.equal(unhealthy.status, 1);
    assert.match(unhealthy.output, /timer-inactive-backup/);
    assert.match(unhealthy.output, /production operations status is failing/);

    // Before the approval, without any credential: what install would do, also as the job's output.
    for (const [variable, shown, output] of [
      [`${pair.status.public} bangla-adventures-status\n`, `status key: ${pair.status.fingerprint} requested.`, pair.status.fingerprint],
      ['remove', 'status key: removal requested.', 'remove'], ['', 'status key: not requested', 'unchanged'],
    ]) {
      const file = path.join(folder, 'github-output');
      rmSync(file, { force: true });
      const shownRun = run('status-key-request', { STATUS_SSH_PUBLIC_KEY: variable, GITHUB_OUTPUT: file, DEPLOY_HOST: '', DEPLOY_USER: '', DEPLOY_SSH_KEY: '', DEPLOY_KNOWN_HOSTS: '' });
      assert.equal(shownRun.status, 0, shownRun.output);
      assert.ok(shownRun.output.includes(shown), shownRun.output);
      assert.equal(readFileSync(file, 'utf8'), `status_key=${output}\n`);
      assert.equal(shownRun.calls.length, 0, 'nothing connects before the approval');
    }
    assert.match(run('status-key-request', { STATUS_SSH_PUBLIC_KEY: pair.deploy.public }).output, /must not be the deploy key/);
    // install does only what was shown: a missing or different request is refused before any connection.
    for (const [env, message] of [
      [{ APPROVED_STATUS_KEY: '' }, /the status key request shown before the approval is missing/],
      [{ APPROVED_STATUS_KEY: 'anything' }, /the status key request shown before the approval is missing/],
      [{ APPROVED_STATUS_KEY: 'unchanged', STATUS_SSH_PUBLIC_KEY: pair.status.public }, /STATUS_SSH_PUBLIC_KEY now asks for something other than what was shown before the approval \(status key: unchanged\)/],
      [{ APPROVED_STATUS_KEY: pair.other.fingerprint, STATUS_SSH_PUBLIC_KEY: pair.status.public }, /keep it as a repository variable only/],
      [{ APPROVED_STATUS_KEY: 'remove' }, /something other than what was shown/],
    ]) {
      const refused = run('install', env);
      assert.equal(refused.status, 1, JSON.stringify(env));
      assert.match(refused.output, message);
      assert.equal(refused.calls.length, 0);
    }

    // install sends the public halves only, and only when STATUS_SSH_PUBLIC_KEY asks for a change.
    const passed = (statusKeyOutcome) => JSON.stringify({ scope: 'production-operations', action: 'install', verified: true, status: 'passed', codes: [],
      timers: { backup: true, monitor: true, offsite: true }, initialRuns: { backup: {}, monitor: {} }, statusKey: statusKeyOutcome });
    const request = () => {
      const tar = readFileSync(base.STUB_TAR);
      assert.doesNotMatch(tar.toString('latin1'), /PRIVATE KEY|BEGIN OPENSSH/, 'no private key is ever uploaded');
      return JSON.parse(spawnSync('tar', ['-xOf', base.STUB_TAR, 'status-key.json'], { encoding: 'utf8' }).stdout);
    };
    for (const [variable, sent, outcome] of [
      [`${pair.status.public} bangla-adventures-status\n`, `ssh-ed25519 ${pair.status.blob}`, 'installed'],
      [`  ${pair.status.public} someone@WORK-PC.local `, `ssh-ed25519 ${pair.status.blob}`, 'already-present'],
      ['remove', 'remove', 'removed'], [undefined, null, 'unchanged'], ['', null, 'unchanged'],
    ]) {
      const approved = sent === null ? 'unchanged' : sent === 'remove' ? 'remove' : pair.status.fingerprint;
      const installed = run('install', { STUB_RESULT: passed(outcome), APPROVED_STATUS_KEY: approved, ...(variable === undefined ? {} : { STATUS_SSH_PUBLIC_KEY: variable }) });
      assert.equal(installed.status, 0, installed.output);
      assert.deepEqual(request(), { deployKey: `ssh-ed25519 ${pair.deploy.blob}`, statusKey: sent });
      assert.match(installed.output, new RegExp(`status key: ${outcome}`));
      if (sent === null) assert.match(installed.output, /not requested/);
      if (typeof sent === 'string' && sent.startsWith('ssh-')) assert.ok(installed.output.includes(`status key: ${pair.status.fingerprint} requested`));
    }
    const corrupt = `ssh-ed25519 AAAAD3${pair.status.blob.slice(6)}`;
    for (const [variable, message] of [
      [`${pair.status.public}\n${pair.other.public}`, /must be a single line/], [`restrict ${pair.status.public}`, /without options/],
      [`command="bash" ${pair.status.public}`, /without options/], [pair.ecdsa, /one ssh-ed25519 public key line/],
      [`${pair.status.public} two words`, /a comment may use only letters/], [`${pair.status.public} x;id`, /a comment may use only letters/],
      [`${pair.status.public.slice(0, -1)}`, /one ssh-ed25519 public key line/], [corrupt, /not a valid SSH public key/],
      [pair.deploy.public, /must not be the deploy key/],
    ]) {
      const refused = run('install', { STATUS_SSH_PUBLIC_KEY: variable });
      assert.equal(refused.status, 1, variable);
      assert.match(refused.output, message, variable);
      assert.equal(refused.calls.length, 0, 'an invalid status key is refused before any connection');
    }
    assert.match(run('install', { STUB_RESULT: passed('something-else') }).output, /status key: unknown/);

    // A failed installation claims restoration only when the installer reports it.
    for (const [rollback, message] of [['complete', /previous jobs and files were restored/], ['none', /before anything on the server was changed/],
      ['incomplete', /deployment held the lock/], ['failed', /rollback did not finish/], [undefined, /no usable result/]]) {
      const result = { scope: 'production-operations', action: 'install', verified: false, status: 'failed', codes: ['initial-backup-deferred'], rollback, statusKey: 'unchanged' };
      const failed = run('install', { STUB_RESULT: rollback === undefined ? 'not json' : JSON.stringify(result), STUB_EXIT: '1' });
      assert.equal(failed.status, 1, failed.output);
      assert.match(failed.output, message, String(rollback));
      if (rollback !== 'complete') assert.doesNotMatch(failed.output, /were restored/);
      assert.doesNotMatch(failed.output, /stayed:|stayed in place|status key line stayed/);
    }
    // A revocation is never rolled back, and a failed install says so.
    for (const [statusKeyLeft, rollback, message] of [
      ['removed', 'complete', /previous jobs and files were restored\. The status key removal stayed: the earlier status key no longer works\./],
      ['replaced', 'complete', /The new status key stayed in place of the earlier one, which no longer works\./],
      ['installed', 'incomplete', /the new files stayed\. The new status key line stayed too\. Run install again/],
    ]) {
      const result = { scope: 'production-operations', action: 'install', verified: false, status: 'failed', codes: ['initial-backup-deferred'], rollback, statusKey: statusKeyLeft };
      const failed = run('install', { STUB_RESULT: JSON.stringify(result), STUB_EXIT: '1' });
      assert.equal(failed.status, 1, failed.output);
      assert.match(failed.output, new RegExp(`status key: ${statusKeyLeft}`));
      assert.match(failed.output, message);
    }

    const installed = run('install', { STUB_RESULT: JSON.stringify({ scope: 'production-operations', action: 'install', verified: true, status: 'passed', codes: [],
      timers: { backup: true, monitor: true, offsite: true }, initialRuns: { backup: {}, monitor: {} } }) });
    assert.equal(installed.status, 0, installed.output);
    const listing = spawnSync('tar', ['-tf', base.STUB_TAR], { encoding: 'utf8' }).stdout.trim().split('\n').sort();
    assert.deepEqual(listing, ['ba-production-backup.service', 'ba-production-backup.timer', 'ba-production-monitor.service', 'ba-production-monitor.timer',
      'ba-production-offsite.service', 'ba-production-offsite.timer', 'production-ops-install.py', 'production-ops-install.sh', 'production-ops.py', 'production-ops.sh',
      'status-key.json']);
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

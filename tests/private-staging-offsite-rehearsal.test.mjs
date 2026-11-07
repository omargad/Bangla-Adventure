import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import yaml from 'js-yaml';

const root = new URL('../', import.meta.url).pathname;
const read = (name) => readFileSync(path.join(root, name), 'utf8');
const gate = "github.repository_id == (vars.PRODUCTION_REPOSITORY_ID || '1436643374')";

test('the off-site rehearsal refuses without confirmation, cleans up on every path and prints a fixed summary', () => {
  const result = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'private_staging_offsite_rehearsal_test.py', '-v'],
    { cwd: root, encoding: 'utf8', timeout: 120_000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('the rehearsal workflow is manual, confirmed and behind the private staging gates', () => {
  const document = yaml.load(read('.github/workflows/vps-offsite-rehearsal.yml'));
  const staging = yaml.load(read('.github/workflows/vps-private-staging.yml'));
  assert.deepEqual(Object.keys(document.on), ['workflow_dispatch']);
  const inputs = document.on.workflow_dispatch.inputs;
  assert.deepEqual(Object.keys(inputs), ['confirm_offsite_rehearsal']);
  assert.equal(inputs.confirm_offsite_rehearsal.type, 'boolean');
  assert.equal(inputs.confirm_offsite_rehearsal.default, false);
  assert.deepEqual(document.permissions, { contents: 'read' });
  // Never alongside a staging start or an acceptance run, which use the same lock and folder.
  assert.deepEqual(document.concurrency, staging.concurrency);
  const { validate, 'repository-settings': settings, rehearsal } = document.jobs;
  for (const job of [validate, settings, rehearsal]) {
    assert.ok(job.if.includes(gate));
    assert.ok(job.if.includes("github.ref == 'refs/heads/main'"));
    assert.ok(job.if.includes('inputs.confirm_offsite_rehearsal == true'));
  }
  const acceptance = yaml.load(read('.github/workflows/vps-acceptance.yml'));
  assert.deepEqual(settings.steps, acceptance.jobs['repository-settings'].steps, 'the same DEPLOY_ENABLED gate as private acceptance');
  assert.equal(settings.environment, undefined);
  assert.equal(validate.environment, undefined, 'validate runs before any credential');
  assert.doesNotMatch(JSON.stringify(validate), /secrets\./);
  assert.match(validate.steps.at(-1).run, /private_staging_offsite_rehearsal_test\.py/);
  assert.deepEqual(rehearsal.needs, ['repository-settings', 'validate']);
  assert.ok(rehearsal.if.includes("needs.repository-settings.result == 'success'") && rehearsal.if.includes("needs.validate.result == 'success'"));
  assert.equal(rehearsal.environment, 'production');
  const step = rehearsal.steps.find((item) => item.env?.DEPLOY_HOST);
  assert.equal(step.run, 'bash scripts/private-staging-offsite-rehearsal.sh');
  assert.equal(step.env.CONFIRM_OFFSITE_REHEARSAL, '${{ inputs.confirm_offsite_rehearsal }}');
  assert.equal(step.env.REPOSITORY_GATE_CONFIRMED, 'disabled');
  assert.equal(step.env.DEPLOY_KNOWN_HOSTS, "${{ secrets.DEPLOY_HOST != '' && vars.DEPLOY_KNOWN_HOSTS || '' }}");
  assert.deepEqual(Object.keys(step.env).filter((name) => /secrets\./.test(step.env[name])).sort(),
    ['DEPLOY_HOST', 'DEPLOY_KNOWN_HOSTS', 'DEPLOY_SSH_KEY', 'DEPLOY_USER'], 'no client or registry credential is needed');
  for (const name of ['.github/workflows/vps-offsite-rehearsal.yml', 'scripts/private-staging-offsite-rehearsal.sh', 'scripts/private-staging-offsite-rehearsal.py']) {
    const text = read(name);
    assert.deepEqual((text.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) || []).filter((value) => value !== '127.0.0.1'), [], `${name} holds no address`);
    assert.doesNotMatch(text, /PRODUCTION_OPS_|\[private-staging-start\]|\[vps-acceptance-run\]/, name);
  }
});

test('the rehearsal and its documentation stay linked', () => {
  const operations = read('docs/PRODUCTION_OPERATIONS.md');
  assert.match(operations, /^## Off-site rehearsal$/m);
  assert.match(operations, /VPS off-site rehearsal/);
  assert.match(operations, /\]\(BACKUP_DESTINATIONS\.md\)/);
  assert.match(read('docs/DELIVERABLES.md'), /\]\(BACKUP_DESTINATIONS\.md\)/);
  const guide = read('docs/BACKUP_DESTINATIONS.md');
  // The guide names only destinations the off-site job accepts, and the retention it previews.
  for (const backend of ['s3:', 'b2:', 'rest:https://', 'azure:', 'gs:']) assert.ok(guide.includes(backend), backend);
  assert.match(guide, /14\s+daily,\s+8\s+weekly\s+and\s+6\s+monthly/);
  assert.doesNotMatch(guide, /\b\d{1,3}(?:\.\d{1,3}){3}\b/, 'no server address');
  const source = read('scripts/production-ops.py');
  assert.match(source, /require\(backend in \("s3", "b2", "rest", "azure", "gs"\)/);
});

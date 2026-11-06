import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import yaml from 'js-yaml';

// The repository moves to the client's GitHub organisation (docs/REPOSITORY_TRANSFER.md). These checks
// keep the workflows, scripts and image names working under whichever account owns the repository.
const root = new URL('../', import.meta.url).pathname;
const read = (name) => readFileSync(path.join(root, name), 'utf8');
const id = '1436643374';
const gate = `github.repository_id == (vars.PRODUCTION_REPOSITORY_ID || '${id}')`;
const elsewhere = `github.repository_id != (vars.PRODUCTION_REPOSITORY_ID || '${id}')`;
const digest = 'sha256:5f9ac5508771eb97c6b1e4aa4bff8db0fe69569b1f00b08a2e0e02e263d93f13';
const revision = 'a709cb3d2bc9fb0a271e6814bc96d1f16444c94f';
const serverWorkflows = readdirSync(path.join(root, '.github/workflows')).filter((name) => name.startsWith('vps-')).sort();

test('every server workflow is gated on the repository ID, never on an owner name', () => {
  assert.deepEqual(serverWorkflows, ['vps-acceptance.yml', 'vps-image-preflight.yml', 'vps-private-staging.yml',
    'vps-production-ops.yml', 'vps-production-status.yml', 'vps-ssh-preflight.yml']);
  for (const name of readdirSync(path.join(root, '.github/workflows'))) {
    const text = read(`.github/workflows/${name}`);
    assert.doesNotMatch(text, /github\.repository(_owner)? *[!=]=|omargad\/Bangla-Adventure|GITHUB_REPOSITORY:-/, name);
  }
  for (const name of serverWorkflows) {
    const { jobs } = yaml.load(read(`.github/workflows/${name}`));
    const gated = (job) => Boolean(job.if?.includes(gate)) || (Array.isArray(job.needs) || typeof job.needs === 'string') &&
      [job.needs].flat().every((need) => gated(jobs[need]) && (!job.if || job.if.includes(`needs.${need}.result == 'success'`)));
    for (const [jobName, job] of Object.entries(jobs)) {
      if (jobName === 'other-repository') continue;
      assert.ok(gated(job), `${name}: ${jobName} must run only in the production repository`);
      assert.doesNotMatch(job.if ?? '', /github\.repository(_owner)? *[!=]=|omargad/, `${name}: ${jobName}`);
    }
    // A requested run anywhere else is explained, never silently skipped, and loads nothing.
    const other = jobs['other-repository'];
    assert.ok(other, name);
    assert.ok(other.if.includes(elsewhere), name);
    assert.ok(Object.values(jobs).some((job) => job.if === other.if.replace(elsewhere, gate)),
      `${name}: other-repository must cover exactly the requests the server jobs answer`);
    assert.deepEqual(other.permissions, {}, name);
    assert.equal(other.environment, undefined, name);
    assert.doesNotMatch(JSON.stringify(other), /secrets\.|actions\/checkout/, name);
    const [step] = other.steps;
    assert.equal(step.env.FORK, '${{ github.event.repository.fork }}', name);
    assert.equal(step.env.PRODUCTION_ID, `\${{ vars.PRODUCTION_REPOSITORY_ID || '${id}' }}`, name);
  }
});

test('the other-repository explanation passes with a notice in a fork and fails with the fix elsewhere', () => {
  const { jobs } = yaml.load(read('.github/workflows/vps-ssh-preflight.yml'));
  const step = jobs['other-repository'].steps[0];
  for (const name of serverWorkflows) {
    assert.deepEqual(yaml.load(read(`.github/workflows/${name}`)).jobs['other-repository'].steps, [step], `${name} uses the same explanation`);
  }
  const run = (env) => spawnSync('bash', ['-e', '-c', step.run], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
  const fork = run({ FORK: 'true', REPOSITORY_ID: '99', PRODUCTION_ID: id });
  assert.equal(fork.status, 0);
  assert.match(fork.stdout, /^::notice title=Server jobs skipped in a fork::/);
  for (const FORK of ['false', '']) {
    const copy = run({ FORK, REPOSITORY_ID: '99', PRODUCTION_ID: id });
    assert.equal(copy.status, 1);
    assert.match(copy.stdout, /^::error title=Not the production repository::/);
    assert.match(copy.stdout, new RegExp(`has ID 99; the server jobs run only in the repository with ID ${id}\\.`));
    assert.match(copy.stdout, /set the repository variable PRODUCTION_REPOSITORY_ID to 99 \(docs\/REPOSITORY_TRANSFER\.md\)/);
  }
});

test('the scripts recognise the same repository ID, and one variable can name a re-created repository', () => {
  const sources = ['scripts/private-staging.sh', 'scripts/private-staging-acceptance.sh', 'scripts/production-ops-controller.sh',
    ...serverWorkflows.map((name) => `.github/workflows/${name}`)];
  for (const source of sources) {
    const text = read(source);
    const ids = [...text.matchAll(/PRODUCTION_REPOSITORY_ID(?: \|\| '|:-)(\d+)/g)].map((match) => match[1]);
    assert.ok(ids.length > 0, source);
    assert.deepEqual([...new Set(ids)], [id], source);
    assert.doesNotMatch(text, /GITHUB_REPOSITORY:-|omargad\/Bangla-Adventure/, source);
  }
  for (const source of ['scripts/private-staging.sh', 'scripts/private-staging-acceptance.sh', 'scripts/production-ops-controller.sh']) {
    const line = read(source).split('\n').find((text) => text.includes('PRODUCTION_REPOSITORY_ID:-'));
    const check = (env) => spawnSync('bash', ['-c', `${line.replace(/\|\| *\\?$/, '').replace(/ \|\| fail .*$/, '')} && echo allowed`],
      { encoding: 'utf8', env: { PATH: process.env.PATH, GITHUB_REF: 'refs/heads/main', ...env } }).stdout.trim();
    assert.equal(check({ GITHUB_REPOSITORY_ID: id, GITHUB_REPOSITORY: 'client-org/Bangla-Adventure' }), 'allowed', source);
    assert.equal(check({ GITHUB_REPOSITORY_ID: id, PRODUCTION_REPOSITORY_ID: '' }), 'allowed', source);
    assert.equal(check({ GITHUB_REPOSITORY_ID: '42', PRODUCTION_REPOSITORY_ID: '42' }), 'allowed', source);
    assert.equal(check({ GITHUB_REPOSITORY_ID: '42' }), '', source);
    assert.equal(check({ GITHUB_REPOSITORY_ID: '' }), '', source);
    assert.equal(check({ GITHUB_REPOSITORY_ID: id, GITHUB_REF: 'refs/heads/other' }), '', source);
  }
});

test('CI publishes to the lowercase repository owner\'s bangla-adventure package', () => {
  const { jobs } = yaml.load(read('.github/workflows/ci.yml'));
  const name = jobs.container.steps.find((step) => step.id === 'name');
  const directory = mkdtempSync(path.join(tmpdir(), 'bangla-image-name-'));
  try {
    for (const [owner, expected] of [['omargad', 'ghcr.io/omargad/bangla-adventure'], ['Client-Org', 'ghcr.io/client-org/bangla-adventure']]) {
      const output = path.join(directory, owner);
      const result = spawnSync('bash', ['-c', name.run], { encoding: 'utf8',
        env: { PATH: process.env.PATH, GITHUB_OUTPUT: output, GITHUB_REPOSITORY_OWNER: owner, GITHUB_REPOSITORY: `${owner}/Bangla-Adventure` } });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(output, 'utf8'), `image=${expected}\n`);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('image preflight accepts only a digest in the current owner\'s package', () => {
  const { jobs } = yaml.load(read('.github/workflows/vps-image-preflight.yml'));
  const runner = jobs['image-preflight'].steps.find((step) => step.run?.includes('readonly package=')).run.split('\n');
  const start = runner.findIndex((line) => line.startsWith('readonly package='));
  const check = (owner, ref) => spawnSync('bash', ['-c', ["fail() { echo \"$*\"; exit 1; }", runner[start], runner[start + 1], 'echo accepted'].join('\n')],
    { encoding: 'utf8', env: { PATH: process.env.PATH, GITHUB_REPOSITORY_OWNER: owner, PREFLIGHT_IMAGE_REF: ref } }).stdout.trim();
  const sha = `sha256:${'a'.repeat(64)}`;
  assert.equal(check('omargad', `ghcr.io/omargad/bangla-adventure@${sha}`), 'accepted');
  assert.equal(check('Client-Org', `ghcr.io/client-org/bangla-adventure@${sha}`), 'accepted');
  for (const [owner, ref] of [['Client-Org', `ghcr.io/omargad/bangla-adventure@${sha}`], ['omargad', `ghcr.io/omargad/bangla-adventure:latest`],
    ['omargad', `ghcr.io/omargad/other@${sha}`], ['omargad', `ghcr.io/omargad/bangla-adventure@sha256:${'A'.repeat(64)}`]]) {
    assert.match(check(owner, ref), /image_ref must be an immutable digest in this repository's GHCR package/, ref);
  }
});

test('private staging keeps one digest and revision; only the registry path is configurable', () => {
  const defaults = { 'scripts/private-staging.sh': '${STAGING_IMAGE_REPOSITORY:-ghcr.io/omargad/bangla-adventure}',
    'scripts/private-staging-acceptance.sh': '${STAGING_IMAGE_REPOSITORY:-ghcr.io/omargad/bangla-adventure}',
    '.github/workflows/vps-private-staging.yml': "${{ vars.STAGING_IMAGE_REPOSITORY || 'ghcr.io/omargad/bangla-adventure' }}@" + digest };
  for (const [source, text] of Object.entries(defaults)) assert.ok(read(source).includes(text), source);
  for (const source of ['scripts/private-staging.sh', 'scripts/private-staging-acceptance.sh', 'scripts/private-staging-ops.py',
    'scripts/private-staging-qa.sh', 'scripts/private-staging-remote.sh', 'scripts/private-staging-rollback.sh', '.github/workflows/vps-private-staging.yml']) {
    const text = read(source);
    assert.ok(text.includes(digest.slice('sha256:'.length)), source);
    if (source.startsWith('scripts/')) assert.ok(text.includes(revision), source);
    // No other fixed staging digest and no fixed owner other than the documented default.
    for (const match of text.matchAll(/bangla-adventure@sha256:([0-9a-f]{64})/g)) assert.equal(`sha256:${match[1]}`, digest, source);
    for (const match of text.matchAll(/ghcr\.io\/([a-z0-9-]+)\/bangla-adventure/g)) assert.equal(match[1], 'omargad', source);
  }
  for (const workflow of ['vps-private-staging.yml', 'vps-acceptance.yml']) {
    assert.ok(read(`.github/workflows/${workflow}`).includes('STAGING_IMAGE_REPOSITORY: ${{ vars.STAGING_IMAGE_REPOSITORY }}'), workflow);
  }
  const example = read('deploy/vps.github-variables.env.example');
  assert.match(example, /^# PRODUCTION_REPOSITORY_ID=$/m);
  assert.match(example, /^# STAGING_IMAGE_REPOSITORY=$/m);
});

test('the transfer checklist exists, is linked and names every setting it relies on', () => {
  const guide = read('docs/REPOSITORY_TRANSFER.md');
  for (const text of [id, 'PRODUCTION_REPOSITORY_ID', 'STAGING_IMAGE_REPOSITORY', 'production-status', 'STATUS_SSH_KEY',
    'DEPLOY_SSH_KEY', 'DEPLOY_HOST', 'DEPLOY_USER', 'DEPLOY_KNOWN_HOSTS', 'DEPLOY_ENABLED', 'ELEVENLABS_API_KEY',
    `crane copy ghcr.io/omargad/bangla-adventure@${digest}`, `skopeo copy --preserve-digests`, revision,
    'git remote set-url origin', 'Railway', 'Vercel', 'CODEOWNERS']) {
    assert.ok(guide.includes(text), text);
  }
  assert.doesNotMatch(guide, /\b\d{1,3}(\.\d{1,3}){3}\b/, 'no server address');
  for (const doc of ['docs/DELIVERABLES.md', 'docs/VPS_DEPLOYMENT.md', 'docs/HANDOVER.md']) {
    assert.match(read(doc), /\]\((?:\.\/)?REPOSITORY_TRANSFER\.md(?:#[a-z0-9-]+)?\)/, doc);
  }
});

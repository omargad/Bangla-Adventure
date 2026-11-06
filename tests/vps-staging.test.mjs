import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const hostPin = `SHA256:${"A".repeat(43)}`;
const keyPin = `SHA256:${"B".repeat(43)}`;
const liveCompose = "unchanged live compose\n";
const liveScript = "unchanged live deployment script\n";
// A fixture value only; never a provider credential.
const narrationKey = "FIXTURE_NARRATION_KEY_NOT_REAL_0001";

// No command is forwarded to SSH, Docker or a shell. The stub recognizes only
// frontend staging operations and applies them inside the isolated fixture.
const sshStub = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2), env = process.env;
const command = args.at(-1), folder = env.MOCK_REMOTE;
const reject = message => { process.stderr.write(message + '\n'); process.exit(97); };
const record = entry => fs.appendFileSync(env.MOCK_LOG, JSON.stringify({ attempt: env.MOCK_ATTEMPT, ...entry }) + '\n');
const stagePath = value => path.dirname(value) === folder && /^\.deploy-stage\.[A-Za-z0-9]+$/.test(path.basename(value));
const live = () => ({ liveCompose: fs.readFileSync(path.join(folder, 'compose.yaml'), 'utf8'), liveScript: fs.readFileSync(path.join(folder, 'deploy-remote.sh'), 'utf8') });
if (args.at(-2) !== 'fixture-deploy@demo.example.invalid') reject('Unexpected fixture destination');
let match;
if ((match = /^umask 077; mkdir -p (\S+) && mktemp -d (\S+)$/.exec(command))) {
  if (match[1] !== folder || match[2] !== folder + '/.deploy-stage.XXXXXXXXXX') reject('Unexpected staging root');
  if (env.MOCK_INVALID_STAGE) { record({ operation: 'invalid-stage' }); process.stdout.write(folder + '\n'); process.exit(0); }
  const stage = fs.mkdtempSync(path.join(folder, '.deploy-stage.'));
  record({ operation: 'create', stage, ...live() });
  process.stdout.write(stage + '\n'); process.exit(0);
}
if ((match = /^cat > (\S+) && mv -f (\S+) (\S+)$/.exec(command))) {
  const [, temporary, from, destination] = match, stage = path.dirname(destination), name = path.basename(destination);
  if (!stagePath(stage) || !['compose.yaml', 'deploy-remote.sh'].includes(name) || temporary !== destination + '.new' || from !== temporary) reject('Unexpected upload path');
  const content = fs.readFileSync(0);
  fs.writeFileSync(temporary, content);
  if (env.MOCK_FAIL_UPLOAD === name) { record({ operation: 'failed-upload', stage, name, ...live() }); process.exit(23); }
  fs.renameSync(temporary, destination);
  record({ operation: 'upload', stage, name, ...live() }); process.exit(0);
}
if ((match = /^rm -rf -- (\S+)$/.exec(command))) {
  if (!stagePath(match[1])) reject('Cleanup outside a unique stage');
  fs.rmSync(match[1], { recursive: true, force: true });
  record({ operation: 'cleanup', stage: match[1], ...live() }); process.exit(0);
}
if ((match = /^bash (\S+) (\S+) /.exec(command))) {
  const script = match[1], stage = path.dirname(script), lines = / ([0-4])$/.exec(command)?.[1];
  if (!stagePath(stage) || path.basename(script) !== 'deploy-remote.sh' || !lines || !command.endsWith(' ' + folder + ' ' + stage + ' ' + lines)) reject('Unexpected staged invocation');
  // Consume the synthetic settings and password; only the file names and line count are recorded.
  const input = fs.readFileSync(0, 'utf8');
  if (env.MOCK_INPUT) fs.writeFileSync(env.MOCK_INPUT, input);
  const files = fs.readdirSync(stage).sort();
  if (env.MOCK_FAIL_DISPATCH) { record({ operation: 'failed-dispatch', stage, files, ...live() }); process.exit(255); }
  record({ operation: 'dispatch', stage, command, lines: Number(lines), files, image: match[2], compose: fs.readFileSync(path.join(stage, 'compose.yaml'), 'utf8'), script: fs.readFileSync(script, 'utf8'), ...live() });
  if (!env.MOCK_BARRIER) process.exit(0);
  fs.writeFileSync(path.join(env.MOCK_BARRIER, env.MOCK_ATTEMPT), stage);
  const deadline = Date.now() + 5000;
  const interval = setInterval(() => {
    if (fs.readdirSync(env.MOCK_BARRIER).length === 2) { clearInterval(interval); process.exit(0); }
    if (Date.now() > deadline) { clearInterval(interval); reject('Concurrent attempt did not reach the handler'); }
  }, 20);
} else reject('Unexpected fixture SSH command');
`;

const keygenStub = String.raw`
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('-y')) { process.stdout.write('ssh-ed25519 FIXTURE_PUBLIC_KEY\n'); process.exit(0); }
const file = args[args.indexOf('-f') + 1];
if (args.includes('-F')) process.exit(fs.readFileSync(file, 'utf8').includes('demo.example.invalid') ? 0 : 1);
if (args.includes('-l')) {
  const key = fs.readFileSync(file, 'utf8');
  process.stdout.write('256 ' + (key.includes('FIXTURE_PUBLIC_KEY') ? process.env.MOCK_KEY_PIN : process.env.MOCK_HOST_PIN) + ' fixture (ED25519)\n');
  process.exit(0);
}
process.stderr.write('Unexpected fixture keygen invocation\n'); process.exit(97);
`;

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "bangla-vps-staging-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const remote = path.join(root, "remote"), bin = path.join(root, "bin"), temporary = path.join(root, "temporary");
  for (const folder of [remote, bin, temporary]) mkdirSync(folder);
  writeFileSync(path.join(remote, "compose.yaml"), liveCompose);
  writeFileSync(path.join(remote, "deploy-remote.sh"), liveScript);
  const otherStage = path.join(remote, ".deploy-stage.OtherAttempt");
  mkdirSync(otherStage);
  writeFileSync(path.join(otherStage, "keep.txt"), "another deployment owns this stage");
  for (const [command, code] of [["ssh", sshStub], ["ssh-keygen", keygenStub]]) writeFileSync(path.join(bin, command), `#!${process.execPath}\n${code}`, { mode: 0o755 });
  const log = path.join(root, "commands.jsonl");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(DEPLOY_|REGISTRY_|DOCKER_|MOCK_|ELEVENLABS_|PUBLIC_HEALTH_URL$)/.test(key)));
  Object.assign(env, {
    PATH: `${bin}:${process.env.PATH}`, TMPDIR: temporary, NODE_NO_WARNINGS: "1", MOCK_REMOTE: remote, MOCK_LOG: log,
    MOCK_HOST_PIN: hostPin, MOCK_KEY_PIN: keyPin,
    DEPLOY_ENABLED: "true", DEPLOY_HOST: "demo.example.invalid", DEPLOY_USER: "fixture-deploy", DEPLOY_PATH: remote,
    DEPLOY_HOST_FINGERPRINT: hostPin, DEPLOY_KEY_FINGERPRINT: keyPin,
    DEPLOY_SSH_KEY: "FIXTURE_PRIVATE_KEY_NOT_A_REAL_CREDENTIAL", DEPLOY_KNOWN_HOSTS: "demo.example.invalid ssh-ed25519 FIXTURE_HOST_KEY",
    DEPLOY_DOCKER_HOST: "unix:///run/user/1002/docker.sock", DEPLOY_REQUIRE_ROOTLESS: "true",
    DEPLOY_REQUIRE_PUBLIC_HEALTH: "true", PUBLIC_HEALTH_URL: "https://demo.example.invalid/api/health",
    REGISTRY_USER: "fixture-user", REGISTRY_PASSWORD: "FIXTURE_REGISTRY_PASSWORD",
  });
  async function run(attempt, changes = {}) {
    const checkout = path.join(root, `checkout-${attempt}`);
    mkdirSync(path.join(checkout, "scripts"), { recursive: true });
    copyFileSync(new URL("../scripts/deploy.sh", import.meta.url), path.join(checkout, "scripts", "deploy.sh"));
    writeFileSync(path.join(checkout, "compose.yaml"), `candidate compose ${attempt}\n`);
    writeFileSync(path.join(checkout, "scripts", "deploy-remote.sh"), `candidate handler ${attempt}\n`);
    const child = spawn("bash", ["scripts/deploy.sh", `ghcr.io/example/bangla:sha-${attempt}`], { cwd: checkout, env: { ...env, MOCK_ATTEMPT: attempt, ...changes }, timeout: 15_000 });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    return new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (status, signal) => resolve({ status, signal, stdout, stderr }));
    });
  }
  const calls = () => existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];
  function assertLiveUnchanged() {
    assert.equal(readFileSync(path.join(remote, "compose.yaml"), "utf8"), liveCompose);
    assert.equal(readFileSync(path.join(remote, "deploy-remote.sh"), "utf8"), liveScript);
    assert.equal(readFileSync(path.join(otherStage, "keep.txt"), "utf8"), "another deployment owns this stage");
    assert.deepEqual(readdirSync(temporary), [], "private local key copies are cleaned");
    for (const call of calls().filter((entry) => entry.liveCompose !== undefined)) {
      assert.equal(call.liveCompose, liveCompose, `${call.operation}: live compose unchanged before handler`);
      assert.equal(call.liveScript, liveScript, `${call.operation}: live script unchanged before handler`);
    }
  }
  return { root, remote, run, calls, assertLiveUnchanged };
}

test("frontend uploads only into its stage and dispatches the staged handler with both ownership paths", async (t) => {
  const f = fixture(t), result = await f.run("one");
  assert.equal(result.status, 0, result.stderr);
  const calls = f.calls(), dispatch = calls.find((call) => call.operation === "dispatch");
  assert.deepEqual(calls.map((call) => call.operation), ["create", "upload", "upload", "dispatch"]);
  assert.equal(dispatch.compose, "candidate compose one\n");
  assert.equal(dispatch.script, "candidate handler one\n");
  assert.ok(dispatch.command.endsWith(` ${f.remote} ${dispatch.stage} 0`), "no narration lines precede the password");
  assert.ok(existsSync(dispatch.stage), "after dispatch the remote handler owns stage cleanup");
  assert.equal(`${result.stdout}${result.stderr}${JSON.stringify(calls)}`.includes("FIXTURE_PRIVATE_KEY_NOT_A_REAL_CREDENTIAL"), false);
  assert.equal(`${result.stdout}${result.stderr}${JSON.stringify(calls)}`.includes("FIXTURE_REGISTRY_PASSWORD"), false);
  f.assertLiveUnchanged();
});

test("narration settings travel ahead of the password on the dispatch's input, never in the stage or on a command line", async (t) => {
  const f = fixture(t), input = path.join(f.root, "dispatch-input");
  const result = await f.run("narration", { ELEVENLABS_API_KEY: narrationKey, ELEVENLABS_MODEL_ID: "eleven_v3", ELEVENLABS_VOICE_ID: "", MOCK_INPUT: input });
  assert.equal(result.status, 0, result.stderr);
  const calls = f.calls(), dispatch = calls.find((call) => call.operation === "dispatch");
  assert.deepEqual(calls.map((call) => call.operation), ["create", "upload", "upload", "dispatch"]);
  assert.deepEqual(dispatch.files, ["compose.yaml", "deploy-remote.sh"]);
  assert.equal(dispatch.lines, 2, "an empty setting is not sent");
  assert.equal(readFileSync(input, "utf8"), "ELEVENLABS_API_KEY=" + narrationKey + "\nELEVENLABS_MODEL_ID=eleven_v3\nFIXTURE_REGISTRY_PASSWORD");
  assert.equal(`${result.stdout}${result.stderr}${JSON.stringify(calls)}`.includes(narrationKey), false);
  f.assertLiveUnchanged();
});

test("a dispatch that fails before the handler starts leaves no narration settings on the server", async (t) => {
  const f = fixture(t), result = await f.run("dropped", { ELEVENLABS_API_KEY: narrationKey, MOCK_FAIL_DISPATCH: "1" });
  assert.equal(result.status, 255, result.stderr);
  const calls = f.calls(), dropped = calls.find((call) => call.operation === "failed-dispatch");
  assert.deepEqual(calls.map((call) => call.operation), ["create", "upload", "upload", "failed-dispatch"]);
  assert.deepEqual(dropped.files, ["compose.yaml", "deploy-remote.sh"], "the stage holds only release files");
  const remoteFiles = (folder) => readdirSync(folder, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? remoteFiles(path.join(folder, entry.name)) : [path.join(folder, entry.name)]);
  for (const file of remoteFiles(f.remote)) assert.equal(readFileSync(file, "utf8").includes(narrationKey), false, file);
  f.assertLiveUnchanged();
});

test("two concurrent frontend attempts keep distinct complete stages without replacing live files", async (t) => {
  const f = fixture(t), barrier = path.join(f.root, "barrier");
  mkdirSync(barrier);
  const results = await Promise.all([f.run("alpha", { MOCK_BARRIER: barrier }), f.run("beta", { MOCK_BARRIER: barrier })]);
  for (const result of results) assert.equal(result.status, 0, result.stderr);
  const dispatched = f.calls().filter((call) => call.operation === "dispatch");
  assert.equal(dispatched.length, 2);
  assert.equal(new Set(dispatched.map((call) => call.stage)).size, 2);
  for (const call of dispatched) {
    assert.equal(call.compose, `candidate compose ${call.attempt}\n`);
    assert.equal(call.script, `candidate handler ${call.attempt}\n`);
    assert.equal(path.dirname(call.stage), f.remote);
    assert.ok(existsSync(call.stage));
  }
  f.assertLiveUnchanged();
});

test("a partial upload failure cleans only that attempt's stage and never dispatches or touches another attempt", async (t) => {
  for (const name of ["compose.yaml", "deploy-remote.sh"]) {
    const f = fixture(t), result = await f.run("failed", { MOCK_FAIL_UPLOAD: name, ELEVENLABS_API_KEY: narrationKey });
    assert.equal(result.status, 23, result.stderr);
    const calls = f.calls(), created = calls.find((call) => call.operation === "create");
    assert.equal(calls.some((call) => call.operation === "dispatch"), false);
    assert.deepEqual(calls.filter((call) => call.operation === "cleanup").map((call) => call.stage), [created.stage]);
    assert.equal(existsSync(created.stage), false, "partial files are removed with their stage");
    f.assertLiveUnchanged();
  }
});

test("an invalid staging response never authorizes deleting the live directory", async (t) => {
  const f = fixture(t), result = await f.run("invalid", { MOCK_INVALID_STAGE: "1" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid staging directory/);
  assert.deepEqual(f.calls().map((call) => call.operation), ["invalid-stage"]);
  f.assertLiveUnchanged();
});

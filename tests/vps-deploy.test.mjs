import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const repository = new URL("../", import.meta.url);
const hostPin = `SHA256:${"A".repeat(43)}`;
const keyPin = `SHA256:${"B".repeat(43)}`;
const image = "ghcr.io/example/bangla:sha-new";
const previous = "ghcr.io/example/bangla:sha-previous";
const rootlessHost = "unix:///run/user/1007/docker.sock";
const head = "a".repeat(40);
const later = "b".repeat(40);

// These replacements never forward to the real command, including on an unknown invocation.
const stub = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const env = process.env;
const dotenv = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '';
const appImage = /^APP_IMAGE=(.*)$/m.exec(dotenv)?.[1] || '';
const entry = { command, args, dockerHost: env.DOCKER_HOST || '', dockerContext: env.DOCKER_CONTEXT || '', dockerConfig: env.DOCKER_CONFIG || '', appImage };
entry.compose = fs.existsSync('compose.yaml') ? fs.readFileSync('compose.yaml', 'utf8') : '';
entry.project = /^COMPOSE_PROJECT_NAME=(.*)$/m.exec(dotenv)?.[1] || '';
entry.narrationKey = /^ELEVENLABS_API_KEY=(.*)$/m.exec(dotenv)?.[1] || '';
if (command === 'docker' && env.DOCKER_CONFIG && fs.existsSync(path.join(env.DOCKER_CONFIG, 'config.json'))) {
  entry.hasPrivateRegistryConfig = true;
  entry.hasContextMetadata = fs.existsSync(path.join(env.DOCKER_CONFIG, 'contexts', 'fixture-context'));
  entry.hasComposePlugin = fs.existsSync(path.join(env.DOCKER_CONFIG, 'cli-plugins', 'fixture-compose'));
  entry.registryAuth = Object.values(JSON.parse(fs.readFileSync(path.join(env.DOCKER_CONFIG, 'config.json'), 'utf8')).auths)[0].auth;
}
fs.appendFileSync(env.MOCK_LOG, JSON.stringify(entry) + '\n');
const out = value => process.stdout.write(value + '\n');
const done = (code = 0) => process.exit(code);
if (command === 'ssh') {
  const input = fs.readFileSync(0);
  if (env.MOCK_SSH_INPUT && args.at(-1).startsWith('bash ')) fs.writeFileSync(env.MOCK_SSH_INPUT, input);
  if (!env.MOCK_SSH_EXIT || env.MOCK_SSH_EXIT === '0') {
    if (args.at(-1).includes('mktemp -d')) out('/opt/bangla-adventures/.deploy-stage.Fixture123');
  }
  done(Number(env.MOCK_SSH_EXIT || 0));
}
if (command === 'cp') {
  const [source, destination] = args.slice(-2);
  if ((env.MOCK_COPY_FAIL === 'snapshot' && destination.includes('/.deploy-transaction.')) ||
      (env.MOCK_COPY_FAIL === 'promotion' && destination === 'deploy-remote.sh.incoming') ||
      (env.MOCK_COPY_FAIL === 'settings' && destination === '.env.restore')) done(1);
  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, fs.statSync(source).mode);
  done();
}
if (command === 'ssh-keygen') {
  if (args.includes('-F')) {
    const lookup = args[args.indexOf('-F') + 1];
    const content = fs.readFileSync(args[args.indexOf('-f') + 1], 'utf8');
    if (content.includes(lookup)) { out(content); done(); }
    done(1);
  }
  if (args.includes('-y')) { out('ssh-ed25519 TEST_DEPLOY_PUBLIC_KEY'); done(); }
  if (args.includes('-lf') || args.includes('-l')) {
    const index = args.includes('-lf') ? args.indexOf('-lf') : args.indexOf('-f');
    const file = args[index + 1];
    const content = file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(file, 'utf8');
    const pin = content.includes('TEST_DEPLOY_PUBLIC_KEY') ? env.MOCK_KEY_PIN : content.includes('UNTRUSTED_HOST_KEY') ? 'SHA256:' + 'C'.repeat(43) : env.MOCK_HOST_PIN;
    out('256 ' + pin + ' fixture (ED25519)'); done();
  }
}
if (command === 'git') {
  if (args[0] === 'rev-parse') { if (env.MOCK_GIT_HEAD_FAIL) done(128); out(env.MOCK_GIT_HEAD); done(); }
  if (args[0] === 'ls-remote') {
    if (env.MOCK_GIT_REMOTE_FAIL) { process.stderr.write('fixture remote lookup failed\n'); done(128); }
    if (!env.MOCK_GIT_MISSING_BRANCH) {
      out(env.MOCK_GIT_TIP + '\trefs/heads/main');
      if (env.MOCK_GIT_AMBIGUOUS) out(env.MOCK_GIT_TIP + '\trefs/heads/main');
    }
    done();
  }
}
if (command === 'curl') {
  if (env.MOCK_PUBLIC_HEALTH_FAIL === appImage) done(22);
  out(env.MOCK_PUBLIC_HEALTH_STATUS && appImage === env.MOCK_CANDIDATE_IMAGE ? env.MOCK_PUBLIC_HEALTH_STATUS : '200'); done();
}
if (command === 'sleep') done();
if (command === 'publish-effect' || command === 'deploy-effect' || command === 'apk') done();
if (command === 'gcloud') { out('fictional-test-token'); done(); }
if (command === 'cat' && args.length === 1 && args[0] === '/registry/token') { out('fictional-test-token'); done(); }
if (command === 'id') { if (args[0] === '-u') out('1007'); else out('deploy-fixture'); done(); }
if (command === 'docker') {
  if (args[0] === 'info') { if (env.MOCK_DOCKER_INFO_FAIL) done(1); out(env.MOCK_DOCKER_ROOTLESS === 'false' ? '["name=seccomp"]' : '["name=seccomp","name=rootless"]'); done(); }
  if (args[0] === 'context' && args[1] === 'inspect') { out(env.MOCK_CONTEXT_HOST || 'unix:///run/user/1007/docker.sock'); done(); }
  if (args[0] === 'context' && args[1] === 'show') { out('unexpected-default-context'); done(); }
  if (args[0] === 'compose') {
    if (args.includes('config')) done(Number(env.MOCK_INVALID_COMPOSE || 0));
    if (args.includes('ps')) { if (!env.MOCK_NO_CONTAINER) out('existing-app-container'); done(); }
    if (args[1] === 'run') {
      if (args.includes('scripts/backup.sh')) done(Number(env.MOCK_BACKUP_FAIL || 0));
      if (env.MOCK_NO_DATABASE) out('none');
      done();
    }
    if (args[1] === 'version') { out('Docker Compose version v2.30.0'); done(); }
    if (args[1] === 'up' && args.includes('--help')) { out('--wait --wait-timeout'); done(); }
    if (args[1] === 'ps') { out('existing-app-container'); done(); }
    if (args[1] === 'up' || args[1] === 'exec' || args[1] === 'logs' || args[1] === 'stop' || args[1] === 'start') done();
  }
  if (args[0] === 'inspect') { out(env.MOCK_PREVIOUS_IMAGE); done(); }
  if (args[0] === 'run') done();
  if (args[0] === 'image' && args[1] === 'inspect') done();
  if (args[0] === 'image' && args[1] === 'ls') done();
  if (args[0] === 'image' && args[1] === 'rm') done();
  if (args[0] === 'pull') done(Number(env.MOCK_PULL_EXIT || 0));
}
process.stderr.write('Unexpected stub invocation: ' + command + ' ' + JSON.stringify(args) + '\n');
done(97);
`;

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "bangla-vps-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const folder of ["bin", "temporary", "docker-config/contexts", "docker-config/cli-plugins", "scripts/ci", "remote"]) mkdirSync(path.join(root, folder), { recursive: true });
  for (const script of ["deploy.sh", "deploy-remote.sh", "ci/newest.sh"]) copyFileSync(new URL(`scripts/${script}`, repository), path.join(root, "scripts", script));
  copyFileSync(new URL("scripts/deploy-remote.sh", repository), path.join(root, "remote", "deploy-remote.sh"));
  writeFileSync(path.join(root, "compose.yaml"), "services:\n  app:\n    image: fixture-only\n");
  writeFileSync(path.join(root, "remote", "compose.yaml"), "services:\n  app:\n    image: fixture-only\n");
  writeFileSync(path.join(root, "remote", ".env"), `PUBLIC_ORIGIN=https://demo.example.invalid\nAPP_IMAGE=${previous}\n`);
  writeFileSync(path.join(root, "docker-config", "keep.txt"), "existing operator configuration");
  writeFileSync(path.join(root, "docker-config", "contexts", "fixture-context"), "rootless context fixture");
  writeFileSync(path.join(root, "docker-config", "cli-plugins", "fixture-compose"), "Compose plugin fixture");
  for (const command of ["docker", "ssh", "ssh-keygen", "curl", "git", "id", "sleep", "cp"]) {
    writeFileSync(path.join(root, "bin", command), `#!${process.execPath}\nconst command = ${JSON.stringify(command)};\n${stub}`, { mode: 0o755 });
  }
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(DEPLOY_|REGISTRY_|DOCKER_|MOCK_|ELEVENLABS_|PUBLIC_HEALTH_URL$)/.test(key)));
  Object.assign(env, {
    PATH: `${path.join(root, "bin")}:${process.env.PATH}`, TMPDIR: path.join(root, "temporary"),
    DOCKER_CONFIG: path.join(root, "docker-config"), MOCK_LOG: path.join(root, "commands.jsonl"),
    MOCK_HOST_PIN: hostPin, MOCK_KEY_PIN: keyPin, MOCK_PREVIOUS_IMAGE: previous,
    MOCK_GIT_HEAD: head, MOCK_GIT_TIP: head, NODE_NO_WARNINGS: "1",
  });
  const run = (script, args = [], changes = {}, input = "") => {
    const result = spawnSync("bash", [path.join(root, script), ...args], { cwd: root, env: { ...env, ...changes }, encoding: "utf8", input, timeout: 20_000, maxBuffer: 1_000_000 });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.signal, null, result.stderr);
    return result;
  };
  const calls = () => existsSync(env.MOCK_LOG) ? readFileSync(env.MOCK_LOG, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  const frontEnv = {
    DEPLOY_ENABLED: "true", DEPLOY_HOST: "demo.example.invalid", DEPLOY_USER: "fixture-deploy", DEPLOY_PORT: "2222",
    DEPLOY_SSH_KEY: "-----BEGIN OPENSSH PRIVATE KEY-----\nTEST_FIXTURE_ONLY\n-----END OPENSSH PRIVATE KEY-----",
    DEPLOY_KNOWN_HOSTS: "[demo.example.invalid]:2222 ssh-ed25519 TEST_HOST_PUBLIC_KEY",
    DEPLOY_HOST_FINGERPRINT: hostPin, DEPLOY_KEY_FINGERPRINT: keyPin,
    DEPLOY_DOCKER_HOST: rootlessHost, DEPLOY_REQUIRE_ROOTLESS: "true", DEPLOY_REQUIRE_PUBLIC_HEALTH: "true",
  };
  const frontend = (changes = {}, args = [image]) => run("scripts/deploy.sh", args, { ...frontEnv, ...changes });
  // Narration lines come first on standard input, then the registry password; only their count is an argument.
  const remote = ({ host = rootlessHost, context = "", rootless = "true", health = "https://demo.example.invalid/api/health", requireHealth = "true", registryUser = "", backup = "0", stage = "", narration = "", lines = narration.split("\n").length - 1, env: changes = {} } = {}) => {
    const locations = stage || narration || lines ? [path.join(root, "remote"), stage] : [];
    return run(stage ? path.relative(root, path.join(stage, "deploy-remote.sh")) : "remote/deploy-remote.sh", [image, registryUser, backup, "1", host, context, rootless, health, requireHealth, ...locations, ...(narration || lines ? [String(lines)] : [])], changes, narration + (registryUser ? "fixture-registry-password" : ""));
  };
  const stage = (label = "candidate") => {
    const directory = mkdtempSync(path.join(root, "remote", ".deploy-stage."));
    copyFileSync(new URL("scripts/deploy-remote.sh", repository), path.join(directory, "deploy-remote.sh"));
    writeFileSync(path.join(directory, "compose.yaml"), `# ${label}\nservices:\n  app:\n    ports: ["127.0.0.1:3001:3000"]\n    volumes: ["bangla-data:/app/.data"]\nvolumes:\n  bangla-data:\n`);
    return directory;
  };
  return { root, env, frontEnv, calls, run, frontend, remote, stage, temporary: () => readdirSync(path.join(root, "temporary")), currentImage: () => /^APP_IMAGE=(.*)$/m.exec(readFileSync(path.join(root, "remote", ".env"), "utf8"))?.[1] };
}

const successful = result => assert.equal(result.status, 0, result.stderr + result.stdout);
const failed = result => assert.notEqual(result.status, 0, result.stderr + result.stdout);
const dockerCalls = f => f.calls().filter(call => call.command === "docker");

test("deployment is disabled unless explicitly enabled, before credentials or SSH are touched", t => {
  const f = fixture(t);
  for (const value of ["", "false", "1"]) successful(f.frontend({ DEPLOY_ENABLED: value, DEPLOY_HOST: "", DEPLOY_SSH_KEY: "", DEPLOY_KNOWN_HOSTS: "" }, []));
  assert.deepEqual(f.calls(), []);
  assert.deepEqual(f.temporary(), []);
});

test("pinned host and deploy key mismatches fail before SSH and delete private temporary copies", t => {
  for (const changes of [
    { DEPLOY_HOST_FINGERPRINT: `SHA256:${"D".repeat(43)}` },
    { DEPLOY_KEY_FINGERPRINT: `SHA256:${"E".repeat(43)}` },
    { DEPLOY_KNOWN_HOSTS: "[demo.example.invalid]:2222 ssh-ed25519 TEST_HOST_PUBLIC_KEY\n[other.invalid]:2222 ssh-ed25519 UNTRUSTED_HOST_KEY" },
  ]) {
    const f = fixture(t);
    const result = f.frontend(changes);
    failed(result);
    assert.match(result.stderr, /fingerprint does not match/, "the pin mismatch itself causes refusal");
    assert.equal(f.calls().some(call => call.command === "ssh"), false);
    assert.deepEqual(f.temporary(), []);
    assert.ok(!`${result.stdout}${result.stderr}`.includes("TEST_FIXTURE_ONLY"));
  }
});

test("a matched deployment uses only pinned SSH host files and cleans credentials after success or SSH failure", t => {
  for (const sshExit of ["0", "255"]) {
    const f = fixture(t);
    const result = f.frontend({ MOCK_SSH_EXIT: sshExit });
    if (sshExit === "0") successful(result); else failed(result);
    const calls = f.calls().filter(call => call.command === "ssh");
    assert.ok(calls.length > 0, result.stderr);
    for (const { args } of calls) {
      assert.ok(args.includes("StrictHostKeyChecking=yes"));
      assert.ok(args.includes("GlobalKnownHostsFile=/dev/null"));
      assert.ok(args.includes("UpdateHostKeys=no"), "the server cannot add new unpinned keys");
      assert.equal(args[args.indexOf("-F") + 1], "/dev/null", "ambient SSH configuration cannot introduce another identity or proxy");
      assert.ok(args.includes("IdentitiesOnly=yes"));
      assert.ok(args.some(arg => arg.startsWith("UserKnownHostsFile=")));
      const key = args[args.indexOf("-i") + 1];
      assert.equal(existsSync(key), false, "temporary private key removed even after failed SSH");
    }
    if (sshExit === "0") assert.ok(calls.at(-1).args.at(-1).includes(rootlessHost), "the selected endpoint is passed explicitly to the server");
    assert.deepEqual(f.temporary(), []);
  }
});

test("an explicit rootless socket is selected before every Docker operation, overriding ambient rootful context", t => {
  const f = fixture(t);
  successful(f.remote({ env: { DOCKER_HOST: "unix:///var/run/docker.sock", DOCKER_CONTEXT: "default" } }));
  const commands = dockerCalls(f);
  assert.ok(commands.length > 0);
  for (const command of commands) {
    assert.equal(command.dockerHost, rootlessHost, command.args.join(" "));
    assert.equal(command.dockerContext, "", "a context cannot override the explicitly selected socket");
  }
  assert.ok(commands.some(call => call.args[0] === "info"), "server verifies rootless daemon mode");
  assert.equal(f.currentImage(), image);
  assert.ok(f.calls().some(call => call.command === "curl" && call.args.includes("https://demo.example.invalid/api/health")));
});

test("an explicitly named rootless context clears an ambient rootful host before Docker is used", t => {
  const f = fixture(t);
  successful(f.remote({ host: "", context: "fixture-rootless", env: { DOCKER_HOST: "unix:///var/run/docker.sock", DOCKER_CONTEXT: "default" } }));
  assert.ok(dockerCalls(f).length > 0);
  for (const command of dockerCalls(f)) {
    assert.equal(command.dockerContext, "fixture-rootless");
    assert.equal(command.dockerHost, "");
  }
});

test("missing, ambiguous or rootful endpoint selection fails closed without switching images", t => {
  for (const options of [
    { host: "", context: "", env: { DOCKER_HOST: "unix:///var/run/docker.sock", DOCKER_CONTEXT: "default" } },
    { host: rootlessHost, context: "fixture-rootless" },
    { env: { MOCK_DOCKER_ROOTLESS: "false" } },
    { env: { MOCK_DOCKER_INFO_FAIL: "1" } },
  ]) {
    const f = fixture(t);
    failed(f.remote(options));
    assert.equal(f.currentImage(), previous);
    assert.equal(dockerCalls(f).some(call => call.args[0] === "pull" || (call.args[0] === "compose" && ["up", "stop", "start"].includes(call.args[1]) && !call.args.includes("--help"))), false);
    for (const call of dockerCalls(f)) assert.equal(call.dockerHost, rootlessHost, "there is no fallback attempt against the rootful socket");
  }
});

test("failed external HTTPS health rolls back to the previous image despite healthy internal startup", t => {
  for (const env of [{ MOCK_PUBLIC_HEALTH_FAIL: image }, { MOCK_PUBLIC_HEALTH_STATUS: "302", MOCK_CANDIDATE_IMAGE: image }]) {
    const f = fixture(t);
    const result = f.remote({ env });
    failed(result);
    assert.equal(f.currentImage(), previous);
    const starts = dockerCalls(f).filter(call => call.args[0] === "compose" && call.args[1] === "up" && !call.args.includes("--help"));
    assert.deepEqual(starts.map(call => call.appImage), [image, previous]);
    const external = f.calls().filter(call => call.command === "curl");
    assert.ok(external.some(call => call.appImage === image));
    assert.ok(external.some(call => call.appImage === previous), "the restored image is checked through public HTTPS too");
    for (const { args } of external) {
      assert.ok(args.includes("--proto") && args.includes("=https"));
      assert.equal(args.some(arg => ["-L", "--location", "-k", "--insecure"].includes(arg)), false, "redirects and invalid TLS cannot look healthy");
    }
    assert.equal(existsSync(path.join(f.root, "remote", "deployments.log")), false, "a failed candidate is never recorded as a successful deployment");
  }
});

test("required public health rejects HTTP and derives its HTTPS URL from PUBLIC_ORIGIN when omitted", t => {
  const rejected = fixture(t);
  failed(rejected.remote({ health: "http://demo.example.invalid/api/health" }));
  assert.equal(rejected.currentImage(), previous);
  assert.equal(dockerCalls(rejected).some(call => call.args[0] === "pull"), false);
  const derived = fixture(t);
  successful(derived.remote({ health: "" }));
  assert.ok(derived.calls().some(call => call.command === "curl" && call.args.includes("https://demo.example.invalid/api/health")));
});

test("registry credentials use a temporary Docker config without changing the selected endpoint", t => {
  for (const endpoint of [{ host: rootlessHost, context: "" }, { host: "", context: "fixture-rootless" }]) {
    for (const pullExit of ["0", "1"]) {
      const f = fixture(t);
      const result = f.remote({ ...endpoint, registryUser: "fixture-registry-user", env: { MOCK_PULL_EXIT: pullExit } });
      if (pullExit === "0") successful(result); else failed(result);
      const pull = dockerCalls(f).find(call => call.args[0] === "pull");
      assert.ok(pull?.hasPrivateRegistryConfig);
      assert.ok(pull.hasContextMetadata && pull.hasComposePlugin, "temporary sign-in keeps existing context metadata and Compose plugin available");
      assert.notEqual(pull.dockerConfig, f.env.DOCKER_CONFIG);
      for (const call of dockerCalls(f)) {
        assert.equal(call.dockerHost, endpoint.host);
        assert.equal(call.dockerContext, endpoint.context);
      }
      assert.equal(existsSync(pull.dockerConfig), false, "temporary registry sign-in removed on success and pull failure");
      assert.deepEqual(f.temporary(), []);
      assert.equal(readFileSync(path.join(f.env.DOCKER_CONFIG, "keep.txt"), "utf8"), "existing operator configuration");
      assert.ok(!`${result.stdout}${result.stderr}`.includes("fixture-registry-password"));
    }
  }
});

test("a competing staged release is refused under the real file lock without touching live files", async t => {
  const f = fixture(t);
  const directory = path.join(f.root, "remote");
  const saved = ["compose.yaml", "deploy-remote.sh"].map(file => readFileSync(path.join(directory, file), "utf8"));
  const stage = f.stage("competing release");
  const settings = readFileSync(path.join(directory, ".env"), "utf8");
  const holder = spawn("flock", ["-x", path.join(directory, ".deploy.lock"), "sh", "-c", "printf locked; read release"], { stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => holder.kill());
  await once(holder.stdout, "data");
  const result = f.remote({ stage, narration: "ELEVENLABS_API_KEY=FIXTURE_NARRATION_KEY_NOT_REAL_0001\n" });
  failed(result);
  assert.match(result.stderr, /another deployment is running/);
  assert.deepEqual(["compose.yaml", "deploy-remote.sh"].map(file => readFileSync(path.join(directory, file), "utf8")), saved);
  assert.deepEqual(f.calls(), [], "the rejected attempt does not even contact Docker");
  assert.equal(existsSync(stage), false, "only the rejected attempt's staging is removed");
  assert.equal(readFileSync(path.join(directory, ".env"), "utf8"), settings, "the refused attempt's narration settings are never applied");
  const exited = once(holder, "exit");
  holder.stdin.end("release\n");
  await exited;
});

test("an incomplete owned stage is cleaned before live files or Docker are touched", t => {
  const f = fixture(t);
  const directory = path.join(f.root, "remote");
  const saved = readFileSync(path.join(directory, "compose.yaml"), "utf8");
  const stage = f.stage();
  rmSync(path.join(stage, "compose.yaml"));
  failed(f.remote({ stage }));
  assert.equal(existsSync(stage), false);
  assert.equal(readFileSync(path.join(directory, "compose.yaml"), "utf8"), saved);
  assert.deepEqual(f.calls(), []);
});

test("failed staged health restores the previous Compose binding, script and image", t => {
  const f = fixture(t);
  const directory = path.join(f.root, "remote");
  const oldCompose = '# last-good\nservices:\n  app:\n    ports: ["127.0.0.1:3000:3000"]\n';
  const oldScript = "#!/bin/bash\n# last-good deployment tool\n";
  writeFileSync(path.join(directory, "compose.yaml"), oldCompose);
  writeFileSync(path.join(directory, "deploy-remote.sh"), oldScript);
  writeFileSync(path.join(directory, ".env"), `PUBLIC_ORIGIN=https://demo.example.invalid\nAPP_IMAGE=${previous}\nAPP_PORT=3001\nCOMPOSE_PROJECT_NAME=existing-client-project\n`);
  const stage = f.stage();
  const result = f.remote({ stage, env: { MOCK_PUBLIC_HEALTH_FAIL: image } });
  failed(result);
  assert.equal(f.currentImage(), previous);
  assert.equal(readFileSync(path.join(directory, "compose.yaml"), "utf8"), oldCompose);
  assert.equal(readFileSync(path.join(directory, "deploy-remote.sh"), "utf8"), oldScript);
  const starts = dockerCalls(f).filter(call => call.args[0] === "compose" && call.args[1] === "up" && !call.args.includes("--help"));
  assert.deepEqual(starts.map(call => call.appImage), [image, previous]);
  assert.match(starts[0].compose, /127\.0\.0\.1:3001:3000/);
  assert.equal(starts[1].compose, oldCompose, "rollback restarts with the previous release's settings");
  assert.ok(starts.every(call => call.project === "existing-client-project"));
  assert.match(readFileSync(path.join(directory, ".env"), "utf8"), /^APP_PORT=3001$/m, "operator settings are preserved");
  assert.equal(existsSync(stage), false);
  assert.equal(readdirSync(directory).some(file => file.startsWith(".deploy-transaction.")), false);
});

test("successful staged releases install their configuration under the existing project, including bootstrap", t => {
  for (const bootstrap of [false, true]) {
    const f = fixture(t);
    const directory = path.join(f.root, "remote");
    const stage = f.stage();
    const candidate = readFileSync(path.join(stage, "compose.yaml"), "utf8");
    if (bootstrap) {
      rmSync(path.join(directory, "compose.yaml"));
      rmSync(path.join(directory, "deploy-remote.sh"));
      writeFileSync(path.join(directory, ".env"), "PUBLIC_ORIGIN=https://demo.example.invalid\nAPP_PORT=3001\nCOMPOSE_PROJECT_NAME=existing-client-project\n");
    }
    successful(f.remote({ stage, env: bootstrap ? { MOCK_NO_CONTAINER: "1" } : {} }));
    assert.equal(f.currentImage(), image);
    assert.equal(readFileSync(path.join(directory, "compose.yaml"), "utf8"), candidate);
    assert.equal(readFileSync(path.join(directory, "deploy-remote.sh"), "utf8"), readFileSync(new URL("scripts/deploy-remote.sh", repository), "utf8"));
    assert.equal(existsSync(stage), false);
    const validation = dockerCalls(f).find(call => call.args.includes("config"));
    assert.equal(validation.args[validation.args.indexOf("--project-directory") + 1], directory);
    if (bootstrap) assert.ok(dockerCalls(f).every(call => call.project === "existing-client-project" || call.args[0] === "info" || call.args[1] === "version" || call.args.includes("--help")));
  }
});

test("invalid configuration and snapshot or partial-promotion failures preserve the working release", t => {
  for (const changes of [{ MOCK_INVALID_COMPOSE: "1" }, { MOCK_COPY_FAIL: "snapshot" }, { MOCK_COPY_FAIL: "promotion" }]) {
    const f = fixture(t);
    const directory = path.join(f.root, "remote");
    const saved = ["compose.yaml", "deploy-remote.sh"].map(file => readFileSync(path.join(directory, file), "utf8"));
    const stage = f.stage();
    failed(f.remote({ stage, env: changes }));
    assert.equal(f.currentImage(), previous);
    assert.deepEqual(["compose.yaml", "deploy-remote.sh"].map(file => readFileSync(path.join(directory, file), "utf8")), saved);
    assert.equal(dockerCalls(f).some(call => call.args[1] === "up" && !call.args.includes("--help") && call.appImage === image), false);
    assert.equal(existsSync(stage), false);
    assert.equal(readdirSync(directory).some(file => file.startsWith(".deploy-transaction.")), false);
  }
});

test("a failed rootless backup resumes the original release without promoting candidate configuration", t => {
  const f = fixture(t);
  const directory = path.join(f.root, "remote");
  const oldCompose = readFileSync(path.join(directory, "compose.yaml"), "utf8");
  const stage = f.stage();
  failed(f.remote({ stage, backup: "1", env: { MOCK_BACKUP_FAIL: "1" } }));
  assert.equal(f.currentImage(), previous);
  assert.equal(readFileSync(path.join(directory, "compose.yaml"), "utf8"), oldCompose);
  assert.ok(dockerCalls(f).some(call => call.args.includes("scripts/backup.sh")), "a real backup invocation was attempted through Compose");
  assert.ok(dockerCalls(f).every(call => call.dockerHost === rootlessHost && call.dockerContext === ""));
  const starts = dockerCalls(f).filter(call => call.args[1] === "up" && !call.args.includes("--help"));
  assert.deepEqual(starts.map(call => call.appImage), [previous]);
  assert.equal(existsSync(stage), false);
});

test("a failed first release removes only its candidate files and preserves operator settings", t => {
  const f = fixture(t);
  const directory = path.join(f.root, "remote");
  const stage = f.stage();
  rmSync(path.join(directory, "compose.yaml"));
  rmSync(path.join(directory, "deploy-remote.sh"));
  const settings = "PUBLIC_ORIGIN=https://demo.example.invalid\nAPP_PORT=3001\nCOMPOSE_PROJECT_NAME=existing-client-project\n";
  writeFileSync(path.join(directory, ".env"), settings);
  failed(f.remote({ stage, env: { MOCK_NO_CONTAINER: "1", MOCK_PUBLIC_HEALTH_FAIL: image } }));
  assert.equal(readFileSync(path.join(directory, ".env"), "utf8"), settings);
  assert.equal(existsSync(path.join(directory, "compose.yaml")), false);
  assert.equal(existsSync(path.join(directory, "deploy-remote.sh")), false);
  assert.equal(existsSync(stage), false);
  assert.ok(dockerCalls(f).some(call => call.args[1] === "stop" && call.appImage === image));
});

test("failed first-release settings restoration is reported and retains the recovery snapshot", t => {
  const f = fixture(t);
  const directory = path.join(f.root, "remote");
  const stage = f.stage();
  rmSync(path.join(directory, "compose.yaml"));
  rmSync(path.join(directory, "deploy-remote.sh"));
  writeFileSync(path.join(directory, ".env"), "PUBLIC_ORIGIN=https://demo.example.invalid\nCOMPOSE_PROJECT_NAME=existing-client-project\n");
  writeFileSync(path.join(f.root, "bin", "sed"), '#!/bin/bash\nif [[ "$1" = -i && "$2" = "/^APP_IMAGE=/d" ]]; then exit 1; fi\nexec /bin/sed "$@"\n', { mode: 0o755 });
  const result = f.remote({ stage, env: { MOCK_NO_CONTAINER: "1", MOCK_PUBLIC_HEALTH_FAIL: image } });
  failed(result);
  assert.match(result.stdout + result.stderr, /could not restore APP_IMAGE.*operator intervention/);
  assert.equal(f.currentImage(), image, "the failure to restore settings is observable, not reported as success");
  assert.equal(readdirSync(directory).filter(file => file.startsWith(".deploy-transaction.")).length, 1);
  assert.equal(existsSync(stage), false);
});

// Fixture values only; never a provider credential.
const narrationKey = "FIXTURE_NARRATION_KEY_NOT_REAL_0001";
const oldNarrationKey = "FIXTURE_OLD_NARRATION_KEY_NOT_REAL_01";
const narrationSettings = { ELEVENLABS_API_KEY: narrationKey, ELEVENLABS_VOICE_ID: "FixtureVoice0123", ELEVENLABS_MODEL_ID: "eleven_v3", ELEVENLABS_DAILY_CHARACTER_LIMIT: "5000" };
const mode = file => statSync(file).mode & 0o777;
const writeSettings = (directory, text, permissions) => {
  writeFileSync(path.join(directory, ".env"), text);
  chmodSync(path.join(directory, ".env"), permissions);
};
const leftovers = directory => readdirSync(directory).filter(file => /^\.env\.|^\.deploy-(transaction|stage)\./.test(file));
const quiet = (f, result, ...values) => {
  const log = path.join(f.root, "remote", "deploy.log");
  const output = `${result.stdout}${result.stderr}${existsSync(log) ? readFileSync(log, "utf8") : ""}`;
  for (const value of values) {
    assert.equal(output.includes(value), false, "a narration value is never printed or logged");
    assert.equal(f.calls().some(call => call.args.some(arg => arg.includes(value))), false, "a narration value is never on a command line");
  }
};
const composeUps = f => dockerCalls(f).filter(call => call.args[0] === "compose" && call.args[1] === "up" && !call.args.includes("--help"));

test("narration settings replace or append their .env lines privately, from standard input only", t => {
  const f = fixture(t);
  const directory = path.join(f.root, "remote");
  writeSettings(directory, [
    "# operator notes stay", "PUBLIC_ORIGIN=https://demo.example.invalid", `APP_IMAGE=${previous}`, "COMPOSE_PROJECT_NAME=bangla-adventures",
    "# ELEVENLABS_API_KEY=commented-out-example", `ELEVENLABS_API_KEY=${oldNarrationKey}`,
    "OTHER_SETTING=kept value # with its comment", "", `ELEVENLABS_API_KEY=${oldNarrationKey}`,
  ].join("\n"), 0o600);
  const stage = f.stage();
  const result = f.remote({ stage, narration: `ELEVENLABS_API_KEY=${narrationKey}\nELEVENLABS_VOICE_ID=FixtureVoice0123\n` });
  successful(result);
  assert.equal(readFileSync(path.join(directory, ".env"), "utf8"), [
    "# operator notes stay", "PUBLIC_ORIGIN=https://demo.example.invalid", `APP_IMAGE=${image}`, "COMPOSE_PROJECT_NAME=bangla-adventures",
    "# ELEVENLABS_API_KEY=commented-out-example", `ELEVENLABS_API_KEY=${narrationKey}`,
    "OTHER_SETTING=kept value # with its comment", "", `ELEVENLABS_API_KEY=${narrationKey}`,
    "ELEVENLABS_VOICE_ID=FixtureVoice0123", "",
  ].join("\n"), "every copy of a given name is replaced, a missing one appended and every other line kept");
  assert.equal(mode(path.join(directory, ".env")), 0o600);
  const validation = dockerCalls(f).find(call => call.args.includes("config"));
  assert.equal(validation.narrationKey, narrationKey, "Compose validates the settings it will start with");
  assert.deepEqual(composeUps(f).map(call => call.narrationKey), [narrationKey]);
  assert.match(result.stdout, /updating ELEVENLABS_API_KEY ELEVENLABS_VOICE_ID in \.env/);
  assert.equal(existsSync(stage), false);
  assert.deepEqual(leftovers(directory), []);
  quiet(f, result, narrationKey, oldNarrationKey);
});

test("all four narration settings are appended to an .env without them, also after a last line without a newline", t => {
  const f = fixture(t);
  const directory = path.join(f.root, "remote");
  writeFileSync(path.join(directory, ".env"), `PUBLIC_ORIGIN=https://demo.example.invalid\nAPP_IMAGE=${previous}\nCOMPOSE_PROJECT_NAME=existing-client-project`);
  successful(f.remote({ stage: f.stage(), narration: Object.entries(narrationSettings).map(([name, value]) => `${name}=${value}\n`).join("") }));
  assert.equal(readFileSync(path.join(directory, ".env"), "utf8"), [
    "PUBLIC_ORIGIN=https://demo.example.invalid", `APP_IMAGE=${image}`, "COMPOSE_PROJECT_NAME=existing-client-project",
    ...Object.entries(narrationSettings).map(([name, value]) => `${name}=${value}`), "",
  ].join("\n"));
  assert.equal(mode(path.join(directory, ".env")), 0o600);
  assert.ok(composeUps(f).every(call => call.project === "existing-client-project"));
  assert.deepEqual(leftovers(directory), []);
});

test("narration lines come ahead of the registry password, which still signs in intact", t => {
  const f = fixture(t);
  const directory = path.join(f.root, "remote");
  const result = f.remote({ stage: f.stage(), registryUser: "fixture-registry-user", narration: `ELEVENLABS_API_KEY=${narrationKey}\n` });
  successful(result);
  const pull = dockerCalls(f).find(call => call.args[0] === "pull");
  assert.equal(Buffer.from(pull.registryAuth, "base64").toString(), "fixture-registry-user:fixture-registry-password");
  assert.match(readFileSync(path.join(directory, ".env"), "utf8"), new RegExp(`^ELEVENLABS_API_KEY=${narrationKey}$`, "m"));
  quiet(f, result, narrationKey);
});

test("without narration settings, or with only some, the server's existing key is left alone", t => {
  for (const narration of ["", "ELEVENLABS_VOICE_ID=FixtureVoice0123\n"]) {
    const f = fixture(t);
    const directory = path.join(f.root, "remote");
    const settings = `PUBLIC_ORIGIN=https://demo.example.invalid\nAPP_IMAGE=${previous}\nCOMPOSE_PROJECT_NAME=bangla-adventures\nELEVENLABS_API_KEY=${oldNarrationKey}\n`;
    writeSettings(directory, settings, 0o640);
    const stage = f.stage();
    const result = f.remote({ stage, narration, lines: narration ? 1 : 0 });
    successful(result);
    const expected = settings.replace(`APP_IMAGE=${previous}`, `APP_IMAGE=${image}`) + narration;
    assert.equal(readFileSync(path.join(directory, ".env"), "utf8"), expected);
    if (!narration) assert.equal(mode(path.join(directory, ".env")), 0o640, "an untouched .env keeps its mode");
    assert.deepEqual(composeUps(f).map(call => call.narrationKey), [oldNarrationKey]);
    assert.equal(existsSync(stage), false);
    quiet(f, result, oldNarrationKey);
  }
});

test("invalid narration settings are refused before .env or the app changes, without showing them", t => {
  for (const [narration, lines, message] of [
    ["ELEVENLABS_API_KEY=short\n"], [`ELEVENLABS_API_KEY=${narrationKey} trailing\n`], [`ELEVENLABS_API_KEY="${narrationKey}"\n`],
    [`ELEVENLABS_API_KEY=${narrationKey}$HOME\n`], [`ELEVENLABS_API_KEY=${narrationKey}\r\n`],
    [`ELEVENLABS_API_KEY=${narrationKey}\nELEVENLABS_API_KEY=${narrationKey}\n`],
    [`ELEVENLABS_API_KEY=${narrationKey}\nPUBLIC_ORIGIN=https://elsewhere.invalid\n`], [`${narrationKey}\n`],
    ["", 1], [`ELEVENLABS_API_KEY=${narrationKey}`, 1], [`ELEVENLABS_API_KEY=${narrationKey}\n`, 2],
    ["ELEVENLABS_VOICE_ID=bad-voice\n"], ["ELEVENLABS_MODEL_ID=Eleven\n"], ["ELEVENLABS_DAILY_CHARACTER_LIMIT=0\n"],
    [`ELEVENLABS_API_KEY=${narrationKey}\n`, "5", /NARRATION_LINES must be 0 to 4/], [`ELEVENLABS_API_KEY=${narrationKey}\n`, "one", /NARRATION_LINES must be 0 to 4/],
  ]) {
    const f = fixture(t);
    const directory = path.join(f.root, "remote");
    const settings = readFileSync(path.join(directory, ".env"), "utf8");
    const stage = f.stage();
    const result = f.remote({ stage, narration, ...(lines === undefined ? {} : { lines }) });
    failed(result);
    assert.match(result.stderr, message || /the narration settings are invalid/, JSON.stringify(narration));
    assert.equal(readFileSync(path.join(directory, ".env"), "utf8"), settings);
    assert.equal(dockerCalls(f).some(call => call.args[0] === "pull" || call.args.includes("config") || (call.args[1] === "up" && !call.args.includes("--help"))), false);
    assert.equal(existsSync(stage), false, `${JSON.stringify(narration)}: the refused stage is removed`);
    assert.deepEqual(leftovers(directory), []);
    quiet(f, result, narrationKey);
  }
});

test("a failed deployment puts back the previous .env, whether it fails before or after the release is saved", t => {
  const cases = [
    { label: "failed health", options: { env: { MOCK_PUBLIC_HEALTH_FAIL: image } }, ups: [narrationKey, oldNarrationKey] },
    { label: "failed backup", options: { backup: "1", env: { MOCK_BACKUP_FAIL: "1" } }, ups: [oldNarrationKey] },
    { label: "invalid Compose", options: { env: { MOCK_INVALID_COMPOSE: "1" } }, ups: [] },
    { label: "failed pull", options: { registryUser: "fixture-registry-user", env: { MOCK_PULL_EXIT: "1" } }, ups: [] },
    { label: "failed promotion", options: { env: { MOCK_COPY_FAIL: "promotion" } }, ups: [oldNarrationKey] },
  ];
  for (const { label, options, ups } of cases) {
    const f = fixture(t);
    const directory = path.join(f.root, "remote");
    const settings = `PUBLIC_ORIGIN=https://demo.example.invalid\nAPP_IMAGE=${previous}\nELEVENLABS_API_KEY=${oldNarrationKey}\nAPP_PORT=3001\nCOMPOSE_PROJECT_NAME=existing-client-project\n`;
    writeSettings(directory, settings, 0o600);
    const stage = f.stage();
    const result = f.remote({ stage, narration: `ELEVENLABS_API_KEY=${narrationKey}\nELEVENLABS_DAILY_CHARACTER_LIMIT=5000\n`, ...options });
    failed(result);
    assert.equal(readFileSync(path.join(directory, ".env"), "utf8"), settings, `${label}: the previous .env is back`);
    assert.equal(mode(path.join(directory, ".env")), 0o600, label);
    assert.deepEqual(composeUps(f).map(call => call.narrationKey), ups, `${label}: the candidate starts with the new key, the restored release with the old one`);
    assert.equal(existsSync(stage), false, label);
    assert.deepEqual(leftovers(directory), [], `${label}: no copy of either key is left behind`);
    quiet(f, result, narrationKey, oldNarrationKey);
  }
});

test("a failed first release with narration settings restores the operator's .env exactly", t => {
  const f = fixture(t);
  const directory = path.join(f.root, "remote");
  const stage = f.stage();
  rmSync(path.join(directory, "compose.yaml"));
  rmSync(path.join(directory, "deploy-remote.sh"));
  const settings = "PUBLIC_ORIGIN=https://demo.example.invalid\nAPP_PORT=3001\nCOMPOSE_PROJECT_NAME=existing-client-project\n";
  writeSettings(directory, settings, 0o600);
  failed(f.remote({ stage, narration: `ELEVENLABS_API_KEY=${narrationKey}\n`, env: { MOCK_NO_CONTAINER: "1", MOCK_PUBLIC_HEALTH_FAIL: image } }));
  assert.equal(readFileSync(path.join(directory, ".env"), "utf8"), settings);
  assert.equal(existsSync(path.join(directory, "compose.yaml")), false);
  assert.equal(existsSync(stage), false);
  assert.deepEqual(leftovers(directory), []);
});

test("an .env that cannot be put back is reported and its private copy kept for recovery", t => {
  const f = fixture(t);
  const directory = path.join(f.root, "remote");
  const settings = `PUBLIC_ORIGIN=https://demo.example.invalid\nAPP_IMAGE=${previous}\nCOMPOSE_PROJECT_NAME=bangla-adventures\nELEVENLABS_API_KEY=${oldNarrationKey}\n`;
  writeSettings(directory, settings, 0o600);
  const stage = f.stage();
  const result = f.remote({ stage, narration: `ELEVENLABS_API_KEY=${narrationKey}\n`, env: { MOCK_INVALID_COMPOSE: "1", MOCK_COPY_FAIL: "settings" } });
  failed(result);
  assert.match(result.stdout + result.stderr, /the previous \.env could not be restored; it remains in \S+\.deploy-transaction\.\S+ for recovery/);
  const kept = readdirSync(directory).filter(file => file.startsWith(".deploy-transaction."));
  assert.equal(kept.length, 1);
  assert.equal(readFileSync(path.join(directory, kept[0], ".env"), "utf8"), settings);
  assert.equal(mode(path.join(directory, kept[0], ".env")), 0o600);
  assert.equal(existsSync(stage), false);
  quiet(f, result, narrationKey, oldNarrationKey);
});

test("the frontend sends narration settings ahead of the password on the dispatch's input, never on a command line, in the stage or in a trace", t => {
  const f = fixture(t);
  const input = path.join(f.root, "dispatch-input");
  const result = f.frontend({ ...narrationSettings, REGISTRY_USER: "fixture-registry-user", REGISTRY_PASSWORD: "fixture-registry-password", MOCK_SSH_INPUT: input });
  successful(result);
  const commands = f.calls().filter(call => call.command === "ssh").map(call => call.args.at(-1));
  assert.equal(commands.length, 4, "create the stage, upload two release files, dispatch");
  assert.equal(commands.some(command => command.includes("narration")), false, "nothing about the settings is uploaded into the stage");
  assert.match(commands.at(-1), /^bash \S+\/\.deploy-stage\.Fixture123\/deploy-remote\.sh .* \/opt\/bangla-adventures\/\.deploy-stage\.Fixture123 4$/);
  assert.equal(readFileSync(input, "utf8"), Object.entries(narrationSettings).map(([name, value]) => `${name}=${value}\n`).join("") + "fixture-registry-password");
  quiet(f, result, narrationKey);
  assert.deepEqual(f.temporary(), [], "the local copy is removed");
  const traced = spawnSync("bash", ["-x", path.join(f.root, "scripts/deploy.sh"), image], { cwd: f.root, env: { ...f.env, ...f.frontEnv, ...narrationSettings }, encoding: "utf8", timeout: 20_000 });
  assert.equal(traced.status, 0, traced.stderr);
  assert.equal(`${traced.stdout}${traced.stderr}`.includes(narrationKey), false, "tracing the script does not reveal the key");
});

test("empty narration settings send nothing, so the server keeps its own", t => {
  const f = fixture(t);
  const input = path.join(f.root, "dispatch-input");
  successful(f.frontend({ ...Object.fromEntries(Object.keys(narrationSettings).map(name => [name, ""])), REGISTRY_PASSWORD: "fixture-registry-password", MOCK_SSH_INPUT: input }));
  assert.match(f.calls().filter(call => call.command === "ssh").at(-1).args.at(-1), / 0$/);
  assert.equal(readFileSync(input, "utf8"), "fixture-registry-password", "only the password is sent");
  assert.deepEqual(f.temporary(), []);
});

test("invalid narration settings stop the frontend before any connection, with a message that hides the value", t => {
  for (const [name, value, message] of [
    ["ELEVENLABS_API_KEY", "short-fixture", /ELEVENLABS_API_KEY must be the key alone/],
    ["ELEVENLABS_API_KEY", `${narrationKey} with-space`, /ELEVENLABS_API_KEY must be the key alone/],
    ["ELEVENLABS_API_KEY", `'${narrationKey}'`, /ELEVENLABS_API_KEY must be the key alone/],
    ["ELEVENLABS_API_KEY", `${narrationKey}\n`, /ELEVENLABS_API_KEY must be the key alone/],
    ["ELEVENLABS_API_KEY", `${narrationKey}$`, /ELEVENLABS_API_KEY must be the key alone/],
    ["ELEVENLABS_API_KEY", `${narrationKey}é`, /ELEVENLABS_API_KEY must be the key alone/],
    ["ELEVENLABS_API_KEY", narrationKey.repeat(6), /ELEVENLABS_API_KEY must be the key alone/],
    ["ELEVENLABS_VOICE_ID", "FIXTURE_VOICE-1", /ELEVENLABS_VOICE_ID must be 10 to 40 letters and digits/],
    ["ELEVENLABS_MODEL_ID", "Eleven_V3", /ELEVENLABS_MODEL_ID must be 3 to 40 lowercase/],
    ["ELEVENLABS_DAILY_CHARACTER_LIMIT", "0500", /ELEVENLABS_DAILY_CHARACTER_LIMIT must be a positive whole number/],
  ]) {
    const f = fixture(t);
    const result = f.frontend({ ...narrationSettings, [name]: value });
    failed(result);
    assert.match(result.stderr, message);
    assert.equal(f.calls().some(call => call.command === "ssh"), false, `${name}: refused before SSH`);
    assert.equal(`${result.stdout}${result.stderr}`.includes(value.trim()), false, `${name}: the refused value is not shown`);
    assert.equal(`${result.stdout}${result.stderr}`.includes(narrationKey), false);
    assert.deepEqual(f.temporary(), []);
  }
});

test("newest-commit check distinguishes current, stale and unverifiable commits", t => {
  const cases = [
    [{}, 0], [{ MOCK_GIT_TIP: later }, 1], [{ MOCK_GIT_REMOTE_FAIL: "1" }, 2],
    [{ MOCK_GIT_HEAD_FAIL: "1" }, 2], [{ MOCK_GIT_MISSING_BRANCH: "1" }, 2],
    [{ MOCK_GIT_HEAD: "invalid" }, 2], [{ MOCK_GIT_TIP: "invalid" }, 2], [{ MOCK_GIT_AMBIGUOUS: "1" }, 2],
  ];
  for (const [env, status] of cases) {
    const f = fixture(t);
    const result = f.run("scripts/ci/newest.sh", ["main"], env);
    assert.equal(result.status, status, result.stderr + result.stdout);
    assert.equal(f.calls().some(call => ["ssh", "docker"].includes(call.command)), false);
  }
});


test("GitHub deployment requires the explicit gate and newest-check lookup errors fail both publish and deploy", t => {
  const workflow = readFileSync(new URL(".github/workflows/ci.yml", repository), "utf8");
  const deploy = workflow.match(/^  deploy:\n([\s\S]*)$/m)?.[1];
  assert.ok(deploy);
  assert.match(deploy, /^    if: vars\.DEPLOY_ENABLED == 'true'$/m);
  assert.match(deploy, /^          DEPLOY_HOST: \$\{\{ secrets\.DEPLOY_HOST \}\}$/m);
  assert.match(deploy, /^          DEPLOY_USER: \$\{\{ secrets\.DEPLOY_USER \}\}$/m);
  assert.match(deploy, /^          DEPLOY_REQUIRE_ROOTLESS: 'true'$/m);
  assert.match(deploy, /^          DEPLOY_REQUIRE_PUBLIC_HEALTH: 'true'$/m);
  assert.match(deploy, /^          ELEVENLABS_API_KEY: \$\{\{ secrets\.ELEVENLABS_API_KEY \}\}$/m, "the narration key comes only from a secret");
  for (const name of ["ELEVENLABS_VOICE_ID", "ELEVENLABS_MODEL_ID", "ELEVENLABS_DAILY_CHARACTER_LIMIT"]) {
    assert.match(deploy, new RegExp(`^          ${name}: \\$\\{\\{ vars\\.${name} \\}\\}$`, "m"));
  }
  const checks = [...workflow.matchAll(/^        run: \|\n((?:^          .*\n|^\n)+)/gm)]
    .map(match => match[1].split("\n").map(line => line.slice(10)).join("\n"))
    .filter(script => script.includes("bash scripts/ci/newest.sh"));
  assert.equal(checks.length, 2, "both promotion and deployment recheck the current branch tip");
  for (const script of checks) {
    for (const [env, status, expectedOutput] of [[{}, 0, "newest=true"], [{ MOCK_GIT_TIP: later }, 0, "newest=false"], [{ MOCK_GIT_REMOTE_FAIL: "1" }, 2, ""]]) {
      const f = fixture(t);
      writeFileSync(path.join(f.root, "workflow-check.sh"), script);
      const output = path.join(f.root, "workflow-output");
      const result = f.run("workflow-check.sh", [], { ...env, BRANCH: "main", GITHUB_OUTPUT: output });
      assert.equal(result.status, status, result.stdout + result.stderr);
      assert.equal(existsSync(output) ? readFileSync(output, "utf8").trim() : "", expectedOutput);
      assert.equal(f.calls().some(call => ["ssh", "docker"].includes(call.command)), false);
    }
  }
});


test("VPS preflights accept the server address secrets at either level and name them without showing their values", () => {
  const message = name => `the ${name} secret is missing or invalid (set it as a repository secret or a production environment secret, named exactly ${name}).`;
  for (const file of ["vps-ssh-preflight.yml", "vps-image-preflight.yml"]) {
    const workflow = readFileSync(new URL(`.github/workflows/${file}`, repository), "utf8");
    assert.doesNotMatch(workflow, /repository secret DEPLOY_(HOST|USER)/, file);
    assert.match(workflow, /^    environment: production$/m, `${file} reads production environment secrets`);
    for (const name of ["DEPLOY_HOST", "DEPLOY_USER"]) {
      assert.match(workflow, new RegExp(`^          ${name}: \\$\\{\\{ secrets\\.${name} \\}\\}$`, "m"), file);
    }
    // Run the workflow's own two checks, so the message and the unchanged patterns are both proved.
    const checks = workflow.split("\n").map(line => line.trim()).filter(line => /^\[\[ "\$\{DEPLOY_(HOST|USER):-\}" =~ /.test(line));
    assert.equal(checks.length, 2, file);
    const script = `set -euo pipefail\nfail() { printf '%s\\n' "$*" >&2; exit 1; }\n${checks.join("\n")}\necho valid\n`;
    const run = env => spawnSync("bash", ["-c", script], { encoding: "utf8", env: { PATH: process.env.PATH, ...env } });
    const valid = run({ DEPLOY_HOST: "demo.example.invalid", DEPLOY_USER: "fixture-deploy" });
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(valid.stdout, "valid\n");
    for (const [env, name] of [
      [{ DEPLOY_USER: "fixture-deploy" }, "DEPLOY_HOST"],
      [{ DEPLOY_HOST: "demo.example.invalid;id", DEPLOY_USER: "fixture-deploy" }, "DEPLOY_HOST"],
      [{ DEPLOY__HOST: "demo.example.invalid", DEPLOY_USER: "fixture-deploy" }, "DEPLOY_HOST"],
      [{ DEPLOY_HOST: "demo.example.invalid" }, "DEPLOY_USER"],
      [{ DEPLOY_HOST: "demo.example.invalid", DEPLOY_USER: "Fixture Deploy" }, "DEPLOY_USER"],
    ]) {
      const result = run(env);
      assert.equal(result.status, 1, file);
      assert.equal(result.stderr, `${message(name)}\n`, file);
      assert.doesNotMatch(result.stderr + result.stdout, /demo\.example|Fixture/, file);
    }
  }
});

test("VPS templates stay disabled and choose loopback 3001 without changing the generic 3000 default", t => {
  const settings = file => Object.fromEntries(readFileSync(new URL(file, repository), "utf8").split("\n").filter(line => /^[A-Z_]+=/.test(line)).map(line => {
    const separator = line.indexOf("=");
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
  const variables = settings("deploy/vps.github-variables.env.example");
  assert.equal(variables.DEPLOY_ENABLED, "false");
  assert.equal(variables.DEPLOY_REQUIRE_ROOTLESS, "true");
  assert.equal(variables.DEPLOY_REQUIRE_PUBLIC_HEALTH, "true");
  assert.equal(variables.DEPLOY_KNOWN_HOSTS, "", "the template cannot invent a trusted host key");
  assert.equal(variables.DEPLOY_SSH_KEY, undefined, "private deploy credentials are never part of the variable template");
  const application = settings("deploy/vps.app.env.example");
  assert.equal(application.PUBLIC_ORIGIN, "", "the actual HTTPS domain requires operator configuration");
  assert.equal(application.APP_PORT, "3001");
  assert.equal(application.COMPOSE_PROJECT_NAME, "bangla-adventures");
  const compose = readFileSync(new URL("compose.yaml", repository), "utf8");
  const portBlock = compose.match(/^    ports:\n((?:^      [^\n]*\n)+)/m)?.[1];
  assert.ok(portBlock, "the app explicitly declares its bound port");
  const ports = [...portBlock.matchAll(/^      - "([^"\n]+)"$/gm)].map(match => match[1]);
  assert.deepEqual(ports, ["127.0.0.1:${APP_PORT:-3000}:3000"]);
  const f = fixture(t);
  writeFileSync(path.join(f.root, "port-binding.sh"), `printf '%s\\n' "${ports[0]}"\n`);
  for (const [port, expected] of [["", "127.0.0.1:3000:3000"], [application.APP_PORT, "127.0.0.1:3001:3000"]]) {
    const result = f.run("port-binding.sh", [], { APP_PORT: port });
    successful(result);
    assert.equal(result.stdout.trim(), expected);
  }
  assert.match(compose, /^      PORT: "3000"$/m);
  for (const name of ["ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID", "ELEVENLABS_MODEL_ID", "ELEVENLABS_DAILY_CHARACTER_LIMIT"]) {
    assert.ok(compose.includes(`${name}: \${${name}:-}`), `${name} is optional and forwarded from the private server environment`);
    assert.equal(application[name], undefined, "the template does not enable a provider or contain a credential");
  }
  assert.doesNotMatch(compose, /8001/);
  assert.doesNotMatch(compose, /(?:0\.0\.0\.0|\[::\]):/);
});

function yamlShellBlocks(source) {
  const lines = source.split("\n");
  const blocks = [];
  for (let index = 0; index < lines.length; index++) {
    if (!/^\s*(?:[^#\n]*:|-)\s+\|[-+]?\s*$/.test(lines[index])) continue;
    const indentation = lines[index].search(/\S/) + (/^\s*-\s+\S+:/.test(lines[index]) ? 2 : 0);
    const block = [];
    for (let next = index + 1; next < lines.length; next++) {
      if (lines[next].trim() && lines[next].search(/\S/) <= indentation) break;
      block.push(lines[next]);
    }
    const margin = Math.min(...block.filter(line => line.trim()).map(line => line.search(/\S/)));
    blocks.push(block.map(line => line.slice(margin)).join("\n"));
  }
  return blocks;
}

test("every other CI provider executes newest checks without publishing latest or deploying when verification fails", t => {
  const files = [".gitlab-ci.yml", "Jenkinsfile", ".circleci/config.yml", "azure-pipelines.yml", "bitbucket-pipelines.yml", ".travis.yml", ".teamcity/settings.kts", "buildspec.yml", "cloudbuild.yaml"];
  for (const file of files) {
    const source = readFileSync(new URL(file, repository), "utf8");
    const blocks = file === "Jenkinsfile" ? [...source.matchAll(/sh '''([\s\S]*?)'''/g)].map(match => match[1])
      : file.endsWith(".kts") ? [...source.matchAll(/scriptContent = """([\s\S]*?)"""/g)].map(match => match[1].replaceAll("${'$'}", "$").replaceAll("%teamcity.build.branch%", "main").replaceAll("%build.vcs.number%", head))
      : yamlShellBlocks(source);
    const checks = blocks.filter(script => script.includes("bash scripts/ci/newest.sh"));
    assert.equal(checks.length, 2, `${file}: both promotion and deployment check the current branch tip`);
    for (const script of checks) {
      const deploying = script.includes("bash scripts/deploy.sh");
      for (const [state, changes, status] of [["current", {}, 0], ["stale", { MOCK_GIT_TIP: later }, 0], ["unverifiable", { MOCK_GIT_REMOTE_FAIL: "1" }, 2]]) {
        const f = fixture(t);
        for (const command of ["publish-effect", "deploy-effect", "apk", "cat", "gcloud"]) {
          writeFileSync(path.join(f.root, "bin", command), `#!${process.execPath}\nconst command = ${JSON.stringify(command)};\n${stub}`, { mode: 0o755 });
        }
        writeFileSync(path.join(f.root, "scripts", "ci", "publish.sh"), 'exec publish-effect "$@"\n');
        writeFileSync(path.join(f.root, "scripts", "deploy.sh"), 'exec deploy-effect "$@"\n');
        writeFileSync(path.join(f.root, "workflow-check.sh"), script);
        const result = f.run("workflow-check.sh", [], {
          BRANCH: "main", DEFAULT_BRANCH: "main", BRANCH_NAME: "main", CI_DEFAULT_BRANCH: "main", CIRCLE_BRANCH: "main", BITBUCKET_BRANCH: "main", BUILD_SOURCEBRANCH: "refs/heads/main",
          COMMIT: head, CI_COMMIT_SHA: head, GIT_COMMIT: head, CIRCLE_SHA1: head, BITBUCKET_COMMIT: head, TRAVIS_COMMIT: head, BUILD_SOURCEVERSION: head,
          REGISTRY_IMAGE: "ghcr.io/example/bangla", IMAGE: "ghcr.io/example/bangla", LOCAL_IMAGE: "fixture-local",
          CI_REGISTRY_USER: "fixture-user", CI_REGISTRY_PASSWORD: "fictional-test-password",
          DEPLOY_ENABLED: "true", DEPLOY_HOST: "demo.example.invalid", DEPLOY_SSH_KEY_SECRET: "fixture-key", DEPLOY_KNOWN_HOSTS_SECRET: "fixture-hosts", PROJECT_ID: "fixture-project",
          ...changes,
        });
        const label = `${file} ${deploying ? "deploy" : "publish"} ${state}`;
        assert.equal(result.status, status, `${label}: ${result.stdout}${result.stderr}`);
        const effects = f.calls().filter(call => ["publish-effect", "deploy-effect"].includes(call.command));
        if (state === "current") {
          assert.equal(effects.length, 1, label);
          assert.equal(effects[0].command, deploying ? "deploy-effect" : "publish-effect", label);
          if (!deploying) assert.ok(effects[0].args.includes("ghcr.io/example/bangla:latest"), label);
        } else if (state === "stale" && !deploying && ["Jenkinsfile", "buildspec.yml", "cloudbuild.yaml"].includes(file)) {
          assert.equal(effects.length, 1, `${label}: immutable commit images can still be published`);
          assert.deepEqual(effects[0].args, ["push", "fixture-local", `ghcr.io/example/bangla:sha-${head}`], label);
        } else {
          assert.deepEqual(effects, [], label);
        }
        assert.equal(f.calls().some(call => ["ssh", "docker"].includes(call.command)), false, label);
        if (file === "cloudbuild.yaml" && deploying && state !== "current") assert.equal(f.calls().some(call => call.command === "gcloud"), false, `${label}: do not read credentials when deployment cannot proceed`);
      }
    }
  }
});

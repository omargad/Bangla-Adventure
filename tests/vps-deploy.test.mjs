import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
if (command === 'docker' && env.DOCKER_CONFIG && fs.existsSync(path.join(env.DOCKER_CONFIG, 'config.json'))) {
  entry.hasPrivateRegistryConfig = true;
  entry.hasContextMetadata = fs.existsSync(path.join(env.DOCKER_CONFIG, 'contexts', 'fixture-context'));
  entry.hasComposePlugin = fs.existsSync(path.join(env.DOCKER_CONFIG, 'cli-plugins', 'fixture-compose'));
}
fs.appendFileSync(env.MOCK_LOG, JSON.stringify(entry) + '\n');
const out = value => process.stdout.write(value + '\n');
const done = (code = 0) => process.exit(code);
if (command === 'ssh') { fs.readFileSync(0); done(Number(env.MOCK_SSH_EXIT || 0)); }
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
    if (args[1] === 'version') { out('Docker Compose version v2.30.0'); done(); }
    if (args[1] === 'up' && args.includes('--help')) { out('--wait --wait-timeout'); done(); }
    if (args[1] === 'ps') { out('existing-app-container'); done(); }
    if (args[1] === 'up' || args[1] === 'exec' || args[1] === 'logs' || args[1] === 'stop' || args[1] === 'start') done();
  }
  if (args[0] === 'inspect') { out(env.MOCK_PREVIOUS_IMAGE); done(); }
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
  for (const command of ["docker", "ssh", "ssh-keygen", "curl", "git", "id", "sleep"]) {
    writeFileSync(path.join(root, "bin", command), `#!${process.execPath}\nconst command = ${JSON.stringify(command)};\n${stub}`, { mode: 0o755 });
  }
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(DEPLOY_|REGISTRY_|DOCKER_|MOCK_|PUBLIC_HEALTH_URL$)/.test(key)));
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
  const remote = ({ host = rootlessHost, context = "", rootless = "true", health = "https://demo.example.invalid/api/health", requireHealth = "true", registryUser = "", env: changes = {} } = {}) => run("remote/deploy-remote.sh", [image, registryUser, "0", "1", host, context, rootless, health, requireHealth], changes, registryUser ? "fixture-registry-password" : "");
  return { root, env, calls, run, frontend, remote, temporary: () => readdirSync(path.join(root, "temporary")), currentImage: () => /^APP_IMAGE=(.*)$/m.exec(readFileSync(path.join(root, "remote", ".env"), "utf8"))?.[1] };
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
  assert.match(deploy, /^    if: vars\.DEPLOY_ENABLED == 'true' && vars\.DEPLOY_HOST != ''$/m);
  assert.match(deploy, /^          DEPLOY_REQUIRE_ROOTLESS: 'true'$/m);
  assert.match(deploy, /^          DEPLOY_REQUIRE_PUBLIC_HEALTH: 'true'$/m);
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

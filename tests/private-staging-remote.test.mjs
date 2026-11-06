import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const script = readFileSync(new URL("../scripts/private-staging-remote.sh", import.meta.url), "utf8");
const image = "ghcr.io/omargad/bangla-adventure@sha256:fc6f52720d3ecf55998e56a2432ffd5a782d3db231323874daf0b6d0357efca2";
const revision = "95b6308ac7ad3d5b6bb2d951df9d65a23ff77107";
const stage = "/opt/bangla-adventures/private-staging", project = "bangla-adventures-staging", volume = project + "_bangla-data";
function pythonBlock(anchor) {
  const start = script.indexOf(anchor);
  assert.ok(start >= 0, anchor);
  const bodyStart = script.indexOf("\n", start) + 1;
  return script.slice(bodyStart, script.indexOf("\nPY", bodyStart));
}
function python(code, args) { return spawnSync("python3", ["-c", code, ...args], { encoding: "utf8" }); }
const candidateGuard = pythonBlock('python3 - "$rendered"');
const containerGuard = pythonBlock('python3 - "$inspection"');

function candidate() {
  const hardening = { image, user: "node", cap_drop: ["ALL"], security_opt: ["no-new-privileges:true"] };
  return { name: project, volumes: { "bangla-data": { name: volume } }, networks: { default: { internal: true } }, services: {
    app: { ...hardening, environment: { PUBLIC_ORIGIN: "http://127.0.0.1:3001", NODE_ENV: "production", DATABASE_PATH: "/app/.data/bangla-adventures.db", MEDIA_ROOT: "/app/.data/media" }, volumes: [
      { type: "volume", source: "bangla-data", target: "/app/.data" },
      { type: "bind", source: stage + "/tools/private-staging-verify.mjs", target: "/app/staging-tools/private-staging-verify.mjs", read_only: true },
    ] },
    proxy: { ...hardening, read_only: true, entrypoint: ["node", "/app/staging-tools/private-staging-proxy.mjs"], volumes: [
      { type: "bind", source: stage + "/runtime", target: "/runtime" },
      { type: "bind", source: stage + "/tools/private-staging-proxy.mjs", target: "/app/staging-tools/private-staging-proxy.mjs", read_only: true },
    ] },
  } };
}
function container(service = "app") {
  return {
    Config: { Image: image, User: "node", Labels: { "com.docker.compose.project": project, "com.docker.compose.service": service } },
    HostConfig: { NetworkMode: project + "_default", PortBindings: {}, PublishAllPorts: false, ReadonlyRootfs: service === "proxy" },
    NetworkSettings: { Ports: { "3000/tcp": null } },
    Mounts: service === "app" ? [
      { Type: "volume", Name: volume, Destination: "/app/.data", RW: true },
      { Type: "bind", Source: stage + "/tools/private-staging-verify.mjs", Destination: "/app/staging-tools/private-staging-verify.mjs", RW: false },
    ] : [
      { Type: "bind", Source: stage + "/runtime", Destination: "/runtime", RW: true },
      { Type: "bind", Source: stage + "/tools/private-staging-proxy.mjs", Destination: "/app/staging-tools/private-staging-proxy.mjs", RW: false },
    ],
  };
}

test("candidate guard accepts private Compose and rejects exposure, production mounts and credentials", () => {
  const check = (value) => python(candidateGuard, [JSON.stringify(value), stage, image, volume, project]).status;
  assert.equal(check(candidate()), 0);
  for (const mutate of [
    (v) => { v.services.app.ports = [{ published: "3001", target: 3000 }]; },
    (v) => { v.services.app.network_mode = "host"; },
    (v) => { v.networks.default.internal = false; },
    (v) => { v.volumes["bangla-data"].name = "bangla-adventures_bangla-data"; },
    (v) => { v.services.app.environment.ELEVENLABS_API_KEY = "synthetic-test-key"; },
    (v) => { v.services.app.environment.PUBLIC_ORIGIN = "http://localhost:3001"; },
    (v) => { v.services.proxy.volumes.push({ type: "bind", source: "/run/user/1002/docker.sock", target: "/var/run/docker.sock" }); },
    (v) => { v.services.proxy.entrypoint = ["scripts/docker-start.sh"]; },
    (v) => { v.services.proxy.read_only = false; },
  ]) {
    const value = candidate(); mutate(value); assert.notEqual(check(value), 0);
  }
});

test("actual container guard rejects implicit published ports, host networking and shared production data", () => {
  const check = (value) => python(containerGuard, [JSON.stringify(value), image, project, volume, stage]).status;
  assert.equal(check([container(), container("proxy")]), 0);
  for (const mutate of [
    (c) => { c.HostConfig.PortBindings = { "3000/tcp": [{ HostIp: "127.0.0.1", HostPort: "3001" }] }; },
    (c) => { c.HostConfig.PublishAllPorts = true; },
    (c) => { c.NetworkSettings.Ports = { "3000/tcp": [{ HostIp: "0.0.0.0", HostPort: "49152" }] }; },
    (c) => { c.HostConfig.NetworkMode = "host"; },
    (c) => { c.Mounts[0].Name = "bangla-adventures_bangla-data"; },
    (c) => { c.Config.Labels["com.docker.compose.project"] = "bangla-adventures"; },
    (c) => { c.Config.Image = "ghcr.io/omargad/bangla-adventure:latest"; },
  ]) {
    const value = container(); mutate(value); assert.notEqual(check([value]), 0);
  }
  const proxy = container("proxy"); proxy.Mounts[1].RW = true; assert.notEqual(check([proxy]), 0);
});

test("old or unreviewed image arguments fail before any Docker/SSH or filesystem mutation", () => {
  for (const [ref, commit] of [[image, "9ca8ac88e3bfe4284d9a8226e044ef808576cdff"], ["ghcr.io/omargad/bangla-adventure:latest", revision], [image + "$(touch /tmp/never)", revision]]) {
    const run = spawnSync("bash", ["-c", script, "private-staging-remote.sh", ref, commit, "/nonexistent"], { encoding: "utf8" });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /outside this reviewed staging release/);
  }
});

test("rollback restores only saved staging files/image and retains database state", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bangla-stage-rollback-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const localStage = path.join(root, "stage"), transaction = path.join(localStage, ".transaction.test");
  mkdirSync(path.join(localStage, "tools"), { recursive: true }); mkdirSync(transaction);
  const managed = ["compose.yaml", "private-staging-proxy.mjs", "private-staging-remote.sh", "private-staging-verify.mjs", "private-staging-drill.sh", "private-staging-qa.sh"];
  for (const file of [...managed, "release.json"]) {
    writeFileSync(path.join(transaction, file), "previous " + file);
    writeFileSync(path.join(localStage, file === "compose.yaml" || file === "release.json" ? file : "tools/" + file), "candidate " + file);
  }
  writeFileSync(path.join(root, "data-sentinel"), "keep database and media");
  const finish = script.slice(script.indexOf("finish() {"), script.indexOf("trap finish EXIT"));
  const shell = `set -eu\nstage="$1";transaction="$2";previous="$3";image="$4";login='';keep_transaction=false;touched=true;committed=false;previous_healthy=true\nfiles=(${managed.join(" ")})\nsay(){ :; };stop_own(){ printf 'stop %s\\n' "$1" >> "$stage/events"; };healthy_start(){ printf 'start %s\\n' "$1" >> "$stage/events"; }\n${finish}\ntrap finish EXIT\nexit 1\n`;
  const previous = image.replace(/fc6f5272[0-9a-f]+$/, "d".repeat(64));
  const run = spawnSync("bash", ["-c", shell, "rollback-test", localStage, transaction, previous, image], { encoding: "utf8" });
  assert.equal(run.status, 1, run.stderr);
  assert.equal(readFileSync(path.join(localStage, "compose.yaml"), "utf8"), "previous compose.yaml");
  assert.match(readFileSync(path.join(localStage, "events"), "utf8"), new RegExp("start " + previous));
  assert.equal(readFileSync(path.join(root, "data-sentinel"), "utf8"), "keep database and media");
  assert.equal(existsSync(transaction), false);
});

test("failed first release stops its own project and retains isolated data without inventing a previous release", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bangla-stage-first-failure-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const transaction = path.join(root, ".transaction.test"); mkdirSync(transaction);
  writeFileSync(path.join(root, "data-sentinel"), "retain failed stage state");
  const finish = script.slice(script.indexOf("finish() {"), script.indexOf("trap finish EXIT"));
  const shell = `set -eu\nstage="$1";transaction="$2";image="$3";revision="$4";login='';keep_transaction=false;touched=true;committed=false;previous_healthy=false\nsay(){ :; };stop_own(){ printf 'stop %s\\n' "$1" >> "$stage/events"; };healthy_start(){ printf unexpected-start >> "$stage/events"; };write_manifest(){ printf '%s\\n' "$1" > "$stage/phase"; }\n${finish}\ntrap finish EXIT\nexit 1\n`;
  const run = spawnSync("bash", ["-c", shell, "first-failure-test", root, transaction, image, revision], { encoding: "utf8" });
  assert.equal(run.status, 1, run.stderr);
  assert.equal(readFileSync(path.join(root, "phase"), "utf8").trim(), "failed");
  assert.equal(readFileSync(path.join(root, "data-sentinel"), "utf8"), "retain failed stage state");
  assert.doesNotMatch(readFileSync(path.join(root, "events"), "utf8"), /unexpected-start|9ca8|b86b/);
});

test("parent guard allows root/deployer ownership but refuses an unrelated or world-writable parent", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bangla-stage-parent-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const guard = script.slice(script.indexOf('parent_owner="'), script.indexOf('[[ "$payload"'));
  const shell = `parent="$1";stat(){ if [ "$2" = %u ]; then printf '%s' "$TEST_OWNER"; else printf '%s' "$TEST_MODE"; fi; };fail(){ exit 1; };\n${guard}`;
  for (const [owner, mode, expected] of [["0", "775", 0], ["1002", "750", 0], ["999", "750", 1], ["0", "777", 1], ["1002", "1777", 1]]) {
    const run = spawnSync("bash", ["-c", shell, "parent-test", root], { env: { ...process.env, TEST_OWNER: owner, TEST_MODE: mode }, encoding: "utf8" });
    assert.equal(run.status, expected, `${owner}:${mode} ${run.stderr}`);
  }
});

test("all remote Bash parses and Compose calls suppress dotenv autoload", () => {
  const run = spawnSync("bash", ["-n"], { input: script, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(script, /compose\(\).*--env-file \/dev\/null/);
  assert.ok(script.indexOf('candidate Compose configuration violates') < script.indexOf('mkdir -- "$stage"'), "bad candidate rendering is rejected before first stage creation");
  assert.doesNotMatch(script, /docker (?:system|volume) (?:prune|rm)/);
  assert.doesNotMatch(script, /DEPLOY_ENABLED=true/);
});

test("only the post-drill persistence check force-recreates both staging containers", () => {
  const helper = script.match(/^healthy_start\(\) \{[^\n]+$/m)?.[0];
  assert.ok(helper);
  const run = (extra) => spawnSync("bash", ["-c", `compose(){ printf '%s\\n' "$@"; };\n${helper}\nhealthy_start "$1" ${extra}`, "start-test", image], { encoding: "utf8" });
  const normal = run("");
  const replaced = run("--force-recreate");
  assert.equal(normal.status, 0, normal.stderr);
  assert.equal(replaced.status, 0, replaced.stderr);
  assert.deepEqual(normal.stdout.trim().split("\n"), [image, "up", "--detach", "--no-build", "--wait", "--wait-timeout", "180", "app", "proxy"]);
  assert.deepEqual(replaced.stdout.trim().split("\n"), [image, "up", "--detach", "--no-build", "--force-recreate", "--wait", "--wait-timeout", "180", "app", "proxy"]);
  const drill = script.indexOf('bash "$stage/tools/private-staging-drill.sh"');
  const replace = script.indexOf('healthy_start "$image" --force-recreate');
  const verify = script.indexOf('exec -T app node /app/staging-tools/private-staging-verify.mjs --expected-state-digest');
  assert.ok(drill < replace && replace < verify);
  assert.equal(script.match(/--force-recreate/g)?.length, 1, "initial startup and rollback retain normal behavior");
});

test("container replacement proof uses one canonical app ID rather than ambiguous short selections", () => {
  const helper = script.slice(script.indexOf("app_id() {"), script.indexOf("finish() {"));
  const shell = `fixture_selected="$2";fixture_canonical="$3";compose(){ printf '%s\\n' "$fixture_selected"; };docker(){ printf '%s\\n' "$fixture_canonical"; };fail(){ exit 1; };\n${helper}\napp_id "$1"`;
  for (const [selected, canonical, expected] of [["a".repeat(12), "a".repeat(64), 0], ["a".repeat(12) + "\n" + "b".repeat(12), "a".repeat(64), 1], ["a".repeat(12), "a".repeat(12), 1]]) {
    const run = spawnSync("bash", ["-c", shell, "id-test", image, selected, canonical], { encoding: "utf8" });
    assert.equal(run.status, expected, run.stderr);
    if (!expected) assert.equal(run.stdout.trim(), canonical);
  }
});

test("final proof sanitizes reports and rejects unchanged IDs, changed state or failed restore checks", () => {
  const code = pythonBlock('evidence="$(python3 - "$baseline"');
  const clean = { verified: true, stateDigest: "c".repeat(64), counts: { pendingTopics: 15, pendingLessons: 18, shippedStates: 33, users: 0, approvals: 0, baselines: 0, businessRows: 0, mediaFiles: 0 }, checks: { integrity: true, foreignKeys: true, unpublished: true, cleanIdentities: true, expectedStateMatched: null, databaseWriteRolledBack: true, mediaWriteRemoved: true }, paths: { database: "sensitive-source-path" }, userEmails: ["private@example.test"] };
  const restarted = structuredClone(clean);
  restarted.checks.expectedStateMatched = true; restarted.checks.databaseWriteRolledBack = null; restarted.checks.mediaWriteRemoved = null;
  const drill = { verified: true, checks: { sourceUnchanged: true, cleanSnapshotVerified: true, probeSnapshotVerified: true, probeDatabaseRestored: true, probeMediaRestored: true, cleanOriginalRestored: true, integrity: true, foreignKeys: true, archivesUnchanged: true }, counts: { pendingTopics: 15, pendingLessons: 18, sourceUsers: 0, probeRecords: 3, probeMediaFiles: 2 }, artifactsRetained: false, scope: "disposable clone only", extraPrivateData: "not-for-evidence" };
  const check = (options = {}) => python(code, [JSON.stringify(clean), JSON.stringify(options.drill || drill), JSON.stringify(options.restarted || restarted), "a".repeat(64), options.after || "b".repeat(64), image, revision, project, stage]);
  const valid = check(); assert.equal(valid.status, 0, valid.stderr);
  const result = JSON.parse(valid.stdout);
  assert.equal(result.scope, "private-staging"); assert.equal(result.publishedPorts, 0);
  assert.equal(result.cleanVerifier.stateDigest, result.restartVerifier.stateDigest);
  assert.notEqual(result.containerReplacement.beforeAppId, result.containerReplacement.afterAppId);
  assert.doesNotMatch(valid.stdout, /sensitive-source-path|private@example|not-for-evidence|userEmails/);
  assert.notEqual(check({ after: "a".repeat(64) }).status, 0);
  const changed = structuredClone(restarted); changed.stateDigest = "d".repeat(64);
  assert.notEqual(check({ restarted: changed }).status, 0);
  const failed = structuredClone(drill); failed.checks.sourceUnchanged = false;
  assert.notEqual(check({ drill: failed }).status, 0);
});

test("upgrade backup permissions are set while root owns the isolated directory, including retries", () => {
  const line = script.split("\n").find((value) => value.includes('--volume "$backup_volume:/backups"') && value.includes("--user root"));
  assert.ok(line);
  assert.match(line, /--cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE/);
  assert.doesNotMatch(line, /FOWNER|data_volume|--privileged/);
  const command = line.match(/-c '([^']+)'$/)?.[1];
  assert.ok(command);
  const shell = `fixture_owner="$1";chown(){ [ "$2" = /backups ] || exit 91;fixture_owner="$1";printf 'chown %s %s\\n' "$1" "$2"; };chmod(){ [ "$1" = 0700 ] && [ "$2" = /backups ] && [ "$fixture_owner" = 0:0 ] || exit 92;printf 'chmod %s %s\\n' "$1" "$2"; };\n${command}\n[ "$fixture_owner" = 1000:1000 ]`;
  for (const owner of ["0:0", "1000:1000"]) {
    const run = spawnSync("bash", ["-c", shell, "backup-permission-test", owner], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(run.stdout.trim().split("\n"), ["chown 0:0 /backups", "chmod 0700 /backups", "chown 1000:1000 /backups"]);
  }
  const stop = script.indexOf('stop_own "$previous"', script.indexOf('transaction="$(mktemp'));
  const backup = script.indexOf('scripts/backup.sh /backups 14 --application-stopped', stop);
  const swap = script.indexOf('cp -- "$payload/compose.yaml"', backup);
  assert.ok(stop < backup && backup < swap);
});

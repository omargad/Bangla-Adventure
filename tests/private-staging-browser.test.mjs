import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const qaId = "a".repeat(24);
const stage = { users: 0, pendingTopics: 15, pendingLessons: 18 };
const valid = {
  verified: true, qaId, kind: "bangla-private-qa", isolated: true,
  imageDigest: "sha256:fc6f52720d3ecf55998e56a2432ffd5a782d3db231323874daf0b6d0357efca2",
  baseURL: "http://127.0.0.1:3001", socket: `/private/qa-${qaId}/http.sock`,
  actualStage: stage, qa: { users: 0, pendingTopics: 15, pendingLessons: 18 },
};

function refused(verify, { baseURL = valid.baseURL, id = qaId, cleanupVerified = true } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bangla-private-browser-"));
  try {
    const controller = path.join(directory, "controller.mjs"), calls = path.join(directory, "calls");
    const cleanup = { verified: cleanupVerified, qaId, removed: cleanupVerified, actualStage: stage };
    fs.writeFileSync(controller, `#!/usr/bin/env node
import fs from 'node:fs';
fs.appendFileSync(${JSON.stringify(calls)}, process.argv[2] + '\\n');
console.log(JSON.stringify(process.argv[2] === 'verify' ? ${JSON.stringify(verify)} : ${JSON.stringify(cleanup)}));
`, { mode: 0o700 });
    const run = spawnSync(process.execPath, ["tests/staging/browser-auth-smoke.mjs"], {
      cwd: root, encoding: "utf8", timeout: 15_000,
      env: {
        ...process.env, PRIVATE_QA_ID: id, PRIVATE_QA_BASE_URL: baseURL,
        PRIVATE_QA_CONTROLLER: controller, PRIVATE_QA_ARTIFACTS: path.join(directory, "artifacts"),
        PLAYWRIGHT_CHROMIUM_PATH: "/nonexistent-browser-must-not-launch",
      },
    });
    assert.equal(run.status, 1, "a refused guard must fail the job");
    const report = JSON.parse(run.stdout);
    assert.equal(report.passed, false);
    assert.deepEqual(report.roles, []);
    assert.equal(fs.existsSync(path.join(directory, "artifacts")), false, "no identity screenshots or reports precede successful verification");
    const actions = fs.existsSync(calls) ? fs.readFileSync(calls, "utf8").trim().split("\n") : [];
    assert.ok(!actions.includes("approve-fixtures"), "a refused guard never approves any identity");
    return { report, actions };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test("private browser auth refuses missing clone identity and a different loopback origin before calling a controller", () => {
  for (const options of [{ id: "" }, { baseURL: "http://localhost:3001" }, { baseURL: "https://127.0.0.1:3001" }]) {
    const { report, actions } = refused(valid, options);
    assert.equal(report.failedStep, "configuration");
    assert.deepEqual(actions, []);
  }
});

test("a refused clone attestation prevents browser/signup mutations and still requests guarded cleanup", () => {
  const { report, actions } = refused({ verified: false, qaId });
  assert.equal(report.failedStep, "verify-clean-clone");
  assert.equal(report.cleanupVerified, true);
  assert.deepEqual(actions, ["verify", "cleanup"]);
});

test("unsafe clone image, socket, real-stage identities and publication counts all fail before browser launch", () => {
  for (const proof of [
    { ...valid, imageDigest: `sha256:${"0".repeat(64)}` },
    { ...valid, socket: "/private/actual-stage/http.sock" },
    { ...valid, actualStage: { ...stage, users: 1 } },
    { ...valid, actualStage: { ...stage, pendingLessons: 17 } },
    { ...valid, qa: { ...valid.qa, users: 2 } },
  ]) {
    const { report, actions } = refused(proof);
    assert.equal(report.failedStep, "verify-clean-clone");
    assert.equal(report.cleanupVerified, true);
    assert.deepEqual(actions, ["verify", "cleanup"]);
  }
});

test("a cleanup failure cannot produce a successful QA browser report", () => {
  const { report, actions } = refused({ verified: false, qaId }, { cleanupVerified: false });
  assert.equal(report.failedStep, "cleanup");
  assert.equal(report.cleanupVerified, false);
  assert.deepEqual(actions, ["verify", "cleanup"]);
});

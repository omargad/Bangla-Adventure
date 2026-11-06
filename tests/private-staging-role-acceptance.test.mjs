import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { acceptanceIdentities, ROLE_SCREENSHOTS } from "./staging/role-acceptance-scenario.mjs";
import { isPublicPath } from "../lib/learning-policy.ts";

const root = fileURLToPath(new URL("..", import.meta.url)), qaId = "a".repeat(24);
const clean = { users: 0, pendingTopics: 15, pendingLessons: 18 };
const proof = { verified: true, qaId, kind: "bangla-private-qa", isolated: true, imageDigest: "sha256:fc6f52720d3ecf55998e56a2432ffd5a782d3db231323874daf0b6d0357efca2", baseURL: "http://127.0.0.1:3001", socket: `/private/${qaId}/http.sock`, actualStage: clean, qa: clean };

test("four-role fixture identities are a bounded disposable namespace with one pending fourth student", () => {
  const value = acceptanceIdentities(qaId);
  assert.equal(new Set([value.admin.email, value.teacher.email, value.parent.email]).size, 3);
  assert.equal(new Set(value.students.map((item) => item.username)).size, 4);
  assert.ok(value.students.every((item) => item.username.length <= 40 && item.username.startsWith(`qa-${qaId}-student`)));
  assert.equal(ROLE_SCREENSHOTS.length, 12);
  assert.ok(ROLE_SCREENSHOTS.every((name) => /^(admin|teacher|student|parent)-[a-z-]+\.png$/.test(name)));
  assert.throws(() => acceptanceIdentities("other-site"));
});

test("anonymous clone identity stays on the existing public robots asset", () => {
  assert.equal(isPublicPath(new URL("/robots.txt", proof.baseURL)), true);
  assert.equal(isPublicPath(new URL("/__private-staging-qa.json", proof.baseURL)), false);
});

function refuse(value, { baseURL = proof.baseURL, cleanup = true } = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "bangla-role-guard-"));
  try {
    const controller = path.join(folder, "controller.mjs"), calls = path.join(folder, "calls"), artifacts = path.join(folder, "artifacts");
    fs.writeFileSync(controller, `#!/usr/bin/env node\nimport fs from 'node:fs';\nfs.appendFileSync(${JSON.stringify(calls)},process.argv[2]+'\\n');\nconsole.log(JSON.stringify(process.argv[2]==='cleanup'?${JSON.stringify({ verified: cleanup, qaId, removed: cleanup, actualStage: clean })}:${JSON.stringify(value)}));\n`, { mode: 0o700 });
    const run = spawnSync(process.execPath, ["tests/staging/browser-role-acceptance.mjs"], { cwd: root, encoding: "utf8", timeout: 15_000, env: { ...process.env, PRIVATE_QA_ID: qaId, PRIVATE_QA_BASE_URL: baseURL, PRIVATE_QA_CONTROLLER: controller, PRIVATE_QA_ARTIFACTS: artifacts, PLAYWRIGHT_CHROMIUM_PATH: "/nonexistent-browser-must-not-launch" } });
    assert.equal(run.status, 1);
    const report = JSON.parse(run.stdout);
    assert.equal(report.passed, false); assert.deepEqual(report.roles, []);
    assert.equal(fs.existsSync(artifacts), false, "no browser or signup artifacts may precede a verified empty clone");
    const actions = fs.existsSync(calls) ? fs.readFileSync(calls, "utf8").trim().split("\n") : [];
    assert.equal(actions.includes("bootstrap-admin"), false);
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE_FIXTURE_SECRET/);
    return { report, actions };
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
}

test("untrusted clone image, real-stage accounts and unexpected initial fixture data prevent every mutation", () => {
  for (const value of [{ ...proof, imageDigest: `sha256:${"0".repeat(64)}` }, { ...proof, actualStage: { ...clean, users: 1 } }, { ...proof, qa: { ...clean, users: 7 } }, { ...proof, qa: { ...clean, pendingTopics: 14 } }, { verified: false, qaId, secret: "PRIVATE_FIXTURE_SECRET" }]) {
    const { report, actions } = refuse(value);
    assert.equal(report.failedStep, "verify-clean-clone");
    assert.equal(report.cleanupVerified, true);
    assert.deepEqual(actions, ["verify", "cleanup"]);
  }
});

test("a different loopback origin is refused before controller contact", () => {
  const { actions } = refuse(proof, { baseURL: "http://localhost:3001" });
  assert.deepEqual(actions, []);
});

test("failed cleanup cannot be reported as completed acceptance", () => {
  const { report } = refuse({ verified: false, qaId }, { cleanup: false });
  assert.equal(report.failedStep, "cleanup"); assert.equal(report.cleanupVerified, false);
});

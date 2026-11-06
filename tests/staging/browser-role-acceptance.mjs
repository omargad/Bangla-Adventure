#!/usr/bin/env node
// Four-role acceptance only on a positively attested disposable QA namespace.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { runRoleAcceptance, ROLE_PHASES, ROLE_OPERATIONS, SAFE_ROLE_ERRORS } from "./role-acceptance-scenario.mjs";

const BASE = "http://127.0.0.1:3001";
const REVISION = "95b6308ac7ad3d5b6bb2d951df9d65a23ff77107";
const IMAGE = "sha256:fc6f52720d3ecf55998e56a2432ffd5a782d3db231323874daf0b6d0357efca2";
const qaId = process.env.PRIVATE_QA_ID, controller = process.env.PRIVATE_QA_CONTROLLER, artifacts = process.env.PRIVATE_QA_ARTIFACTS;
const stageClean = (value) => value?.users === 0 && value.pendingTopics === 15 && value.pendingLessons === 18;
const refuse = () => { throw new Error("guard-refused"); };
const report = { kind: "disposable-qa-role-acceptance", passed: false, origin: BASE, revision: REVISION, imageDigest: IMAGE, roles: [], cleanupVerified: false };
let browser, directory, mayCleanup = false, step = "verify-clean-clone", operation;

async function hook(action) {
  const value = await new Promise((resolve, reject) => {
    const child = execFile(controller, [action, qaId], { timeout: 90_000, maxBuffer: 128 * 1024 }, (error, stdout) => {
      if (error) { reject(new Error("guard-refused")); return; }
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error("guard-refused")); }
    });
    child.stdin.end();
  });
  if (value.verified !== true || value.qaId !== qaId) refuse();
  return value;
}

async function verifyController(expected) {
  const proof = await hook("verify");
  if (proof.kind !== "bangla-private-qa" || proof.isolated !== true || proof.imageDigest !== IMAGE || proof.baseURL !== BASE) refuse();
  if (typeof proof.socket !== "string" || !path.isAbsolute(proof.socket) || !proof.socket.includes(qaId) || !proof.socket.endsWith(".sock")) refuse();
  if (!stageClean(proof.actualStage)) refuse();
  if (proof.qa?.users !== expected.users || proof.qa.pendingTopics !== expected.pendingTopics || proof.qa.pendingLessons !== expected.pendingLessons) refuse();
}

async function verifyHttp(page, expected) {
  await verifyController(expected);
  const proof = await page.evaluate(async () => {
    const response = await fetch("/robots.txt", { cache: "no-store", credentials: "omit" });
    if (response.status !== 200 || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "text/plain") return null;
    return response.json();
  });
  if (proof?.qa !== true || proof.qa_id !== qaId || proof.expectedrevision !== REVISION || Object.keys(proof).sort().join(",") !== "expectedrevision,qa,qa_id") refuse();
}

try {
  if (!/^[a-f0-9]{24}$/.test(qaId ?? "") || process.env.PRIVATE_QA_BASE_URL !== BASE) refuse();
  if (typeof controller !== "string" || !path.isAbsolute(controller) || !fs.statSync(controller).isFile()) refuse();
  fs.accessSync(controller, fs.constants.X_OK);
  if (typeof artifacts !== "string" || !path.isAbsolute(artifacts)) refuse();
  mayCleanup = true;
  await verifyController({ users: 0, pendingTopics: 15, pendingLessons: 18 });
  directory = path.join(artifacts, `role-acceptance-${qaId}`);
  fs.mkdirSync(directory, { recursive: true });
  step = "browser-start";
  browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {});
  const result = await runRoleAcceptance({
    browser, baseURL: BASE, qaId, outputDirectory: directory, guard: verifyHttp,
    bootstrapAdmin: async () => {
      const proof = await hook("bootstrap-admin");
      if (proof.bootstrapAdmin !== true || proof.approvedAdults !== 1 || proof.approvedStudents !== 0 || proof.noContentApprovals !== true) refuse();
    },
    onPhase: (value) => { if (!ROLE_PHASES.includes(value)) refuse(); step = value; },
    onOperation: (value) => { if (!ROLE_OPERATIONS.includes(value)) refuse(); operation = value; },
    onStatus: (value) => { if (!Number.isInteger(value) || value < 100 || value > 599) refuse(); report.loginResponseStatus = value; },
  });
  Object.assign(report, result, { passed: true });
} catch (error) {
  report.failedStep = ROLE_PHASES.includes(step) ? step : "verify-clean-clone";
  if (ROLE_OPERATIONS.includes(operation)) report.failedOperation = operation;
  report.errorCode = SAFE_ROLE_ERRORS.has(error?.message) ? error.message : "browser-operation-failed";
} finally {
  if (browser) await browser.close().catch(() => {});
  if (mayCleanup) {
    try {
      const value = await hook("cleanup");
      if (value.removed !== true || !stageClean(value.actualStage)) refuse();
      report.cleanupVerified = true;
      report.actualStageAfterCleanup = { users: 0, pendingTopics: 15, pendingLessons: 18 };
    } catch {
      report.passed = false;
      report.failedStep = "cleanup";
      report.errorCode = "guard-refused";
    }
  }
  report.passed = report.passed && report.cleanupVerified;
  if (directory) fs.writeFileSync(path.join(directory, "result.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
  if (!report.passed) process.exitCode = 1;
}

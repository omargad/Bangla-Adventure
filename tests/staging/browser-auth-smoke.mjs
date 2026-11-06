#!/usr/bin/env node
// Fictional accounts on a marked disposable clone only. Never run against staging itself.
// The controller prepares/forwards the clone first and independently repeats cleanup in its own trap.
// Required env: PRIVATE_QA_ID, PRIVATE_QA_CONTROLLER, PRIVATE_QA_BASE_URL, PRIVATE_QA_ARTIFACTS.
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const BASE = "http://127.0.0.1:3001";
const REVISION = "95b6308ac7ad3d5b6bb2d951df9d65a23ff77107";
const IMAGE = "sha256:fc6f52720d3ecf55998e56a2432ffd5a782d3db231323874daf0b6d0357efca2";
const qaId = process.env.PRIVATE_QA_ID;
const controller = process.env.PRIVATE_QA_CONTROLLER;
const artifacts = process.env.PRIVATE_QA_ARTIFACTS;
const check = (condition, code) => { if (!condition) throw new Error(code); };
const stageClean = (stage) => stage?.users === 0 && stage.pendingTopics === 15 && stage.pendingLessons === 18;
const report = { kind: "disposable-qa-browser-auth", passed: false, origin: BASE, revision: REVISION, imageDigest: IMAGE, roles: [], cleanupVerified: false };
let browser, directory, mayCleanup = false, step = "configuration";

/** The controller is a constrained executable; secrets never enter its argv/stdin/output. */
async function hook(action) {
  const response = await new Promise((resolve, reject) => {
    const child = execFile(controller, [action, qaId], { timeout: 60_000, maxBuffer: 64 * 1024 }, (error, stdout) => {
      if (error) { reject(new Error("controller-operation-failed")); return; }
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error("controller-invalid-response")); }
    });
    child.stdin.end();
  });
  check(response.verified === true && response.qaId === qaId, "controller-identity-mismatch");
  return response;
}

async function verifyController(expectedUsers) {
  const proof = await hook("verify");
  check(proof.kind === "bangla-private-qa" && proof.isolated === true, "isolated-clone-required");
  check(proof.imageDigest === IMAGE && proof.baseURL === BASE, "clone-image-or-origin-mismatch");
  check(typeof proof.socket === "string" && path.isAbsolute(proof.socket) && proof.socket.includes(qaId) && proof.socket.endsWith(".sock"), "clone-socket-mismatch");
  check(stageClean(proof.actualStage), "actual-stage-is-not-clean");
  check(proof.qa?.users === expectedUsers && proof.qa.pendingTopics === 15 && proof.qa.pendingLessons === 18, "unexpected-clone-counts");
}

/** Check the actual forwarded HTTP server as well as the independent SSH/Docker attestation. */
async function verifyHttp(page, expectedUsers) {
  await verifyController(expectedUsers);
  const proof = await page.evaluate(async () => {
    // Only the disposable clone replaces this existing public file with its identity document.
    const response = await fetch("/robots.txt", { cache: "no-store", credentials: "omit" });
    if (response.status !== 200 || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "text/plain") return null;
    return response.json();
  });
  check(proof?.qa === true && proof.qa_id === qaId && proof.expectedrevision === REVISION, "forwarded-clone-marker-mismatch");
  check(Object.keys(proof).sort().join(",") === "expectedrevision,qa,qa_id", "unexpected-clone-marker");
}

async function newPage() {
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1365, height: 960 }, locale: "en-AU" });
  // All credentials and navigation stay on the exact private loopback origin.
  await context.route("**/*", (route) => new URL(route.request().url()).origin === BASE ? route.continue() : route.abort());
  const page = await context.newPage();
  await page.goto("/welcome", { waitUntil: "domcontentloaded" });
  return { context, page };
}

async function signUp(page, kind, password) {
  const adult = kind === "parent";
  const payload = adult
    ? { email: `qa-${qaId}@example.invalid`, displayName: "QA Parent", password, accountType: "parent" }
    : { username: `qa-${qaId}-student`, displayName: "QA Student", password };
  const result = await page.evaluate(async ({ endpoint, payload, adult }) => {
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json();
    // Recovery codes/passwords/cookie values never leave the page as test output.
    return { status: response.status, pending: body.pendingApproval === true, registered: typeof (adult ? body.adult?.id : body.student?.id) === "string" };
  }, { endpoint: adult ? "/api/auth/sign-up" : "/api/student/sign-up", payload, adult });
  check(result.status === 201 && result.pending && result.registered, "fixture-signup-did-not-wait-for-approval");
}

async function authenticated(page, role) {
  const state = await page.evaluate(async () => (await fetch("/api/auth/session", { cache: "no-store" })).json());
  check(state.authenticated === true && state.role === role, "browser-session-not-persisted");
}

async function loginAndCapture({ context, page }, role, password) {
  const adult = role === "parent";
  await page.goto(adult ? "/grown-ups?returnTo=%2Ffamily" : "/student", { waitUntil: "domcontentloaded" });
  await page.getByLabel(adult ? "Email" : "Username", { exact: true }).fill(adult ? `qa-${qaId}@example.invalid` : `qa-${qaId}-student`);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  if (adult) await page.waitForURL(`${BASE}/family`);
  else await page.getByRole("heading", { name: "My Learning", exact: true }).waitFor();
  await authenticated(page, role);
  const name = adult ? "ba_adult_session" : "ba_student_session";
  // Inspect the isolated jar directly: Playwright's HTTP URL filter excludes Secure 127.0.0.1 cookies.
  const cookie = (await context.cookies()).find((item) => item.name === name && item.domain === "127.0.0.1");
  check(cookie?.secure === true && cookie.httpOnly === true && cookie.sameSite === "Lax" && cookie.domain === "127.0.0.1" && cookie.path === "/", "secure-session-cookie-required");
  check(await page.evaluate((name) => !document.cookie.split(";").some((part) => part.trim().startsWith(`${name}=`)), name), "session-cookie-readable-by-script");
  await page.reload({ waitUntil: "domcontentloaded" });
  await authenticated(page, role);
  check((await context.cookies()).find((item) => item.name === name && item.domain === "127.0.0.1")?.value === cookie.value, "session-cookie-lost-on-reload");
  check(await page.locator('input[type="password"]').count() === 0, "credentials-form-still-visible");
  await page.evaluate((role) => {
    const banner = document.createElement("div");
    banner.textContent = `DISPOSABLE QA CLONE — FICTIONAL ${role.toUpperCase()} — NOT ACTUAL STAGING USERS`;
    banner.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#132d46;color:white;padding:12px;text-align:center;font:bold 14px sans-serif";
    document.body.prepend(banner);
    document.body.style.paddingTop = "44px";
  }, role);
  await page.screenshot({ path: path.join(directory, `qa-${role}.png`), fullPage: true });
  report.roles.push({ role, realFormLogin: true, secureHttpOnlyCookie: true, cookieSurvivedReload: true, serverSessionAuthenticated: true });
}

try {
  check(/^[a-f0-9]{24}$/.test(qaId ?? ""), "invalid-qa-id");
  check(process.env.PRIVATE_QA_BASE_URL === BASE, "exact-loopback-origin-required");
  check(typeof controller === "string" && path.isAbsolute(controller) && fs.statSync(controller).isFile(), "absolute-controller-required");
  fs.accessSync(controller, fs.constants.X_OK);
  check(typeof artifacts === "string" && path.isAbsolute(artifacts), "absolute-artifact-directory-required");
  mayCleanup = true;
  step = "verify-clean-clone";
  await verifyController(0); // No browser, signup or identity mutation precedes this check.
  directory = path.join(artifacts, `qa-browser-${qaId}`);
  fs.mkdirSync(directory, { recursive: true });
  step = "browser-start";
  browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {});
  const parent = await newPage(), student = await newPage();
  const parentPassword = randomBytes(24).toString("base64url"), studentPassword = randomBytes(24).toString("base64url");
  step = "guarded-fixture-signups";
  await verifyHttp(parent.page, 0);
  await signUp(parent.page, "parent", parentPassword);
  await verifyHttp(student.page, 1);
  await signUp(student.page, "student", studentPassword);
  await verifyHttp(parent.page, 2);
  step = "fixture-approval";
  const approval = await hook("approve-fixtures");
  check(approval.approvedAdults === 1 && approval.approvedStudents === 1 && approval.noContentApprovals === true, "fixture-approval-mismatch");
  await verifyHttp(parent.page, 2);
  step = "parent-browser-login";
  await loginAndCapture(parent, "parent", parentPassword);
  step = "student-browser-login";
  await loginAndCapture(student, "student", studentPassword);
  step = "final-clone-counts";
  await verifyController(2);
  report.fixtureCounts = { adults: 1, students: 1, pendingTopics: 15, pendingLessons: 18, contentApprovals: 0 };
  report.passed = true;
} catch {
  // Do not serialize Playwright diagnostics, response bodies, credentials or environment.
  report.failedStep = step;
  report.error = "Private QA browser authentication proof failed; inspect only sanitized controller status.";
} finally {
  if (browser) await browser.close().catch(() => {});
  if (mayCleanup) {
    try {
      const cleanup = await hook("cleanup");
      check(cleanup.removed === true && stageClean(cleanup.actualStage), "cleanup-or-actual-stage-verification-failed");
      report.cleanupVerified = true;
      report.actualStageAfterCleanup = { users: 0, pendingTopics: 15, pendingLessons: 18 };
    } catch {
      report.passed = false;
      report.failedStep = "cleanup";
      report.error = "Private QA cleanup or unchanged actual-stage verification failed.";
    }
  }
  report.passed = report.passed && report.cleanupVerified;
  if (directory) fs.writeFileSync(path.join(directory, "result.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
  if (!report.passed) process.exitCode = 1;
}

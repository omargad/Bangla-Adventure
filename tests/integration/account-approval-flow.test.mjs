import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import Database from "better-sqlite3";

/**
 * Self sign-up for students, parents and teachers waits for an administrator: no session starts,
 * sign-in and recovery explain why, and the administrator approves or declines from one queue.
 * The very first owner is approved by the server-side admin grant.
 */

const PORT = 3230;
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = new URL("../..", import.meta.url).pathname;
const stateDir = mkdtempSync(path.join(tmpdir(), "bangla-approval-"));
const DATABASE_PATH = path.join(stateDir, "test.db");
const password = "integration-approval-password";
let server, adminCookie, teacherCookie, parentCodes;
const ids = {};

const cookieFrom = (response, name = "ba_adult_session") => response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`))?.split(";")[0];
const send = (route, method = "GET", body, cookie, headers = {}) => fetch(`${BASE}${route}`, { method, redirect: "manual", headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const fixture = (callback) => { const db = new Database(DATABASE_PATH); try { return callback(db); } finally { db.close(); } };
const actions = (targetId) => fixture((db) => db.prepare("SELECT action FROM user_audit_events WHERE target_id = ? ORDER BY created_at, rowid").all(targetId).map((row) => row.action));
const adultSignIn = (email, secret = password, device = email) => send("/api/auth/sign-in", "POST", { email, password: secret }, undefined, { "x-forwarded-for": `approval-${device}` });
const studentSignIn = (username, secret = password) => send("/api/student/sign-in", "POST", { username, password: secret }, undefined, { "x-forwarded-for": `approval-${username}` });
const recover = (email, recoveryCode, newPassword) => send("/api/auth/recover", "POST", { email, recoveryCode, newPassword }, undefined, { "x-forwarded-for": `approval-recover-${email}` });
const decide = (id, kind, action) => send(`/api/admin/users/${id}`, "PATCH", { kind, action }, adminCookie);

async function expectWaiting(response, approvalStatus = "pending") {
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.approvalStatus, approvalStatus);
  assert.match(body.error, approvalStatus === "pending" ? /waiting for an administrator to approve it/ : /not approved this account/);
  assert.equal(cookieFrom(response), undefined, "no adult session");
  assert.equal(cookieFrom(response, "ba_student_session"), undefined, "no student session");
}

before(async () => {
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: "production", PLATFORM_MODE: "legacy", DATABASE_PATH, MEDIA_ROOT: path.join(stateDir, "media") }, stdio: "ignore",
  });
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch (error) { if (server.exitCode !== null) throw error; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Isolated approval server did not start.");
});
after(async () => {
  if (server && server.exitCode === null) { const closed = once(server, "exit"); server.kill("SIGTERM"); await closed; }
  rmSync(stateDir, { recursive: true, force: true });
});

test("the very first owner registers, waits, and the server-side grant approves them", async () => {
  const signUp = await send("/api/auth/sign-up", "POST", { email: "owner@example.com", displayName: "Owner", password }, undefined, { "x-forwarded-for": "approval-owner" });
  assert.equal(signUp.status, 201);
  assert.equal(cookieFrom(signUp), undefined);
  await expectWaiting(await adultSignIn("owner@example.com"));
  const grant = spawnSync(process.execPath, ["--import", "tsx", "scripts/grant-admin.ts", "owner@example.com"], { cwd: ROOT, env: { ...process.env, DATABASE_PATH }, encoding: "utf8" });
  assert.equal(grant.status, 0, grant.stderr);
  assert.match(grant.stdout, /granted and the account approved/);
  const signIn = await adultSignIn("owner@example.com");
  assert.equal(signIn.status, 200);
  assert.equal((await signIn.json()).adult.role, "admin");
  adminCookie = cookieFrom(signIn);
  assert.equal((await send("/api/admin/users", "GET", undefined, adminCookie)).status, 200);
});

test("self-registered students, parents and teachers wait for approval and cannot sign in or recover", async () => {
  const student = await send("/api/student/sign-up", "POST", { username: "waiting-child", displayName: "Waiting Child", password }, undefined, { "x-forwarded-for": "approval-child" });
  assert.equal(student.status, 201);
  assert.equal(cookieFrom(student, "ba_student_session"), undefined, "no session starts");
  const studentBody = await student.json();
  assert.equal(studentBody.pendingApproval, true);
  assert.match(studentBody.message, /waiting for an administrator/);
  ids.student = studentBody.student.id;
  await expectWaiting(await studentSignIn("waiting-child"));
  assert.equal((await studentSignIn("waiting-child", "wrong-password")).status, 401, "a wrong password learns nothing about approval");

  const parent = await send("/api/auth/sign-up", "POST", { email: "waiting-parent@example.com", displayName: "Waiting Parent", password }, undefined, { "x-forwarded-for": "approval-parent" });
  assert.equal(parent.status, 201);
  const parentBody = await parent.json();
  assert.equal(parentBody.pendingApproval, true);
  assert.equal(parentBody.recoveryCodes.length, 8, "the owner's own recovery codes are shown once");
  parentCodes = parentBody.recoveryCodes;
  ids.parent = parentBody.adult.id;
  assert.equal(cookieFrom(parent), undefined);
  await expectWaiting(await adultSignIn("waiting-parent@example.com"));
  await expectWaiting(await recover("waiting-parent@example.com", parentCodes[0], "a-new-password-1"));
  assert.equal((await recover("waiting-parent@example.com", "AAAAA-BBBBB", "a-new-password-1")).status, 401);

  const teacher = await send("/api/auth/sign-up", "POST", { email: "waiting-teacher@example.com", displayName: "Waiting Teacher", password, accountType: "teacher" }, undefined, { "x-forwarded-for": "approval-teacher" });
  assert.equal(teacher.status, 201);
  ids.teacher = (await teacher.json()).adult.id;
  await expectWaiting(await adultSignIn("waiting-teacher@example.com"));

  const listing = await (await send("/api/admin/users", "GET", undefined, adminCookie)).json();
  assert.equal(listing.stats.pending, 3);
  // Oldest first; the three were created within a second or two of each other, so compare without order.
  const queue = new Map(listing.approvals.users.map((user) => [user.id, user]));
  assert.equal(queue.size, 3);
  assert.equal(queue.get(ids.student).kind, "student");
  assert.equal(queue.get(ids.parent).kind, "adult");
  assert.equal(queue.get(ids.teacher).teacherStatus, "pending");
  assert.ok(!JSON.stringify(listing).includes("scrypt:"));
  const students = await (await send("/api/admin/users?kind=student&filter=pending", "GET", undefined, adminCookie)).json();
  assert.deepEqual(students.users.map((user) => user.username), ["waiting-child"]);
});

test("waiting accounts cannot be allocated to a class or linked to a child", async () => {
  const created = await send("/api/classes", "POST", { name: "Approval class" }, adminCookie);
  assert.equal(created.status, 201);
  ids.class = (await created.json()).class.id;
  const allocate = await send(`/api/classes/${ids.class}/students`, "POST", { username: "waiting-child" }, adminCookie);
  assert.equal(allocate.status, 404);
  const link = await send("/api/admin/family-links", "POST", { studentId: ids.student, parentEmail: "waiting-parent@example.com", confirmed: true }, adminCookie);
  assert.equal(link.status, 404);
});

test("approval lets each account sign in, and approving a teacher request makes a teacher", async () => {
  for (const [id, kind] of [[ids.student, "student"], [ids.parent, "adult"], [ids.teacher, "adult"]]) assert.equal((await decide(id, kind, "approve")).status, 200);
  assert.equal((await decide(ids.student, "student", "approve")).status, 409, "already approved");

  const student = await studentSignIn("waiting-child");
  assert.equal(student.status, 200);
  assert.equal((await send("/api/student/feed", "GET", undefined, cookieFrom(student, "ba_student_session"))).status, 200);
  assert.equal((await send(`/api/classes/${ids.class}/students`, "POST", { username: "waiting-child" }, adminCookie)).status, 200, "an approved student can be allocated");

  const parent = await adultSignIn("waiting-parent@example.com");
  assert.equal(parent.status, 200);
  assert.equal((await send("/api/family", "GET", undefined, cookieFrom(parent))).status, 200);
  const recovered = await recover("waiting-parent@example.com", parentCodes[0], "a-new-password-1");
  assert.equal(recovered.status, 200, "the code kept while waiting works once approved");
  assert.equal((await recovered.json()).recoveryCodes, undefined, "the owner's own codes are not replaced");

  const teacher = await adultSignIn("waiting-teacher@example.com");
  assert.equal(teacher.status, 200);
  assert.equal((await teacher.json()).adult.role, "teacher");
  teacherCookie = cookieFrom(teacher);
  assert.equal((await send("/api/classes", "POST", { name: "Approved teacher class" }, teacherCookie)).status, 201);

  assert.deepEqual(actions(ids.student), ["account-approved", "class-allocated"]);
  assert.deepEqual(actions(ids.parent), ["account-approved"]);
  assert.deepEqual(actions(ids.teacher), ["approve"]);
  const details = fixture((db) => JSON.parse(db.prepare("SELECT details_json FROM user_audit_events WHERE target_id = ? AND action = 'approve'").get(ids.teacher).details_json));
  assert.equal(details.approvalStatus, "approved");
  assert.equal((await (await send("/api/admin/users", "GET", undefined, adminCookie)).json()).stats.pending, 0);
});

test("a declined account cannot sign in until an administrator approves it later", async () => {
  const signUp = await send("/api/auth/sign-up", "POST", { email: "declined@example.com", displayName: "Declined Parent", password }, undefined, { "x-forwarded-for": "approval-declined" });
  const { adult, recoveryCodes } = await signUp.json();
  const child = await send("/api/student/sign-up", "POST", { username: "declined-child", displayName: "Declined Child", password }, undefined, { "x-forwarded-for": "approval-declined-child" });
  const childId = (await child.json()).student.id;
  assert.equal((await decide(adult.id, "adult", "reject")).status, 200);
  assert.equal((await decide(childId, "student", "reject")).status, 200);
  assert.equal((await decide(adult.id, "adult", "reject")).status, 409);
  await expectWaiting(await adultSignIn("declined@example.com"), "declined");
  await expectWaiting(await recover("declined@example.com", recoveryCodes[0], "another-password-1"), "declined");
  await expectWaiting(await studentSignIn("declined-child"), "declined");
  const declined = await (await send("/api/admin/users?kind=adult&filter=declined", "GET", undefined, adminCookie)).json();
  assert.deepEqual(declined.users.map((user) => user.email), ["declined@example.com"]);

  assert.equal((await decide(adult.id, "adult", "approve")).status, 200);
  assert.equal((await adultSignIn("declined@example.com")).status, 200);
  assert.equal((await decide(childId, "student", "approve")).status, 200);
  assert.equal((await studentSignIn("declined-child")).status, 200);
  assert.deepEqual(actions(adult.id), ["account-declined", "account-approved"]);
});

test("only administrators decide approvals", async () => {
  const signUp = await send("/api/auth/sign-up", "POST", { email: "another@example.com", displayName: "Another Parent", password }, undefined, { "x-forwarded-for": "approval-another" });
  const { adult } = await signUp.json();
  assert.equal((await send(`/api/admin/users/${adult.id}`, "PATCH", { kind: "adult", action: "approve" }, teacherCookie)).status, 403);
  assert.equal((await send(`/api/admin/users/${adult.id}`, "PATCH", { kind: "adult", action: "approve" })).status, 401);
  await expectWaiting(await adultSignIn("another@example.com"));
});

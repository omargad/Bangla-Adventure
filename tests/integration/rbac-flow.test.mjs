import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import Database from "better-sqlite3";

const PORT = 3213;
const BASE = `http://127.0.0.1:${PORT}`;
const stateDir = mkdtempSync(path.join(tmpdir(), "bangla-rbac-"));
let server;
const password = "integration-role-password";
let adminCookie, parentCookie, pendingCookie, teacherCookie, studentCookie, parentId, pendingId, studentId, classId;

const cookieFrom = (response, name = "ba_adult_session") => response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`))?.split(";")[0];
const send = (route, method = "GET", body, cookie, headers = {}) => fetch(`${BASE}${route}`, { method, redirect: "manual", headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });

before(async () => {
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(PORT)], {
    cwd: new URL("../..", import.meta.url).pathname,
    env: { ...process.env, NODE_ENV: "production", PLATFORM_MODE: "legacy", DATABASE_PATH: path.join(stateDir, "test.db"), MEDIA_ROOT: path.join(stateDir, "media") }, stdio: "ignore",
  });
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch (error) { if (server.exitCode !== null) throw error; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Isolated RBAC server did not start.");
});
after(async () => {
  if (server && server.exitCode === null) { const closed = once(server, "exit"); server.kill("SIGTERM"); await closed; }
  rmSync(stateDir, { recursive: true, force: true });
});

test("public registration cannot assign role, approval or account status", async () => {
  const response = await send("/api/auth/sign-up", "POST", { email: "parent@example.com", displayName: "Parent", password, role: "admin", teacherStatus: "approved", status: "active" });
  assert.equal(response.status, 201);
  const { adult } = await response.json();
  assert.equal(adult.role, "parent");
  assert.equal(adult.teacherStatus, "none");
  parentCookie = cookieFrom(response); parentId = adult.id;
  const flags = response.headers.get("set-cookie");
  assert.match(flags, /httponly/i); assert.match(flags, /secure/i); assert.match(flags, /samesite=lax/i);
  for (const route of ["/api/classes", "/api/studio/reviews", "/api/studio/drafts", "/api/admin/users"]) {
    assert.equal((await send(route, "GET", undefined, parentCookie)).status, 403, route);
    assert.equal((await send(route)).status, 401, route);
  }
  assert.equal((await send("/api/library", "PUT", { id: "bgs-primary", data: {} }, parentCookie)).status, 403);
});

test("teacher sign-up stays pending until an administrator approves", async () => {
  const response = await send("/api/auth/sign-up", "POST", { email: "teacher@example.com", displayName: "Teacher", password, accountType: "teacher" });
  assert.equal(response.status, 201);
  const { adult } = await response.json();
  pendingCookie = cookieFrom(response); pendingId = adult.id;
  assert.equal(adult.role, "parent"); assert.equal(adult.teacherStatus, "pending");
  assert.equal((await send("/api/classes", "POST", { name: "Forbidden" }, pendingCookie)).status, 403);
  const owner = await send("/api/auth/sign-up", "POST", { email: "owner@example.com", displayName: "Owner", password });
  adminCookie = cookieFrom(owner);
  const fixture = new Database(path.join(stateDir, "test.db"));
  fixture.prepare("UPDATE adults SET role = 'admin' WHERE email = ?").run("owner@example.com");
  fixture.close();
  assert.equal((await send(`/api/admin/users/${pendingId}`, "PATCH", { kind: "adult", action: "approve" }, adminCookie)).status, 200);
  assert.equal((await send("/api/classes", "GET", undefined, pendingCookie)).status, 401);
  const signIn = await send("/api/auth/sign-in", "POST", { email: "teacher@example.com", password });
  teacherCookie = cookieFrom(signIn);
  assert.equal((await signIn.json()).adult.role, "teacher");
  const created = await send("/api/classes", "POST", { name: "Approved class" }, teacherCookie);
  assert.equal(created.status, 201); classId = (await created.json()).class.id;
});

test("teacher accounts cannot manage users and private responses never contain hashes", async () => {
  assert.equal((await send("/api/admin/users", "GET", undefined, teacherCookie)).status, 403);
  assert.equal((await send(`/api/admin/users/${parentId}`, "PATCH", { kind: "adult", role: "admin" }, teacherCookie)).status, 403);
  const response = await send("/api/admin/users", "GET", undefined, adminCookie);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/);
  const text = await response.text();
  assert.ok(!/passwordHash|password_hash|tokenHash|recoveryCodes|codeHash/.test(text));
});

test("permission changes take effect for existing teacher sessions", async () => {
  assert.equal((await send(`/api/admin/users/${pendingId}`, "PATCH", { kind: "adult", role: "parent" }, adminCookie)).status, 200);
  assert.equal((await send(`/api/classes/${classId}`, "GET", undefined, teacherCookie)).status, 401);
  const signIn = await send("/api/auth/sign-in", "POST", { email: "teacher@example.com", password });
  assert.equal((await send("/api/classes", "GET", undefined, cookieFrom(signIn))).status, 403);
});

test("student suspension revokes access without granting adult permissions", async () => {
  const response = await send("/api/student/sign-up", "POST", { username: "test-learner", displayName: "Learner", password });
  assert.equal(response.status, 201);
  studentCookie = cookieFrom(response, "ba_student_session"); studentId = (await response.json()).student.id;
  assert.equal((await send("/api/student/feed", "GET", undefined, studentCookie)).status, 200);
  assert.equal((await send("/api/classes", "GET", undefined, studentCookie)).status, 401);
  assert.equal((await send(`/api/admin/users/${studentId}`, "PATCH", { kind: "student", status: "suspended" }, adminCookie)).status, 200);
  assert.equal((await send("/api/student/feed", "GET", undefined, studentCookie)).status, 401);
  assert.equal((await send("/api/student/sign-in", "POST", { username: "test-learner", password })).status, 401);
});

test("cross-origin requests and form-encoded mutations are rejected", async () => {
  assert.equal((await send(`/api/admin/users/${parentId}`, "PATCH", { kind: "adult", role: "admin" }, adminCookie, { Origin: "https://other.example" })).status, 403);
  const response = await fetch(`${BASE}/api/auth/sign-in`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ email: "owner@example.com", password }) });
  assert.equal(response.status, 403);
});

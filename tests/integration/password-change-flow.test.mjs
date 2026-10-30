import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import Database from "better-sqlite3";

/**
 * Accounts an administrator creates (or whose password an administrator resets) get a temporary
 * password. Until it is replaced every other page redirects to the change form and every other API
 * answers 403, whichever way the route reads the session. The change renews the recovery codes.
 */

const PORT = 3231;
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = new URL("../..", import.meta.url).pathname;
const stateDir = mkdtempSync(path.join(tmpdir(), "bangla-password-"));
const password = "integration-admin-password";
const temporaryPattern = /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{2}$/;
let server, adminCookie, teacher, student;

const cookieFrom = (response, name = "ba_adult_session") => response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`))?.split(";")[0];
const send = (route, method = "GET", body, cookie, headers = {}) => fetch(`${BASE}${route}`, { method, redirect: "manual", headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const fixture = (callback) => { const db = new Database(path.join(stateDir, "test.db")); try { return callback(db); } finally { db.close(); } };
const device = (name) => ({ "x-forwarded-for": `password-${name}` });
const adultSignIn = (email, secret, from = email) => send("/api/auth/sign-in", "POST", { email, password: secret }, undefined, device(from));
const studentSignIn = (username, secret, from = username) => send("/api/student/sign-in", "POST", { username, password: secret }, undefined, device(from));
const changeAdultPassword = (cookie, currentPassword, newPassword) => send("/api/account/password", "POST", { currentPassword, newPassword }, cookie, device(`change-${cookie.slice(-6)}`));
const recover = (email, recoveryCode, newPassword) => send("/api/auth/recover", "POST", { email, recoveryCode, newPassword }, undefined, device(`recover-${email}`));

async function createAccount(body) {
  const response = await send("/api/admin/users", "POST", body, adminCookie);
  assert.equal(response.status, 201);
  assert.match(response.headers.get("cache-control"), /no-store/);
  const text = await response.text();
  assert.ok(!/passwordHash|password_hash|scrypt:|codeHash/.test(text));
  const created = JSON.parse(text);
  assert.match(created.temporaryPassword, temporaryPattern);
  assert.equal(created.user.mustChangePassword, true);
  assert.equal(created.user.approvalStatus, "approved");
  return created;
}

/** Every route reached while the temporary password is in use is closed, including routes that read the session directly. */
async function expectHeldAtForm(cookie) {
  for (const [route, method, body] of [
    ["/api/classes", "GET"], ["/api/classes", "POST", { name: "Not yet" }], ["/api/curriculum", "GET"], ["/api/studio/reviews", "GET"],
    ["/api/studio/drafts", "GET"], ["/api/family", "GET"], ["/api/profiles", "GET"], ["/api/assignments", "GET"], ["/api/library", "GET"],
    ["/api/account/export", "GET"], ["/api/account/recovery-codes", "POST", { password: "x" }], ["/api/account/sessions", "DELETE"],
    ["/api/auth/teacher-request", "POST", {}], ["/api/admin/users", "GET"], ["/api/admin/results", "GET"], ["/api/admin/family-links?studentId=x", "GET"],
    // Topics, lessons and sources: staff authoring, approval and class sources, and the parent's view of them.
    ["/api/topics", "GET"], ["/api/topics", "POST", {}], ["/api/topics/pohela-boishakh", "GET"], ["/api/studio/lessons", "GET"],
    ["/api/studio/lessons/hello-me", "POST", { decision: "withdraw" }], ["/api/studio/media", "GET"], ["/api/classes/x/sources", "GET"],
    ["/api/classes/x/topic-progress", "GET"], ["/api/family/sources", "GET"], ["/api/library", "PUT", { id: "bgs-primary", data: {} }],
  ]) {
    const response = await send(route, method, body, cookie);
    assert.equal(response.status, 403, `${method} ${route}`);
    const payload = await response.json();
    assert.equal(payload.mustChangePassword, true, `${method} ${route}`);
  }
  for (const page of ["/teach", "/admin", "/admin/classes", "/admin/sources", "/family", "/account", "/studio", "/teach/topics", "/learn", "/topics", "/references", "/", "/teach?class=1"]) {
    const response = await send(page, "GET", undefined, cookie);
    assert.equal(response.status, 307, page);
    const location = new URL(response.headers.get("location"), BASE);
    assert.equal(location.pathname, "/account/password", page);
    assert.equal(location.searchParams.get("returnTo"), page, page);
  }
  assert.equal((await send("/account/password", "GET", undefined, cookie)).status, 200);
  const session = await (await send("/api/auth/session", "GET", undefined, cookie)).json();
  assert.equal(session.authenticated, true);
  assert.equal(session.home, "/account/password");
}

before(async () => {
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: "production", PLATFORM_MODE: "legacy", DATABASE_PATH: path.join(stateDir, "test.db"), MEDIA_ROOT: path.join(stateDir, "media") }, stdio: "ignore",
  });
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch (error) { if (server.exitCode !== null) throw error; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const signUp = await send("/api/auth/sign-up", "POST", { email: "password-admin@example.com", displayName: "Password Admin", password }, undefined, device("admin"));
  assert.equal(signUp.status, 201);
  // Self sign-ups wait for an administrator: approve directly, then sign in.
  fixture((db) => db.prepare("UPDATE adults SET role = 'admin', approval_status = 'approved' WHERE email = ?").run("password-admin@example.com"));
  adminCookie = cookieFrom(await adultSignIn("password-admin@example.com", password));
  assert.ok(adminCookie);
});
after(async () => {
  if (server && server.exitCode === null) { const closed = once(server, "exit"); server.kill("SIGTERM"); await closed; }
  rmSync(stateDir, { recursive: true, force: true });
});

test("an administrator-created teacher must choose a password, gets fresh recovery codes, then reaches the teacher workspace", async () => {
  teacher = await createAccount({ kind: "adult", role: "teacher", email: "made-teacher@example.com", displayName: "Made Teacher" });
  assert.equal(teacher.recoveryCodes.length, 8);
  const first = await adultSignIn("made-teacher@example.com", teacher.temporaryPassword, "teacher-a");
  assert.equal(first.status, 200);
  const signedIn = await first.json();
  assert.equal(signedIn.mustChangePassword, true);
  assert.equal(signedIn.adult.role, "teacher");
  const cookie = cookieFrom(first);
  const otherDevice = cookieFrom(await adultSignIn("made-teacher@example.com", teacher.temporaryPassword, "teacher-b"));
  await expectHeldAtForm(cookie);
  const grownUps = await send("/grown-ups?returnTo=%2Fteach", "GET", undefined, cookie);
  assert.equal(grownUps.status, 307);
  assert.equal(new URL(grownUps.headers.get("location"), BASE).pathname, "/account/password");

  const wrong = await changeAdultPassword(cookie, "wrong-password", "my-own-teacher-password");
  assert.equal(wrong.status, 403);
  assert.match((await wrong.json()).errorBn, /বর্তমান পাসওয়ার্ডটি সঠিক নয়/, "a Bangla page explains the refusal in Bangla");
  // A dot segment cannot turn the destination after the change into another website.
  const dotted = await send("/account/password?returnTo=%2F.%2F%2Fevil.example%2Fphish", "GET", undefined, cookie);
  assert.equal(dotted.status, 200);
  const dottedPage = await dotted.text();
  assert.ok(!/destination\\*"\s*:\s*\\*"\/\/evil\.example/.test(dottedPage), "the form never returns to another site");
  assert.match(dottedPage, /destination\\*"\s*:\s*\\*"\/\\*"/, "it returns home instead");
  assert.equal((await changeAdultPassword(cookie, teacher.temporaryPassword, "short")).status, 400);
  assert.equal((await changeAdultPassword(cookie, teacher.temporaryPassword, teacher.temporaryPassword)).status, 400);
  assert.equal((await send("/api/account/password", "POST", { currentPassword: teacher.temporaryPassword, newPassword: "my-own-teacher-password" })).status, 401);
  const changed = await changeAdultPassword(cookie, teacher.temporaryPassword, "my-own-teacher-password");
  assert.equal(changed.status, 200);
  assert.match(changed.headers.get("cache-control"), /no-store/);
  const { recoveryCodes } = await changed.json();
  assert.equal(recoveryCodes.length, 8);
  assert.ok(recoveryCodes.every((code) => !teacher.recoveryCodes.includes(code)), "fresh codes the administrator never saw");

  assert.equal((await send("/teach", "GET", undefined, cookie)).status, 200, "this session continues, unblocked");
  assert.equal((await send("/api/classes", "GET", undefined, cookie)).status, 200);
  assert.equal(new URL((await send("/account/password", "GET", undefined, cookie)).headers.get("location"), BASE).pathname, "/account", "the form is only for a required change");
  assert.equal((await send("/api/classes", "GET", undefined, otherDevice)).status, 401, "other sessions are signed out");
  assert.equal((await adultSignIn("made-teacher@example.com", teacher.temporaryPassword, "teacher-c")).status, 401, "the temporary password no longer works");
  const again = await adultSignIn("made-teacher@example.com", "my-own-teacher-password", "teacher-c");
  assert.equal((await again.json()).mustChangePassword, false);
  assert.equal((await recover("made-teacher@example.com", teacher.recoveryCodes[0], "stolen-password-1")).status, 401, "the administrator's codes stop working");
  const ownCode = await recover("made-teacher@example.com", recoveryCodes[0], "recovered-teacher-password");
  assert.equal(ownCode.status, 200);
  assert.equal((await ownCode.json()).recoveryCodes, undefined, "a recovery by the owner keeps their own codes");
  fixture((db) => {
    const row = db.prepare("SELECT id, must_change_password FROM adults WHERE email = ?").get("made-teacher@example.com");
    assert.equal(row.must_change_password, 0);
    const audit = db.prepare("SELECT details_json FROM user_audit_events WHERE target_id = ? AND action = 'password-changed'").get(row.id);
    assert.deepEqual(JSON.parse(audit.details_json), { temporary: true });
  });
});

test("an administrator-created parent is held at the form until the password is changed", async () => {
  const parent = await createAccount({ kind: "adult", role: "parent", email: "made-parent@example.com", displayName: "Made Parent" });
  const cookie = cookieFrom(await adultSignIn("made-parent@example.com", parent.temporaryPassword));
  const family = await send("/api/family", "GET", undefined, cookie);
  assert.equal(family.status, 403);
  assert.equal((await family.json()).mustChangePassword, true);
  assert.equal((await changeAdultPassword(cookie, parent.temporaryPassword, "my-own-parent-password")).status, 200);
  assert.equal((await send("/api/family", "GET", undefined, cookie)).status, 200);
  assert.equal((await send("/family", "GET", undefined, cookie)).status, 200);
});

test("recovery with an administrator-issued code ends the forced change and renews the codes", async () => {
  const made = await createAccount({ kind: "adult", role: "teacher", email: "recovering-teacher@example.com", displayName: "Recovering Teacher" });
  const recovered = await recover("recovering-teacher@example.com", made.recoveryCodes[0], "chosen-at-recovery-1");
  assert.equal(recovered.status, 200);
  const body = await recovered.json();
  assert.equal(body.adult.mustChangePassword, false);
  assert.equal(body.recoveryCodes.length, 8);
  assert.ok(body.recoveryCodes.every((code) => !made.recoveryCodes.includes(code)));
  assert.equal((await send("/api/classes", "GET", undefined, cookieFrom(recovered))).status, 200, "no second forced change");
  assert.equal((await recover("recovering-teacher@example.com", made.recoveryCodes[1], "stolen-password-1")).status, 401);
});

test("an administrator-created student must choose a password before learning", async () => {
  student = await createAccount({ kind: "student", username: "made-student", displayName: "Made Student" });
  const first = await studentSignIn("made-student", student.temporaryPassword);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).mustChangePassword, true);
  const cookie = cookieFrom(first, "ba_student_session");
  assert.equal((await send("/api/student/feed", "GET", undefined, cookie)).status, 403);
  // The textbook library and lesson audio wait for the student's own password too, like every other learning API.
  for (const route of ["/api/library", "/api/audio/hello-me", "/api/audio/hello-me/word-1", "/api/curriculum"]) {
    const held = await send(route, "GET", undefined, cookie);
    assert.equal(held.status, 403, route);
    const body = await held.json();
    assert.equal(body.mustChangePassword, true, route);
    assert.ok(body.errorBn, route);
  }
  assert.equal(new URL((await send("/student", "GET", undefined, cookie)).headers.get("location"), BASE).pathname, "/student/password");
  const wrong = await send("/api/student/password", "POST", { currentPassword: "not-the-temporary-one", newPassword: "my-own-student-password" }, cookie);
  assert.equal(wrong.status, 403);
  assert.match((await wrong.json()).errorBn, /বর্তমান পাসওয়ার্ডটি সঠিক নয়/);
  assert.equal((await send("/api/student/password", "POST", { currentPassword: student.temporaryPassword, newPassword: "my-own-student-password" }, cookie)).status, 200);
  assert.equal((await send("/api/student/feed", "GET", undefined, cookie)).status, 200);
  assert.equal((await send("/api/library", "GET", undefined, cookie)).status, 200);
  assert.equal((await send("/api/audio/hello-me", "GET", undefined, cookie)).status, 200);
  assert.equal((await send("/api/audio/hello-me/word-1", "GET", undefined, cookie)).status, 307);
});

test("an administrator resets a forgotten student password: sessions end and the new one must be replaced", async () => {
  const signedIn = cookieFrom(await studentSignIn("made-student", "my-own-student-password", "student-before-reset"), "ba_student_session");
  assert.equal((await send(`/api/admin/users/${student.user.id}/password`, "POST", { kind: "student" })).status, 401);
  const reset = await send(`/api/admin/users/${student.user.id}/password`, "POST", { kind: "student" }, adminCookie);
  assert.equal(reset.status, 200);
  assert.match(reset.headers.get("cache-control"), /no-store/);
  const { temporaryPassword, user } = await reset.json();
  assert.match(temporaryPassword, temporaryPattern);
  assert.equal(user.username, "made-student");
  assert.equal((await send("/api/student/feed", "GET", undefined, signedIn)).status, 401, "existing sessions are signed out");
  assert.equal((await studentSignIn("made-student", "my-own-student-password", "student-old")).status, 401, "the forgotten password no longer works");
  const next = await studentSignIn("made-student", temporaryPassword, "student-new");
  assert.equal((await next.json()).mustChangePassword, true);
  const cookie = cookieFrom(next, "ba_student_session");
  assert.equal((await send("/api/student/feed", "GET", undefined, cookie)).status, 403);
  assert.equal((await send("/api/student/password", "POST", { currentPassword: temporaryPassword, newPassword: "remembered-this-time" }, cookie)).status, 200);
  assert.equal((await send("/api/student/feed", "GET", undefined, cookie)).status, 200);
  fixture((db) => {
    const audit = db.prepare("SELECT actor_id, details_json FROM user_audit_events WHERE target_id = ? AND action = 'password-reset'").get(student.user.id);
    assert.ok(audit.actor_id);
    assert.ok(!audit.details_json.includes(temporaryPassword));
  });
});

test("adult resets hold the account at the form; nobody resets their own password and teachers reset none", async () => {
  const teacherCookie = cookieFrom(await adultSignIn("made-teacher@example.com", "recovered-teacher-password", "teacher-d"));
  assert.equal((await send(`/api/admin/users/${student.user.id}/password`, "POST", { kind: "student" }, teacherCookie)).status, 403);
  const admin = fixture((db) => db.prepare("SELECT id FROM adults WHERE email = ?").get("password-admin@example.com").id);
  const own = await send(`/api/admin/users/${admin}/password`, "POST", { kind: "adult" }, adminCookie);
  assert.equal(own.status, 409);
  assert.equal((await send(`/api/admin/users/${admin}/password`, "POST", { kind: "robot" }, adminCookie)).status, 400);

  const reset = await send(`/api/admin/users/${teacher.user.id}/password`, "POST", { kind: "adult" }, adminCookie);
  assert.equal(reset.status, 200);
  const { temporaryPassword } = await reset.json();
  assert.equal((await send("/api/classes", "GET", undefined, teacherCookie)).status, 401, "existing sessions are signed out");
  const cookie = cookieFrom(await adultSignIn("made-teacher@example.com", temporaryPassword, "teacher-e"));
  assert.equal((await send("/api/classes", "GET", undefined, cookie)).status, 403);

  // A second administrator whose password was reset is held at the form too, including the administrator APIs.
  fixture((db) => db.prepare("UPDATE adults SET role = 'admin', teacher_status = 'none' WHERE id = ?").run(teacher.user.id));
  const reAdmin = cookieFrom(await adultSignIn("made-teacher@example.com", temporaryPassword, "teacher-f"));
  const users = await send("/api/admin/users", "GET", undefined, reAdmin);
  assert.equal(users.status, 403);
  assert.equal((await users.json()).mustChangePassword, true);
  assert.equal((await send(`/api/admin/users/${student.user.id}/password`, "POST", { kind: "student" }, reAdmin)).status, 403);
  assert.equal((await changeAdultPassword(reAdmin, temporaryPassword, "second-admin-password")).status, 200);
  assert.equal((await send("/api/admin/users", "GET", undefined, reAdmin)).status, 200);
});

test("account errors come in Bangla too, and a signed-in return address cannot leave the site", async () => {
  const duplicate = await send("/api/admin/users", "POST", { kind: "adult", role: "parent", email: "made-parent@example.com", displayName: "Again" }, adminCookie);
  assert.equal(duplicate.status, 409);
  assert.deepEqual(await duplicate.json(), { error: "That email is already registered.", errorBn: "এই ইমেইলটি আগেই নিবন্ধিত।" });
  const signIn = await adultSignIn("made-parent@example.com", "not-the-password", "bangla-errors");
  assert.equal(signIn.status, 401);
  assert.ok((await signIn.json()).errorBn);
  const studentSignInFailure = await studentSignIn("made-student", "not-the-password", "bangla-errors-student");
  assert.ok((await studentSignInFailure.json()).errorBn);

  for (const returnTo of ["%2F.%2F%2Fevil.example%2Fphish", "%2F..%2F%2Fevil.example", "%2F%252e%252e%2F%2Fevil.example"]) {
    const redirected = await send(`/grown-ups?returnTo=${returnTo}`, "GET", undefined, adminCookie);
    assert.equal(redirected.status, 307, returnTo);
    const location = new URL(redirected.headers.get("location"), BASE);
    assert.equal(location.origin, BASE, returnTo);
    assert.ok(!location.pathname.startsWith("//"), returnTo);
  }
});

test("a locked-out sole administrator gets back in with a password reset on the server", async () => {
  const reset = spawnSync(process.execPath, ["--import", "tsx", "scripts/reset-password.ts", "Password-Admin@example.com"], { cwd: ROOT, env: { ...process.env, DATABASE_PATH: path.join(stateDir, "test.db") }, encoding: "utf8" });
  assert.equal(reset.status, 0, reset.stderr);
  const temporaryPassword = reset.stdout.match(/^Temporary password for Password Admin \(password-admin@example\.com\): (\S+)$/m)?.[1];
  assert.match(temporaryPassword, temporaryPattern);
  assert.equal((await send("/api/classes", "GET", undefined, adminCookie)).status, 401, "earlier sessions are signed out");
  assert.equal((await adultSignIn("password-admin@example.com", password, "admin-forgotten")).status, 401, "the forgotten password no longer works");
  const signIn = await send("/api/auth/sign-in", "POST", { email: "password-admin@example.com", password: temporaryPassword, requireAdmin: true }, undefined, device("admin-reset"));
  assert.equal(signIn.status, 200);
  assert.equal((await signIn.json()).mustChangePassword, true);
  const cookie = cookieFrom(signIn);
  const held = await send("/admin", "GET", undefined, cookie);
  assert.equal(held.status, 307);
  assert.equal(new URL(held.headers.get("location"), BASE).pathname, "/account/password");
  const changed = await changeAdultPassword(cookie, temporaryPassword, "admin-chose-a-new-one");
  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).recoveryCodes.length, 8, "fresh recovery codes replace the lost ones");
  assert.equal((await send("/api/admin/users", "GET", undefined, cookie)).status, 200);
  fixture((db) => {
    const audit = db.prepare("SELECT actor_id, details_json FROM user_audit_events WHERE action = 'password-reset-by-server-operator'").all();
    assert.deepEqual(audit, [{ actor_id: null, details_json: "{}" }]);
  });
});

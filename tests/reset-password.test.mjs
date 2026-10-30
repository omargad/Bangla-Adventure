import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { eq } from "drizzle-orm";

/**
 * `npm run admin:reset-password` is the server operator's way back in for someone with no other one,
 * such as a sole administrator who lost both the password and the recovery codes. It resets exactly
 * as the Users page does, finds only active accounts, and shows the temporary password once.
 */

const ROOT = new URL("..", import.meta.url).pathname;
const dir = mkdtempSync(path.join(os.tmpdir(), "bangla-reset-password-test-"));
process.env.DATABASE_PATH = path.join(dir, "reset.db");
const { getDb } = await import("../db/index.ts");
const { adults, adultSessions, students, studentSessions, userAuditEvents } = await import("../db/schema.ts");
const auth = await import("../lib/auth.ts");
const studentAuth = await import("../lib/student-auth.ts");
const { hashPassword, verifyPassword } = await import("../lib/password.ts");
const db = await getDb();
db.insert(adults).values([
  { id: "owner", email: "owner@example.com", displayName: "Sole Owner", passwordHash: hashPassword("forgotten-owner-password"), role: "admin" },
  { id: "away-parent", email: "away@example.com", displayName: "Suspended Parent", passwordHash: hashPassword("suspended-parent-password"), status: "suspended" },
  { id: "waiting-parent", email: "waiting@example.com", displayName: "Waiting Parent", passwordHash: hashPassword("waiting-parent-password"), approvalStatus: "pending" },
  // Sign-up forms accept any name, so one can carry terminal escapes: erase the line, print a fake message, hide the rest.
  { id: "tricky-parent", email: "tricky@example.com", displayName: "Evil\u001b[2K\u001b[1A\u001b[2K\rNo active account matched.\u001b[8m", passwordHash: hashPassword("tricky-parent-password") },
  // Bangla spelling needs the zero-width joiner (র‍্যা).
  { id: "bangla-parent", email: "rachel@example.com", displayName: "র\u200d্যাচেল বসু", passwordHash: hashPassword("bangla-parent-password") },
]).run();
db.insert(students).values([
  { id: "child", username: "river.child", displayName: "River Child", passwordHash: hashPassword("forgotten-child-password") },
  { id: "away-child", username: "away-child", displayName: "Suspended Child", passwordHash: hashPassword("suspended-child-password"), status: "suspended" },
  { id: "link-child", username: "bad.kid", displayName: "Kid\u001b]8;;https://evil.example/\u0007click me\u001b]8;;\u0007 \u202emoc.elpmaxe", passwordHash: hashPassword("link-child-password") },
]).run();
after(() => rmSync(dir, { recursive: true, force: true }));

const run = (...args) => new Promise((resolve) => {
  execFile(process.execPath, ["--import", "tsx", "scripts/reset-password.ts", ...args], { cwd: ROOT }, (error, stdout, stderr) => resolve({ status: error ? error.code : 0, stdout, stderr }));
});
const temporaryFrom = (stdout) => stdout.match(/: ([a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{2})\n/)?.[1];
const auditFor = (id) => db.select().from(userAuditEvents).where(eq(userAuditEvents.targetId, id)).all();
/** The plain password is stored nowhere: no table, the audit details included, holds it. */
function assertNotStored(secret) {
  for (const { name } of db.$client.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()) {
    assert.ok(!JSON.stringify(db.$client.prepare(`SELECT * FROM "${name}"`).all()).includes(secret), `${name} holds the temporary password`);
  }
}

test("a locked-out administrator, named by email in any case, gets a temporary password that must be replaced", async () => {
  await auth.createAdultSession("owner");
  const result = await run("Owner@Example.COM");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const temporaryPassword = temporaryFrom(result.stdout);
  assert.ok(temporaryPassword, result.stdout);
  assert.equal(result.stdout.split(temporaryPassword).length, 2, "the password is printed once");
  assert.match(result.stdout, /^Temporary password for Sole Owner \(owner@example\.com\): /);
  assert.match(result.stdout, /Sign in with it at \/grown-ups and choose a new password .*fresh recovery codes/);

  assert.equal(await auth.verifyAdultCredentials("owner@example.com", "forgotten-owner-password"), null, "the old password no longer works");
  const adult = await auth.verifyAdultCredentials("owner@example.com", temporaryPassword);
  assert.equal(adult.mustChangePassword, true);
  assert.equal(adult.role, "admin");
  assert.equal(db.select().from(adultSessions).where(eq(adultSessions.adultId, "owner")).all().length, 0, "earlier sessions are signed out");
  const [audit] = auditFor("owner");
  assert.deepEqual({ action: audit.action, actorId: audit.actorId, targetType: audit.targetType, detailsJson: audit.detailsJson }, { action: "password-reset-by-server-operator", actorId: null, targetType: "adult", detailsJson: "{}" });
  assertNotStored(temporaryPassword);

  // The existing forced change then replaces it and hands the owner new recovery codes.
  const { token } = await auth.createAdultSession("owner");
  const codes = await auth.changeAdultPassword(adult, "owner-chose-this-one", token);
  assert.equal(codes.length, 8);
  assert.equal((await auth.verifyAdultCredentials("owner@example.com", "owner-chose-this-one")).mustChangePassword, false);
});

test("a student is found by username, in any case", async () => {
  await studentAuth.createStudentSession("child");
  const result = await run("River.Child");
  assert.equal(result.status, 0, result.stderr);
  const temporaryPassword = temporaryFrom(result.stdout);
  assert.match(result.stdout, /^Temporary password for River Child \(river\.child\): /);
  assert.match(result.stdout, /Sign in with it at \/student and choose a new password/);
  assert.doesNotMatch(result.stdout, /recovery codes/);
  assert.equal(await studentAuth.verifyStudentCredentials("river.child", "forgotten-child-password"), null);
  assert.equal((await studentAuth.verifyStudentCredentials("river.child", temporaryPassword)).mustChangePassword, true);
  assert.equal(db.select().from(studentSessions).where(eq(studentSessions.studentId, "child")).all().length, 0);
  assert.deepEqual(auditFor("child").map((event) => [event.action, event.actorId, event.targetType]), [["password-reset-by-server-operator", null, "student"]]);
  assertNotStored(temporaryPassword);
});

test("unknown and suspended accounts are not matched and nothing changes", async () => {
  const before = db.select().from(userAuditEvents).all().length;
  for (const result of await Promise.all(["nobody@example.com", "nobody-here", "away@example.com", "away-child"].map((account) => run(account)))) {
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr.trim(), "No active account matched.");
  }
  assert.ok(verifyPassword("suspended-parent-password", db.select().from(adults).where(eq(adults.id, "away-parent")).get().passwordHash));
  assert.ok(verifyPassword("suspended-child-password", db.select().from(students).where(eq(students.id, "away-child")).get().passwordHash));
  assert.equal(db.select().from(userAuditEvents).all().length, before);
});

test("a missing or malformed argument prints the usage and changes nothing", async () => {
  const before = db.select().from(userAuditEvents).all().length;
  for (const result of await Promise.all([[], ["owner@"], ["owner@example"], ["ab"], ["has space"], ["owner@example.com", "river.child"]].map((args) => run(...args)))) {
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr.trim(), "Usage: npm run admin:reset-password -- <adult-email-or-student-username>");
  }
  assert.equal(db.select().from(userAuditEvents).all().length, before);
});

test("an account still waiting for approval is reset and the operator is told sign-in stays closed", async () => {
  const result = await run("waiting@example.com");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /still waiting for approval, so sign-in stays closed until an administrator approves it/);
  assert.equal((await auth.verifyAdultCredentials("waiting@example.com", temporaryFrom(result.stdout))).approvalStatus, "pending");
});

test("a name cannot hide or rewrite the output with terminal escapes, and Bangla names print as they are", async () => {
  for (const [account, id, shown] of [
    ["tricky@example.com", "tricky-parent", "Evil\ufffd[2K\ufffd[1A\ufffd[2K\ufffdNo active account matched.\ufffd[8m (tricky@example.com)"],
    ["bad.kid", "link-child", "Kid\ufffd]8;;https://evil.example/\ufffdclick me\ufffd]8;;\ufffd \ufffdmoc.elpmaxe (bad.kid)"],
  ]) {
    const result = await run(account);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u, "no control character or bidi override reaches the terminal");
    assert.equal(result.stdout.split("\n")[0].slice(0, -": xxxx-xxxx-xx".length), `Temporary password for ${shown}`);
    const temporaryPassword = temporaryFrom(result.stdout);
    assert.ok(temporaryPassword, result.stdout);
    assert.ok(await (id === "link-child" ? studentAuth.verifyStudentCredentials("bad.kid", temporaryPassword) : auth.verifyAdultCredentials(account, temporaryPassword)));
  }
  const result = await run("rachel@example.com");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Temporary password for র\u200d্যাচেল বসু \(rachel@example\.com\): /);
});

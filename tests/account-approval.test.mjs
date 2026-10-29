import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { and, eq, isNull } from "drizzle-orm";

const dir = mkdtempSync(path.join(os.tmpdir(), "bangla-approval-test-"));
process.env.DATABASE_PATH = path.join(dir, "approval.db");
const { getDb } = await import("../db/index.ts");
const { adults, adultSessions, recoveryCodes, students, userAuditEvents } = await import("../db/schema.ts");
const auth = await import("../lib/auth.ts");
const studentAuth = await import("../lib/student-auth.ts");
const { approvalNotice } = await import("../lib/roles.ts");
const { hashSessionToken } = await import("../lib/password.ts");
const db = await getDb();
after(() => rmSync(dir, { recursive: true, force: true }));

const unusedCodes = (adultId) => db.select().from(recoveryCodes).where(and(eq(recoveryCodes.adultId, adultId), isNull(recoveryCodes.usedAt))).all().length;

test("self sign-up creates waiting accounts that cannot start a session", async () => {
  const parent = await auth.registerAdult("Waiting.Parent@example.com", "Waiting Parent", "parent-password-1");
  assert.equal(parent.approvalStatus, "pending");
  assert.equal(parent.mustChangePassword, false);
  const teacher = await auth.registerAdult("waiting.teacher@example.com", "Waiting Teacher", "teacher-password-1", true);
  assert.equal(teacher.approvalStatus, "pending");
  assert.equal(teacher.teacherStatus, "pending");
  assert.equal(teacher.role, "parent");
  // The password still verifies, so sign-in can say why the account cannot be used yet.
  assert.equal((await auth.verifyAdultCredentials("waiting.parent@example.com", "parent-password-1")).approvalStatus, "pending");
  await assert.rejects(auth.createAdultSession(parent.id), /unavailable/);

  const student = await studentAuth.registerStudent("waiting-child", "Waiting Child", "child-password");
  assert.equal(db.select().from(students).where(eq(students.id, student.id)).get().approvalStatus, "pending");
  assert.equal((await studentAuth.verifyStudentCredentials("waiting-child", "child-password")).approvalStatus, "pending");
  await assert.rejects(studentAuth.createStudentSession(student.id), /unavailable/);

  db.update(students).set({ approvalStatus: "approved" }).where(eq(students.id, student.id)).run();
  db.update(adults).set({ approvalStatus: "approved" }).where(eq(adults.id, parent.id)).run();
  assert.ok((await studentAuth.createStudentSession(student.id)).token);
  assert.ok((await auth.createAdultSession(parent.id)).token);
  db.update(adults).set({ approvalStatus: "declined" }).where(eq(adults.id, parent.id)).run();
  await assert.rejects(auth.createAdultSession(parent.id), /unavailable/);
});

test("a recovery code proves who is asking but is not spent while the account waits", async () => {
  const adult = await auth.registerAdult("recover.waiting@example.com", "Recover Waiting", "waiting-password-1");
  const [code] = await auth.issueRecoveryCodes(adult.id);
  assert.equal(await auth.consumeRecoveryCode("recover.waiting@example.com", "WRONG-CODES"), null);
  const waiting = await auth.consumeRecoveryCode("recover.waiting@example.com", code);
  assert.equal(waiting.approvalStatus, "pending");
  assert.equal(unusedCodes(adult.id), 8, "the code is kept for after approval");
  db.update(adults).set({ approvalStatus: "approved" }).where(eq(adults.id, adult.id)).run();
  assert.equal((await auth.consumeRecoveryCode("recover.waiting@example.com", code)).id, adult.id);
  assert.equal(unusedCodes(adult.id), 7);
  assert.equal(await auth.consumeRecoveryCode("recover.waiting@example.com", code), null, "one use only");
});

test("replacing an administrator-issued password clears the flag, renews recovery codes and keeps only this session", async () => {
  const id = crypto.randomUUID();
  db.insert(adults).values({ id, email: "issued@example.com", displayName: "Issued Teacher", passwordHash: "unused", role: "teacher", teacherStatus: "approved", mustChangePassword: true }).run();
  const adminCodes = await auth.issueRecoveryCodes(id);
  db.insert(adultSessions).values([
    { tokenHash: hashSessionToken("keep-me"), adultId: id, expiresAt: "2099-01-01T00:00:00.000Z" },
    { tokenHash: hashSessionToken("other-device"), adultId: id, expiresAt: "2099-01-01T00:00:00.000Z" },
  ]).run();
  const adult = { id, email: "issued@example.com", displayName: "Issued Teacher", role: "teacher", status: "active", teacherStatus: "approved", approvalStatus: "approved", mustChangePassword: true };
  const fresh = await auth.changeAdultPassword(adult, "my-own-password-1", "keep-me");
  assert.equal(fresh.length, 8);
  assert.ok(fresh.every((code) => !adminCodes.includes(code)));
  const row = db.select().from(adults).where(eq(adults.id, id)).get();
  assert.equal(row.mustChangePassword, false);
  assert.ok(await auth.verifyAdultCredentials("issued@example.com", "my-own-password-1"));
  assert.deepEqual(db.select().from(adultSessions).where(eq(adultSessions.adultId, id)).all().map((session) => session.tokenHash), [hashSessionToken("keep-me")]);
  assert.equal(await auth.consumeRecoveryCode("issued@example.com", adminCodes[0]), null, "the codes the administrator saw stop working");
  assert.equal((await auth.consumeRecoveryCode("issued@example.com", fresh[0])).id, id);
  const audit = db.select().from(userAuditEvents).where(and(eq(userAuditEvents.targetId, id), eq(userAuditEvents.action, "password-changed"))).get();
  assert.deepEqual(JSON.parse(audit.detailsJson), { temporary: true });
  assert.ok(!audit.detailsJson.includes("my-own-password-1"));

  // A later, voluntary change keeps the owner's own codes.
  assert.equal(await auth.changeAdultPassword({ ...adult, mustChangePassword: false }, "another-password-2", "keep-me"), null);
  assert.equal(unusedCodes(id), 7);
});

test("a recovery-code reset also ends an administrator-issued password and the codes the administrator saw", async () => {
  const id = crypto.randomUUID();
  db.insert(adults).values({ id, email: "recovering@example.com", displayName: "Recovering Parent", passwordHash: "unused", mustChangePassword: true }).run();
  const adminCodes = await auth.issueRecoveryCodes(id);
  db.insert(adultSessions).values({ tokenHash: hashSessionToken("recovering-device"), adultId: id, expiresAt: "2099-01-01T00:00:00.000Z" }).run();
  const adult = await auth.consumeRecoveryCode("recovering@example.com", adminCodes[0]);
  const fresh = await auth.recoverAdultPassword(adult, "chosen-by-owner-1");
  assert.equal(fresh.length, 8);
  assert.equal(db.select().from(adults).where(eq(adults.id, id)).get().mustChangePassword, false);
  assert.ok(await auth.verifyAdultCredentials("recovering@example.com", "chosen-by-owner-1"));
  assert.equal(db.select().from(adultSessions).where(eq(adultSessions.adultId, id)).all().length, 0, "every session ends");
  assert.equal(await auth.consumeRecoveryCode("recovering@example.com", adminCodes[1]), null, "the codes the administrator saw stop working");
  assert.equal(unusedCodes(id), 8);

  // A later recovery by the owner keeps their own codes.
  const own = await auth.consumeRecoveryCode("recovering@example.com", fresh[0]);
  assert.equal(await auth.recoverAdultPassword(own, "chosen-by-owner-2"), null);
  assert.equal(unusedCodes(id), 7);
  assert.ok(await auth.verifyAdultCredentials("recovering@example.com", "chosen-by-owner-2"));
});

test("approval notices are bilingual and address children and adults differently", () => {
  for (const status of ["pending", "declined"]) {
    const [adultEn, adultBn] = approvalNotice(status, "adult");
    const [childEn, childBn] = approvalNotice(status, "student");
    for (const text of [adultEn, adultBn, childEn, childBn]) assert.ok(text.length > 20);
    assert.match(adultBn, /[ঀ-৿]/);
    assert.notEqual(adultBn, childBn);
  }
  assert.match(approvalNotice("pending", "adult")[0], /waiting for an administrator to approve it/);
});

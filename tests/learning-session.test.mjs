import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import test, { after } from "node:test";

const dir = mkdtempSync(path.join(tmpdir(), "bangla-learning-test-"));
process.env.DATABASE_PATH = path.join(dir, "test.db");
const { getDb } = await import("../db/index.ts");
const { adults, adultSessions, students, studentSessions } = await import("../db/schema.ts");
const { hashSessionToken } = await import("../lib/password.ts");
const { hasLearningSession, learningSession } = await import("../lib/learning-session.ts");
const db = await getDb();
db.insert(adults).values({ id: "adult", email: "member@example.com", displayName: "Parent", passwordHash: "fixture-only" }).run();
db.insert(students).values({ id: "student", username: "learner", displayName: "Learner", passwordHash: "fixture-only" }).run();
db.insert(adultSessions).values([
  { tokenHash: hashSessionToken("adult-valid"), adultId: "adult", expiresAt: "2099-01-01T00:00:00.000Z" },
  { tokenHash: hashSessionToken("adult-expired"), adultId: "adult", expiresAt: "2000-01-01T00:00:00.000Z" },
]).run();
db.insert(studentSessions).values([
  { tokenHash: hashSessionToken("student-valid"), studentId: "student", expiresAt: "2099-01-01T00:00:00.000Z" },
  { tokenHash: hashSessionToken("student-expired"), studentId: "student", expiresAt: "2000-01-01T00:00:00.000Z" },
]).run();
after(() => rmSync(dir, { recursive: true, force: true }));

test("missing, forged and expired session cookies cannot open learning content", async () => {
  for (const args of [[], ["forged"], ["x".repeat(101)], ["adult-expired"], [undefined, "student-expired"]]) assert.equal(await hasLearningSession(...args), false);
});

test("active adult and student sessions can open learning content", async () => {
  assert.equal(await hasLearningSession("adult-valid"), true);
  assert.equal(await hasLearningSession(undefined, "student-valid"), true);
  assert.equal(await hasLearningSession("forged", "student-valid"), true);
});

test("suspension and revocation are checked against stored state", async () => {
  db.update(adults).set({ status: "suspended" }).where(eq(adults.id, "adult")).run();
  db.update(students).set({ status: "suspended" }).where(eq(students.id, "student")).run();
  assert.equal(await hasLearningSession("adult-valid", "student-valid"), false);
  db.update(students).set({ status: "active" }).where(eq(students.id, "student")).run();
  db.delete(studentSessions).where(eq(studentSessions.studentId, "student")).run();
  assert.equal(await hasLearningSession(undefined, "student-valid"), false);
});

test("accounts waiting for approval or declined cannot open learning content", async () => {
  db.update(adults).set({ status: "active" }).where(eq(adults.id, "adult")).run();
  db.insert(studentSessions).values({ tokenHash: hashSessionToken("student-again"), studentId: "student", expiresAt: "2099-01-01T00:00:00.000Z" }).run();
  assert.equal(await hasLearningSession("adult-valid", "student-again"), true);
  for (const approvalStatus of ["pending", "declined"]) {
    db.update(adults).set({ approvalStatus }).where(eq(adults.id, "adult")).run();
    db.update(students).set({ approvalStatus }).where(eq(students.id, "student")).run();
    assert.equal(await hasLearningSession("adult-valid", "student-again"), false, approvalStatus);
  }
  db.update(adults).set({ approvalStatus: "approved" }).where(eq(adults.id, "adult")).run();
  db.update(students).set({ approvalStatus: "approved" }).where(eq(students.id, "student")).run();
});

test("the proxy learns when an adult must still replace an administrator-issued password", async () => {
  assert.deepEqual(await learningSession("adult-valid"), { signedIn: true, adultMustChangePassword: false });
  db.update(adults).set({ mustChangePassword: true }).where(eq(adults.id, "adult")).run();
  assert.deepEqual(await learningSession("adult-valid", "student-again"), { signedIn: true, adultMustChangePassword: true });
  assert.deepEqual(await learningSession(undefined, "student-again"), { signedIn: true, adultMustChangePassword: false });
  assert.deepEqual(await learningSession("forged"), { signedIn: false, adultMustChangePassword: false });
});

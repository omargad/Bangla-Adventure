import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(path.join(os.tmpdir(), "bangla-users-test-"));
process.env.DATABASE_PATH = path.join(dir, "users.db");
const { getDb } = await import("../db/index.ts");
const { adults, adultSessions, students, studentSessions, userAuditEvents } = await import("../db/schema.ts");
const { createUser, listUsers, updateUser } = await import("../lib/user-management.ts");
const db = await getDb();
db.insert(adults).values([
  { id: "admin", email: "admin@example.com", displayName: "Administrator", passwordHash: "test-only", role: "admin" },
  { id: "parent", email: "parent@example.com", displayName: "Parent", passwordHash: "test-only" },
  { id: "applicant", email: "applicant@example.com", displayName: "Applicant", passwordHash: "test-only", teacherStatus: "pending" },
]).run();
after(() => rmSync(dir, { recursive: true, force: true }));

test("parents cannot grant their own permissions or create users", async () => {
  await assert.rejects(updateUser("parent", "parent", { kind: "adult", role: "admin" }), /Administrator access required/);
  await assert.rejects(createUser("parent", { kind: "adult", email: "new@example.com", role: "parent", displayName: "New", password: "test-password-strong" }), /Administrator access required/);
});

test("approving a teacher is atomic, auditable and revokes old sessions", async () => {
  db.insert(adultSessions).values({ tokenHash: "old", adultId: "applicant", expiresAt: "2099-01-01" }).run();
  const user = await updateUser("admin", "applicant", { kind: "adult", action: "approve" });
  assert.equal(user.role, "teacher");
  assert.equal(user.teacherStatus, "approved");
  assert.equal(db.select().from(adultSessions).where(eq(adultSessions.adultId, "applicant")).all().length, 0);
  assert.equal(db.select().from(userAuditEvents).where(eq(userAuditEvents.targetId, "applicant")).all().length, 1);
  await assert.rejects(updateUser("admin", "applicant", { kind: "adult", action: "approve" }), /no longer awaiting approval/);
});

test("teachers cannot administer users after approval", async () => {
  await assert.rejects(updateUser("applicant", "parent", { kind: "adult", status: "suspended" }), /Administrator access required/);
});

test("an administrator cannot demote or suspend themselves", async () => {
  await assert.rejects(updateUser("admin", "admin", { kind: "adult", role: "parent" }), /own role/);
  await assert.rejects(updateUser("admin", "admin", { kind: "adult", status: "suspended" }), /own role/);
});

test("suspension retains user data but revokes authentication", async () => {
  db.insert(adultSessions).values({ tokenHash: "parent-session", adultId: "parent", expiresAt: "2099-01-01" }).run();
  await updateUser("admin", "parent", { kind: "adult", status: "suspended" });
  assert.equal(db.select().from(adults).where(eq(adults.id, "parent")).get().status, "suspended");
  assert.equal(db.select().from(adultSessions).where(eq(adultSessions.adultId, "parent")).all().length, 0);
  await updateUser("admin", "parent", { kind: "adult", status: "active" });
  assert.equal(db.select().from(adultSessions).where(eq(adultSessions.adultId, "parent")).all().length, 0);
});

test("created accounts expose recovery codes once but never password hashes", async () => {
  const result = await createUser("admin", { kind: "adult", email: "new@example.com", role: "teacher", displayName: "New Teacher", password: "test-password-strong" });
  assert.equal(result.user.teacherStatus, "approved");
  assert.equal(result.recoveryCodes.length, 8);
  assert.equal(result.user.passwordHash, undefined);
  await assert.rejects(createUser("admin", { kind: "adult", email: "new@example.com", role: "parent", displayName: "Duplicate", password: "test-password-strong" }), /already registered/);
});

test("student accounts cannot be promoted and their sessions can be revoked", async () => {
  const { user } = await createUser("admin", { kind: "student", username: "test-child", displayName: "Learner", password: "test-password-strong" });
  db.insert(studentSessions).values({ tokenHash: "child-session", studentId: user.id, expiresAt: "2099-01-01" }).run();
  await assert.rejects(updateUser("admin", user.id, { kind: "student", role: "admin" }), /cannot be promoted/);
  await updateUser("admin", user.id, { kind: "student", status: "suspended" });
  assert.equal(db.select().from(students).where(eq(students.id, user.id)).get().status, "suspended");
  assert.equal(db.select().from(studentSessions).all().length, 0);
});

test("listing is paginated and contains no session, password or recovery secrets", async () => {
  const result = await listUsers(new URLSearchParams({ q: "Teacher", kind: "adult" }));
  assert.equal(result.users.length, 1);
  assert.equal(result.pageSize, 25);
  assert.equal(result.users[0].passwordHash, undefined);
  assert.equal(result.users[0].recoveryCodes, undefined);
  assert.ok(!JSON.stringify(result).includes("test-password-strong"));
  await assert.rejects(listUsers(new URLSearchParams({ filter: "unknown" })), /Invalid/);
});

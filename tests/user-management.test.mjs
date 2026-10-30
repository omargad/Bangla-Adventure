import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { eq, like } from "drizzle-orm";

const dir = mkdtempSync(path.join(os.tmpdir(), "bangla-users-test-"));
process.env.DATABASE_PATH = path.join(dir, "users.db");
const { getDb } = await import("../db/index.ts");
const { adults, adultSessions, students, studentSessions, userAuditEvents } = await import("../db/schema.ts");
const { createUser, listUsers, resetPassword, updateUser } = await import("../lib/user-management.ts");
const { verifyPassword } = await import("../lib/password.ts");
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

const temporaryPattern = /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{2}$/;
const auditFor = (targetId) => db.select().from(userAuditEvents).where(eq(userAuditEvents.targetId, targetId)).all().map((event) => event.action);

test("administrator-created accounts are approved and get a temporary password that must be replaced", async () => {
  const child = await createUser("admin", { kind: "student", username: "made-by-admin", displayName: "Admin Child", password: "ignored-admin-choice" });
  assert.match(child.temporaryPassword, temporaryPattern);
  const childRow = db.select().from(students).where(eq(students.id, child.user.id)).get();
  assert.equal(childRow.mustChangePassword, true);
  assert.equal(childRow.approvalStatus, "approved");
  assert.ok(verifyPassword(child.temporaryPassword, childRow.passwordHash));
  assert.ok(!verifyPassword("ignored-admin-choice", childRow.passwordHash), "the administrator no longer invents passwords");

  const teacher = await createUser("admin", { kind: "adult", role: "teacher", email: "made-teacher@example.com", displayName: "Made Teacher" });
  assert.match(teacher.temporaryPassword, temporaryPattern);
  assert.equal(teacher.recoveryCodes.length, 8);
  assert.equal(teacher.user.mustChangePassword, true);
  assert.equal(teacher.user.approvalStatus, "approved");
  assert.equal(teacher.user.teacherStatus, "approved");
  const parent = await createUser("admin", { kind: "adult", role: "parent", email: "made-parent@example.com", displayName: "Made Parent" });
  assert.equal(parent.user.mustChangePassword, true);
  assert.ok(!JSON.stringify(db.select().from(userAuditEvents).all()).includes(teacher.temporaryPassword), "audit never stores the password");
});

test("the approval queue lists waiting students, parents and teacher requests, oldest first", async () => {
  db.insert(adults).values([
    { id: "self-parent", email: "self-parent@example.com", displayName: "Self Parent", passwordHash: "test-only", approvalStatus: "pending", createdAt: "2026-10-01 09:00:00" },
    { id: "self-teacher", email: "self-teacher@example.com", displayName: "Self Applicant", passwordHash: "test-only", teacherStatus: "pending", approvalStatus: "pending", createdAt: "2026-10-03 09:00:00" },
    { id: "declined-parent", email: "declined@example.com", displayName: "Declined Parent", passwordHash: "test-only", approvalStatus: "declined", createdAt: "2026-10-04 09:00:00" },
  ]).run();
  db.insert(students).values({ id: "self-child", username: "self-child", displayName: "Self Child", passwordHash: "test-only", approvalStatus: "pending", createdAt: "2026-10-02 09:00:00" }).run();
  const result = await listUsers(new URLSearchParams());
  assert.deepEqual(result.approvals.users.map((user) => [user.id, user.kind]), [["self-parent", "adult"], ["self-child", "student"], ["self-teacher", "adult"]]);
  assert.equal(result.approvals.total, 3);
  assert.equal(result.stats.pending, 3);
  assert.ok(!JSON.stringify(result.approvals).includes("test-only"), "no password hashes");
  const ids = async (params) => (await listUsers(new URLSearchParams(params))).users.map((user) => user.id).sort();
  assert.deepEqual(await ids({ kind: "adult", filter: "pending" }), ["self-parent", "self-teacher"]);
  assert.deepEqual(await ids({ kind: "student", filter: "pending" }), ["self-child"]);
  assert.deepEqual(await ids({ kind: "adult", filter: "declined" }), ["declined-parent"]);
  await assert.rejects(listUsers(new URLSearchParams({ kind: "student", filter: "teacher" })), /Invalid student filter/);
});

test("approving and declining self sign-ups is audited, and a declined account can be approved later", async () => {
  await updateUser("admin", "self-child", { kind: "student", action: "approve" });
  assert.equal(db.select().from(students).where(eq(students.id, "self-child")).get().approvalStatus, "approved");
  await assert.rejects(updateUser("admin", "self-child", { kind: "student", action: "approve" }), /no longer awaiting approval/);
  await assert.rejects(updateUser("admin", "self-child", { kind: "student", action: "reject" }), /no longer awaiting approval/);

  db.insert(adultSessions).values({ tokenHash: "self-parent-session", adultId: "self-parent", expiresAt: "2099-01-01" }).run();
  await updateUser("admin", "self-parent", { kind: "adult", action: "reject" });
  const declined = db.select().from(adults).where(eq(adults.id, "self-parent")).get();
  assert.equal(declined.approvalStatus, "declined");
  assert.equal(declined.status, "active", "declining is not suspension");
  assert.equal(db.select().from(adultSessions).where(eq(adultSessions.adultId, "self-parent")).all().length, 0);
  await assert.rejects(updateUser("admin", "self-parent", { kind: "adult", action: "reject" }), /no longer awaiting approval/);
  await updateUser("admin", "self-parent", { kind: "adult", action: "approve" });
  assert.equal(db.select().from(adults).where(eq(adults.id, "self-parent")).get().approvalStatus, "approved");
  assert.deepEqual(auditFor("self-parent"), ["account-declined", "account-approved"]);
  assert.deepEqual(auditFor("self-child"), ["account-approved"]);
  await assert.rejects(updateUser("parent", "declined-parent", { kind: "adult", action: "approve" }), /Administrator access required/);
});

test("a teacher request made at sign-up decides the account; an existing parent's request does not", async () => {
  const approved = await updateUser("admin", "self-teacher", { kind: "adult", action: "approve" });
  assert.deepEqual([approved.role, approved.teacherStatus, approved.approvalStatus], ["teacher", "approved", "approved"]);
  db.insert(adults).values([
    { id: "existing-parent", email: "existing-parent@example.com", displayName: "Existing Parent", passwordHash: "test-only", teacherStatus: "pending" },
    { id: "refused-applicant", email: "refused@example.com", displayName: "Refused Applicant", passwordHash: "test-only", teacherStatus: "pending", approvalStatus: "pending" },
  ]).run();
  const kept = await updateUser("admin", "existing-parent", { kind: "adult", action: "reject" });
  assert.deepEqual([kept.role, kept.teacherStatus, kept.approvalStatus], ["parent", "rejected", "approved"], "an existing parent keeps their account");
  const refused = await updateUser("admin", "refused-applicant", { kind: "adult", action: "reject" });
  assert.deepEqual([refused.role, refused.teacherStatus, refused.approvalStatus], ["parent", "rejected", "declined"]);
  assert.equal((await listUsers(new URLSearchParams())).approvals.total, 0);
});

test("approving a teacher applicant declined at sign-up grants the request it was declined with", async () => {
  const declined = (await listUsers(new URLSearchParams({ kind: "adult", filter: "declined" }))).users.find((user) => user.id === "refused-applicant");
  assert.deepEqual([declined.role, declined.teacherStatus], ["parent", "rejected"]);
  const approved = await updateUser("admin", "refused-applicant", { kind: "adult", action: "approve" });
  assert.deepEqual([approved.role, approved.teacherStatus, approved.approvalStatus], ["teacher", "approved", "approved"]);
  assert.deepEqual(auditFor("refused-applicant"), ["reject", "approve"]);
  // A declined parent who never asked to teach is approved as a parent.
  const parent = await updateUser("admin", "declined-parent", { kind: "adult", action: "approve" });
  assert.deepEqual([parent.role, parent.teacherStatus, parent.approvalStatus], ["parent", "none", "approved"]);
  assert.deepEqual(auditFor("declined-parent"), ["account-approved"]);
});

test("suspended accounts leave the approval queue and are decided only once reactivated", async () => {
  db.insert(adults).values({ id: "suspended-applicant", email: "suspended-applicant@example.com", displayName: "Suspended Applicant", passwordHash: "test-only", teacherStatus: "pending", approvalStatus: "pending", status: "suspended" }).run();
  db.insert(students).values({ id: "suspended-child", username: "suspended-child", displayName: "Suspended Child", passwordHash: "test-only", approvalStatus: "pending", status: "suspended" }).run();
  const waiting = async () => {
    const result = await listUsers(new URLSearchParams());
    const pendingAdults = (await listUsers(new URLSearchParams({ kind: "adult", filter: "pending" }))).users.map((user) => user.id);
    const pendingStudents = (await listUsers(new URLSearchParams({ kind: "student", filter: "pending" }))).users.map((user) => user.id);
    assert.equal(result.stats.pending, result.approvals.total);
    return [result.approvals.users.map((user) => user.id).sort(), [...pendingAdults, ...pendingStudents].sort()];
  };
  assert.deepEqual(await waiting(), [[], []]);
  const refused = (error) => error.status === 409 && /Reactivate this account/.test(error.message);
  for (const action of ["approve", "reject"]) {
    await assert.rejects(updateUser("admin", "suspended-applicant", { kind: "adult", action }), refused);
    await assert.rejects(updateUser("admin", "suspended-child", { kind: "student", action }), refused);
  }
  await updateUser("admin", "suspended-applicant", { kind: "adult", status: "active" });
  await updateUser("admin", "suspended-child", { kind: "student", status: "active" });
  assert.deepEqual(await waiting(), [["suspended-applicant", "suspended-child"], ["suspended-applicant", "suspended-child"]]);
  const teacher = await updateUser("admin", "suspended-applicant", { kind: "adult", action: "approve" });
  assert.deepEqual([teacher.role, teacher.approvalStatus], ["teacher", "approved"]);
  assert.equal((await updateUser("admin", "suspended-child", { kind: "student", action: "reject" })).approvalStatus, "declined");
  assert.deepEqual(await waiting(), [[], []]);
});

test("administrators reset student and adult passwords, including other administrators', but never their own", async () => {
  const before = db.select().from(students).where(eq(students.id, "self-child")).get().passwordHash;
  db.insert(studentSessions).values({ tokenHash: "self-child-session", studentId: "self-child", expiresAt: "2099-01-01" }).run();
  const child = await resetPassword("admin", "self-child", { kind: "student" });
  assert.match(child.temporaryPassword, temporaryPattern);
  assert.deepEqual(child.user, { id: "self-child", username: "self-child", displayName: "Self Child", kind: "student" });
  const childRow = db.select().from(students).where(eq(students.id, "self-child")).get();
  assert.notEqual(childRow.passwordHash, before);
  assert.ok(verifyPassword(child.temporaryPassword, childRow.passwordHash));
  assert.equal(childRow.mustChangePassword, true);
  assert.equal(db.select().from(studentSessions).where(eq(studentSessions.studentId, "self-child")).all().length, 0);

  db.insert(adultSessions).values({ tokenHash: "self-teacher-session", adultId: "self-teacher", expiresAt: "2099-01-01" }).run();
  const teacher = await resetPassword("admin", "self-teacher", { kind: "adult" });
  const teacherRow = db.select().from(adults).where(eq(adults.id, "self-teacher")).get();
  assert.ok(verifyPassword(teacher.temporaryPassword, teacherRow.passwordHash));
  assert.equal(teacherRow.mustChangePassword, true);
  assert.equal(db.select().from(adultSessions).where(eq(adultSessions.adultId, "self-teacher")).all().length, 0);

  db.insert(adults).values({ id: "second-admin", email: "second-admin@example.com", displayName: "Second Administrator", passwordHash: "test-only", role: "admin" }).run();
  assert.match((await resetPassword("admin", "second-admin", { kind: "adult" })).temporaryPassword, temporaryPattern);
  await assert.rejects(resetPassword("admin", "admin", { kind: "adult" }), (error) => error.status === 409 && /your own password/.test(error.message));
  await assert.rejects(resetPassword("self-teacher", "self-child", { kind: "student" }), /Administrator access required/);
  await assert.rejects(resetPassword("admin", "missing", { kind: "student" }), (error) => error.status === 404);
  await assert.rejects(resetPassword("admin", "self-child", { kind: "robot" }), /account type/);
  for (const id of ["self-child", "self-teacher", "second-admin"]) assert.ok(auditFor(id).includes("password-reset"), id);
  const everything = JSON.stringify(db.select().from(userAuditEvents).all());
  for (const secret of [child.temporaryPassword, teacher.temporaryPassword]) assert.ok(!everything.includes(secret));
});

test("recent changes made within the same second are listed newest first", async () => {
  const second = "2098-06-01 10:00:00";
  // Ids sort the opposite way to insertion, so only the recorded order can put them right.
  db.insert(userAuditEvents).values([
    { id: "same-second-z", actorId: "admin", targetId: "hello-me", targetType: "lesson", action: "lesson-approved", detailsJson: "{}", createdAt: second },
    { id: "same-second-m", actorId: "admin", targetId: "my-family", targetType: "lesson", action: "lesson-approved", detailsJson: "{}", createdAt: second },
    { id: "same-second-a", actorId: "admin", targetId: "food-please", targetType: "lesson", action: "lesson-approved", detailsJson: "{}", createdAt: second },
  ]).run();
  const { audit } = await listUsers(new URLSearchParams());
  assert.deepEqual(audit.filter((event) => event.id.startsWith("same-second-")).map((event) => event.id), ["same-second-a", "same-second-m", "same-second-z"]);
});

test("recent changes name what each change was about, in both languages, without the stored details", async () => {
  const { user } = await createUser("admin", { kind: "student", username: "labelled-child", displayName: "Labelled Child" });
  const later = "2099-01-01 00:00:00";
  db.insert(userAuditEvents).values([
    { id: "label-lesson", actorId: "admin", targetId: "hello-me", targetType: "lesson", action: "lesson-approved", detailsJson: "{}", createdAt: later },
    { id: "label-topic", actorId: "admin", targetId: "pohela-boishakh", targetType: "topic", action: "topic-version-approved", detailsJson: "{}", createdAt: later },
    { id: "label-book", actorId: "admin", targetId: "history-9-10", targetType: "library-source", action: "library-link-updated", detailsJson: "{}", createdAt: later },
    { id: "label-gone", actorId: "admin", targetId: "deleted-class", targetType: "class", action: "class-deleted", detailsJson: JSON.stringify({ name: "Old class" }), createdAt: later },
  ]).run();
  const { audit } = await listUsers(new URLSearchParams());
  const label = (predicate) => audit.find(predicate)?.targetLabel;
  assert.deepEqual(label((event) => event.targetId === user.id && event.action === "created"), { en: "Labelled Child (labelled-child)", bn: "Labelled Child (labelled-child)" });
  assert.deepEqual(label((event) => event.id === "label-lesson"), { en: "Hello, this is me", bn: "হ্যালো, এই আমি" });
  assert.deepEqual(label((event) => event.id === "label-topic"), { en: "Pohela Boishakh — the Bengali New Year", bn: "পহেলা বৈশাখ — বাংলা নববর্ষ" });
  assert.deepEqual(label((event) => event.id === "label-book"), { en: "History of Bangladesh and World Civilization", bn: "বাংলাদেশের ইতিহাস ও বিশ্বসভ্যতা" });
  assert.equal(label((event) => event.id === "label-gone"), null, "a deleted target has no name");
  assert.ok(audit.every((event) => event.detailsJson === undefined && event.actorId === undefined));
  const adultEvent = audit.find((event) => event.targetType === "adult");
  if (adultEvent) assert.equal(typeof adultEvent.targetLabel.en, "string");
});

test("accounts created in the same second are listed in the order they were created", async () => {
  // A class upload creates every account in one transaction, so they share one created_at second.
  // Ids are shuffled against that order, so only the recorded order can put them right.
  const second = "2001-01-01 00:00:00";
  const pad = (n) => String(n).padStart(2, "0");
  const shuffled = (prefix, i, size) => `${prefix}-${pad((i * 7) % size)}`;
  db.transaction((tx) => {
    for (let i = 0; i < 30; i++) tx.insert(students).values({ id: shuffled("same-second-child", i, 30), username: `same-second-${pad(i)}`, displayName: `Same Second ${pad(i)}`, passwordHash: "test-only", approvalStatus: "pending", createdAt: second }).run();
    for (let i = 0; i < 4; i++) tx.insert(adults).values({ id: shuffled("same-second-adult", i, 4), email: `same-second-${i}@example.com`, displayName: `Same Second Adult ${i}`, passwordHash: "test-only", approvalStatus: "pending", createdAt: second }).run();
  });
  const names = (users) => users.map((user) => user.displayName);
  const studentName = (i) => `Same Second ${pad(i)}`;
  const newestFirst = Array.from({ length: 30 }, (_, i) => studentName(29 - i));
  const pageOf = async (page) => names((await listUsers(new URLSearchParams({ kind: "student", q: "Same Second", page: String(page) }))).users);
  assert.deepEqual(await pageOf(1), newestFirst.slice(0, 25));
  assert.deepEqual(await pageOf(2), newestFirst.slice(25));
  const adultsListed = names((await listUsers(new URLSearchParams({ kind: "adult", q: "Same Second Adult" }))).users);
  assert.deepEqual(adultsListed, ["Same Second Adult 3", "Same Second Adult 2", "Same Second Adult 1", "Same Second Adult 0"]);

  const queue = (await listUsers(new URLSearchParams())).approvals.users.filter((user) => user.displayName.startsWith("Same Second"));
  assert.deepEqual(names(queue.filter((user) => user.kind === "student")), Array.from({ length: 30 }, (_, i) => studentName(i)), "the queue is oldest first");
  assert.deepEqual(names(queue.filter((user) => user.kind === "adult")), ["Same Second Adult 0", "Same Second Adult 1", "Same Second Adult 2", "Same Second Adult 3"]);
  db.delete(students).where(like(students.username, "same-second-%")).run();
  db.delete(adults).where(like(adults.email, "same-second-%")).run();
});

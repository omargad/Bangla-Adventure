import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(path.join(os.tmpdir(), "bangla-account-controls-test-"));
process.env.DATABASE_PATH = path.join(dir, "test.db");
process.env.MEDIA_ROOT = path.join(dir, "media");
const { getDb } = await import("../db/index.ts");
const schema = await import("../db/schema.ts");
const { adults, adultSessions, classes, learnerProfiles, mediaAssets, parentStudentLinks, recoveryCodes, skillProgress, students, userAuditEvents, videoReviews } = schema;
const auth = await import("../lib/auth.ts");
const studentAuth = await import("../lib/student-auth.ts");
const { accountDeletionBlocker, deleteOwnAccount, exportAccountData, listUsers } = await import("../lib/user-management.ts");
const { hashPassword, hashSessionToken } = await import("../lib/password.ts");
const db = await getDb();
after(() => rmSync(dir, { recursive: true, force: true }));

const password = "account-controls-1";
const passwordHash = hashPassword(password);
db.insert(adults).values([
  { id: "admin", email: "admin@example.com", displayName: "Admin Akter", passwordHash, role: "admin" },
  { id: "teacher", email: "teacher@example.com", displayName: "Teacher Rahman", passwordHash, role: "teacher", teacherStatus: "approved" },
  { id: "parent", email: "parent@example.com", displayName: "Parent Begum", passwordHash },
  { id: "suspended-parent", email: "suspended@example.com", displayName: "Suspended Parent", passwordHash, status: "suspended" },
]).run();
db.insert(students).values([
  { id: "maya", username: "maya", displayName: "Maya", passwordHash },
  { id: "paused-child", username: "paused-child", displayName: "Paused", passwordHash, status: "suspended" },
]).run();
db.insert(parentStudentLinks).values({ id: "link", parentId: "parent", studentId: "maya" }).run();
db.insert(classes).values({ id: "class", teacherId: "teacher", name: "Sunday Class", joinCode: "ABC234" }).run();
const session = (adultId, token) => db.insert(adultSessions).values({ tokenHash: hashSessionToken(token), adultId, expiresAt: "2099-01-01T00:00:00.000Z" }).run();
const audits = (targetId) => db.select().from(userAuditEvents).where(eq(userAuditEvents.targetId, targetId)).all();
const account = (id) => db.select(auth.publicAdultFields).from(adults).where(eq(adults.id, id)).get();

test("a teacher who still teaches a class cannot delete the account; the classes are kept", async () => {
  const refusal = await accountDeletionBlocker("teacher");
  assert.equal(refusal.status, 409);
  assert.match(refusal.message, /Ask an administrator to move them to another teacher/);
  assert.match(refusal.messageBn, /প্রশাসককে/);
  await assert.rejects(deleteOwnAccount("teacher"), (error) => error.status === 409 && /still teach/.test(error.message));
  assert.ok(account("teacher"));
  assert.ok(db.select().from(classes).where(eq(classes.id, "class")).get(), "the class and its records stay");
});

test("an administrator still cannot delete their own account", async () => {
  const refusal = await accountDeletionBlocker("admin");
  assert.equal(refusal.status, 409);
  assert.match(refusal.message, /Ask another administrator to change your role/);
  assert.ok(refusal.messageBn);
  await assert.rejects(deleteOwnAccount("admin"), (error) => error.status === 409);
  assert.equal(await accountDeletionBlocker("parent"), null);
});

test("the data export holds a parent's linked children and the account's own history", async () => {
  await auth.renewRecoveryCodes(account("parent"));
  const data = await exportAccountData("parent");
  assert.deepEqual(data.account, { email: "parent@example.com", displayName: "Parent Begum", role: "parent", teacherStatus: "none", approvalStatus: "approved", createdAt: data.account.createdAt });
  assert.deepEqual(data.linkedChildren.map(({ displayName, username }) => [displayName, username]), [["Maya", "maya"]]);
  assert.deepEqual(data.classesTaught, []);
  assert.deepEqual(data.auditEvents.map((event) => [event.action, event.madeBy]), [["recovery-codes-replaced", "you"]]);
  assert.ok(!JSON.stringify(data).includes("passwordHash") && !JSON.stringify(data).includes(passwordHash));
});

test("the data export holds a teacher's classes by name and the changes the account made, without other people's details", async () => {
  db.insert(userAuditEvents).values({ id: "teacher-did", actorId: "teacher", targetId: "maya", targetType: "student", action: "class-allocated", detailsJson: JSON.stringify({ classId: "class" }) }).run();
  const data = await exportAccountData("teacher");
  assert.deepEqual(data.classesTaught.map((item) => item.name), ["Sunday Class"]);
  assert.deepEqual(data.linkedChildren, []);
  const made = data.auditEvents.find((event) => event.action === "class-allocated");
  assert.deepEqual(Object.keys(made).sort(), ["action", "createdAt", "madeBy", "targetType"], "no target id or details of someone else's record");
});

test("replacing recovery codes and signing out everywhere are audited with the account's name", async () => {
  session("parent", "parent-phone");
  session("parent", "parent-laptop");
  await auth.signOutEverywhere(account("parent"));
  assert.equal(db.select().from(adultSessions).where(eq(adultSessions.adultId, "parent")).all().length, 0);
  const events = audits("parent");
  const signedOut = events.find((event) => event.action === "signed-out-everywhere");
  assert.equal(signedOut.actorId, "parent");
  assert.deepEqual(JSON.parse(signedOut.detailsJson), { sessions: 2, targetLabel: { en: "Parent Begum", bn: "Parent Begum" } });
  assert.ok(events.some((event) => event.action === "recovery-codes-replaced" && event.actorId === "parent"));
});

test("password recovery is audited", async () => {
  const [code] = await auth.issueRecoveryCodes("parent");
  const adult = await auth.consumeRecoveryCode("parent@example.com", code);
  await auth.recoverAdultPassword(adult, "recovered-by-owner-1");
  const recovered = audits("parent").find((event) => event.action === "password-recovered");
  assert.equal(recovered.actorId, "parent");
  assert.ok(!recovered.detailsJson.includes("recovered-by-owner-1"));
  assert.ok(await auth.verifyAdultCredentials("parent@example.com", "recovered-by-owner-1"));
});

test("deleting an account removes its records and files in one go, audits it and keeps shared video checks", async () => {
  db.insert(adults).values({ id: "leaver", email: "leaver@example.com", displayName: "Leaving Teacher", passwordHash, role: "teacher", teacherStatus: "approved" }).run();
  db.insert(learnerProfiles).values({ id: "home-learner", ownerEmail: "leaver@example.com", displayName: "Home Learner", ageBand: "6-8" }).run();
  db.insert(skillProgress).values({ id: "progress", profileId: "home-learner", lessonId: "hello-me", sessionId: "session-hello-me-listening", skill: "listening", score: 80 }).run();
  db.insert(mediaAssets).values({ id: "recording", lessonId: "hello-me", slot: "word-0", ownerEmail: "leaver@example.com", objectKey: "human-audio/hello-me/word-0/a.webm", originalName: "a.webm", contentType: "audio/webm", byteSize: 4, consentConfirmed: true }).run();
  db.insert(videoReviews).values({ id: "video-check", lessonId: "hello-me", ownerEmail: "leaver@example.com", videoId: "abc", status: "approved", suitabilityStatus: "unsuitable" }).run();
  const file = path.join(process.env.MEDIA_ROOT, "human-audio/hello-me/word-0/a.webm");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "test");
  session("leaver", "leaver-session");
  await auth.issueRecoveryCodes("leaver");

  await deleteOwnAccount("leaver");
  assert.equal(account("leaver"), undefined);
  assert.equal(db.select().from(learnerProfiles).where(eq(learnerProfiles.ownerEmail, "leaver@example.com")).all().length, 0);
  assert.equal(db.select().from(skillProgress).where(eq(skillProgress.profileId, "home-learner")).all().length, 0);
  assert.equal(db.select().from(mediaAssets).where(eq(mediaAssets.id, "recording")).all().length, 0);
  assert.equal(db.select().from(adultSessions).where(eq(adultSessions.adultId, "leaver")).all().length, 0);
  assert.equal(db.select().from(recoveryCodes).where(eq(recoveryCodes.adultId, "leaver")).all().length, 0);
  assert.equal(existsSync(file), false, "the recording file is removed after the deletion commits");
  const kept = db.select().from(videoReviews).where(eq(videoReviews.id, "video-check")).get();
  assert.match(kept.ownerEmail, /^deleted-staff:/);
  const [deleted] = audits("leaver").filter((event) => event.action === "account-deleted");
  assert.equal(deleted.actorId, "leaver");
  assert.deepEqual(JSON.parse(deleted.detailsJson), { role: "teacher", targetLabel: { en: "Leaving Teacher", bn: "Leaving Teacher" } });
  const listed = (await listUsers("admin", new URLSearchParams())).audit.find((event) => event.action === "account-deleted");
  assert.deepEqual([listed.actor, listed.targetLabel], [{ kind: "deleted" }, { en: "Leaving Teacher", bn: "Leaving Teacher" }]);
});

test("a failed deletion changes nothing", async () => {
  db.insert(adults).values({ id: "stays", email: "stays@example.com", displayName: "Stays", passwordHash }).run();
  db.insert(learnerProfiles).values({ id: "stays-learner", ownerEmail: "stays@example.com", displayName: "Kept", ageBand: "6-8" }).run();
  // A class given to the account between the check and the deletion stops the whole transaction.
  db.insert(classes).values({ id: "late-class", teacherId: "stays", name: "Late Class", joinCode: "LAT234" }).run();
  await assert.rejects(deleteOwnAccount("stays"), (error) => error.status === 409);
  assert.ok(account("stays"));
  assert.ok(db.select().from(learnerProfiles).where(eq(learnerProfiles.id, "stays-learner")).get());
  assert.equal(audits("stays").length, 0);
});

test("a suspended account is recognised only with the right password", async () => {
  assert.equal(await auth.verifyAdultCredentials("suspended@example.com", password), null, "suspended accounts never sign in");
  assert.equal((await auth.verifyAdultCredentials("suspended@example.com", password, { allowSuspended: true })).status, "suspended");
  assert.equal(await auth.verifyAdultCredentials("suspended@example.com", "wrong-password-1", { allowSuspended: true }), null);
  assert.equal(await studentAuth.verifyStudentCredentials("paused-child", password), null);
  assert.equal((await studentAuth.verifyStudentCredentials("paused-child", password, { allowSuspended: true })).status, "suspended");
  assert.equal(await studentAuth.verifyStudentCredentials("paused-child", "wrong-password", { allowSuspended: true }), null);
  assert.match(auth.ACCOUNT_SUSPENDED.error, /suspended\. Please contact the administrator/);
  assert.match(auth.ACCOUNT_SUSPENDED.errorBn, /করুন।$/, "adults are addressed politely");
  assert.match(studentAuth.STUDENT_ACCOUNT_SUSPENDED.errorBn, /বলো।$/, "students are addressed informally");
});

test("student sign-in checks a password even for an unknown or suspended username", async () => {
  const time = async (username) => {
    const start = performance.now();
    for (let i = 0; i < 4; i++) await studentAuth.verifyStudentCredentials(username, "not-the-password");
    return performance.now() - start;
  };
  await time("maya");
  const known = await time("maya");
  const unknown = await time("nobody-here");
  const suspended = await time("paused-child");
  assert.ok(unknown > known * 0.4, `unknown ${unknown.toFixed(1)} ms vs known ${known.toFixed(1)} ms`);
  assert.ok(suspended > known * 0.4, `suspended ${suspended.toFixed(1)} ms vs known ${known.toFixed(1)} ms`);
});

test("two student sign-ups racing for one username: one account, and the other is told the name is taken", async () => {
  const results = await Promise.all([
    studentAuth.registerStudent("racing-name", "First", "first-password"),
    studentAuth.registerStudent("racing-name", "Second", "second-password"),
  ]);
  assert.equal(results.filter((result) => "id" in result).length, 1);
  assert.deepEqual(results.find((result) => "error" in result), { error: "That username is already taken.", errorBn: "এই ইউজারনেমটি আগেই নেওয়া হয়েছে।" });
  assert.equal(db.select().from(students).where(eq(students.username, "racing-name")).all().length, 1);
  // The same name in other letter case is the same username.
  assert.equal((await studentAuth.registerStudent("Racing-Name", "Third", "third-password")).error, "That username is already taken.");
});

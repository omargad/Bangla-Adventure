import { and, asc, count, desc, eq, inArray, like, or, type SQL } from "drizzle-orm";
import { getDb } from "../db";
import { adults, adultSessions, classes, classStudents, recoveryCodes, students, studentSessions, userAuditEvents } from "../db/schema";
import { lessons } from "../app/curriculum";
import type { Bilingual } from "../app/topics-content";
import { canManageUsers, isRole, isStatus } from "./roles";
import { generateRecoveryCode, generateTemporaryPassword, hashPasswordAsync, hashSessionToken, normalizeRecoveryCode } from "./password";
import { listStaffTopics } from "./curriculum-catalog";
import { libraryOverrides } from "./library-catalog";
import { mergeCatalog } from "./library-links";

/** `messageBn` is the same message in Bangla, sent as `errorBn` where a bilingual page shows it. */
export class UserManagementError extends Error {
  constructor(message: string, public status = 400, public messageBn?: string) { super(message); }
}

const adultFields = { id: adults.id, email: adults.email, displayName: adults.displayName, role: adults.role, status: adults.status, teacherStatus: adults.teacherStatus, approvalStatus: adults.approvalStatus, mustChangePassword: adults.mustChangePassword, createdAt: adults.createdAt };
const studentFields = { id: students.id, username: students.username, displayName: students.displayName, status: students.status, approvalStatus: students.approvalStatus, mustChangePassword: students.mustChangePassword, createdAt: students.createdAt };
type Db = Awaited<ReturnType<typeof getDb>>;
type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** How many waiting accounts the approval queue shows at once, oldest first. */
export const APPROVAL_QUEUE_LIMIT = 50;
// A self-registered account, or a teacher request made at sign-up or later, waits for an administrator.
// A suspended account is decided only once it is reactivated, so it leaves the queue meanwhile.
const adultAwaitingApproval = and(eq(adults.status, "active"), or(eq(adults.approvalStatus, "pending"), eq(adults.teacherStatus, "pending")))!;
const studentAwaitingApproval = and(eq(students.status, "active"), eq(students.approvalStatus, "pending"))!;
const SUSPENDED_DECISION = ["Reactivate this account before approving or declining it.", "অনুমোদন বা প্রত্যাখ্যানের আগে অ্যাকাউন্টটি আবার চালু করুন।"] as const;
const NOT_AWAITING = ["This account is no longer awaiting approval.", "এই অ্যাকাউন্টটি আর অনুমোদনের অপেক্ষায় নেই।"] as const;
const NOT_FOUND = ["User not found.", "ব্যবহারকারী পাওয়া যায়নি।"] as const;
const CHOOSE_KIND = ["Choose an account type.", "অ্যাকাউন্টের ধরন বেছে নিন।"] as const;
/** A refusal in both languages. */
const refuse = ([en, bn]: readonly [string, string], status = 400) => new UserManagementError(en, status, bn);

function authorize(tx: Transaction, actorId: string) {
  const actor = tx.select().from(adults).where(eq(adults.id, actorId)).get();
  if (!actor || !canManageUsers(actor)) throw refuse(["Administrator access required.", "প্রশাসকের অনুমতি প্রয়োজন।"], 403);
}

function record(tx: Transaction, actorId: string, targetId: string, targetType: string, action: string, details: object = {}) {
  tx.insert(userAuditEvents).values({ id: crypto.randomUUID(), actorId, targetId, targetType, action, detailsJson: JSON.stringify(details) }).run();
}

/**
 * A readable name for each audit event's target (a person, class, topic, lesson or textbook), keyed
 * `${targetType}:${targetId}`. A target that no longer exists (a deleted class, say) has none.
 */
async function auditTargetLabels(db: Db, events: Array<{ targetType: string; targetId: string }>): Promise<Map<string, Bilingual>> {
  const ids = (type: string) => [...new Set(events.filter((event) => event.targetType === type).map((event) => event.targetId))];
  const labels = new Map<string, Bilingual>();
  const put = (type: string, id: string, en: string, bn = en) => labels.set(`${type}:${id}`, { en, bn });
  const adultIds = ids("adult");
  if (adultIds.length) for (const row of db.select({ id: adults.id, name: adults.displayName }).from(adults).where(inArray(adults.id, adultIds)).all()) put("adult", row.id, row.name);
  const studentIds = ids("student");
  if (studentIds.length) for (const row of db.select({ id: students.id, name: students.displayName, username: students.username }).from(students).where(inArray(students.id, studentIds)).all()) put("student", row.id, `${row.name} (${row.username})`);
  const classIds = ids("class");
  if (classIds.length) for (const row of db.select({ id: classes.id, name: classes.name }).from(classes).where(inArray(classes.id, classIds)).all()) put("class", row.id, row.name);
  const rosterIds = ids("class-student");
  if (rosterIds.length) for (const row of db.select({ id: classStudents.id, name: classStudents.displayName }).from(classStudents).where(inArray(classStudents.id, rosterIds)).all()) put("class-student", row.id, row.name);
  for (const id of ids("lesson")) { const lesson = lessons.find((item) => item.id === id); if (lesson) put("lesson", id, lesson.title, lesson.titleBn); }
  const topicIds = ids("topic");
  if (topicIds.length) for (const topic of await listStaffTopics()) if (topicIds.includes(topic.id)) put("topic", topic.id, topic.title.en, topic.title.bn);
  const bookIds = ids("library-source");
  if (bookIds.length) for (const book of mergeCatalog(await libraryOverrides(), { includeHidden: true })) if (bookIds.includes(book.id)) put("library-source", book.id, book.titleEn, book.titleBn);
  return labels;
}

export async function listUsers(params: URLSearchParams) {
  const db = await getDb();
  const kind = params.get("kind") ?? "adult";
  const filter = params.get("filter") ?? "all";
  const search = params.get("q")?.trim().slice(0, 120) ?? "";
  const page = Math.max(1, Math.min(10000, Number.parseInt(params.get("page") ?? "1", 10) || 1));
  const pageSize = 25;
  if (!["adult", "student"].includes(kind) || !["all", "pending", "declined", "parent", "teacher", "admin", "suspended"].includes(filter)) throw refuse(["Invalid user filter.", "ব্যবহারকারী বাছাইটি সঠিক নয়।"]);
  const conditions: SQL[] = [];
  let users;
  let total;
  if (kind === "student") {
    if (!["all", "pending", "declined", "suspended"].includes(filter)) throw refuse(["Invalid student filter.", "শিক্ষার্থী বাছাইটি সঠিক নয়।"]);
    if (search) conditions.push(or(like(students.displayName, `%${search}%`), like(students.username, `%${search}%`))!);
    if (filter === "suspended") conditions.push(eq(students.status, "suspended"));
    else if (filter === "pending") conditions.push(studentAwaitingApproval);
    else if (filter === "declined") conditions.push(eq(students.approvalStatus, "declined"));
    users = db.select(studentFields).from(students).where(and(...conditions)).orderBy(desc(students.createdAt), students.id).limit(pageSize).offset((page - 1) * pageSize).all().map((user) => ({ ...user, role: "student", teacherStatus: "none", kind }));
    total = db.select({ value: count() }).from(students).where(and(...conditions)).get()!.value;
  } else {
    if (search) conditions.push(or(like(adults.displayName, `%${search}%`), like(adults.email, `%${search}%`))!);
    if (filter === "pending") conditions.push(adultAwaitingApproval);
    else if (filter === "declined") conditions.push(eq(adults.approvalStatus, "declined"));
    else if (filter === "suspended") conditions.push(eq(adults.status, "suspended"));
    else if (isRole(filter)) conditions.push(eq(adults.role, filter));
    users = db.select(adultFields).from(adults).where(and(...conditions)).orderBy(desc(adults.createdAt), adults.id).limit(pageSize).offset((page - 1) * pageSize).all().map((user) => ({ ...user, kind }));
    total = db.select({ value: count() }).from(adults).where(and(...conditions)).get()!.value;
  }
  const pendingAdults = db.select({ value: count() }).from(adults).where(adultAwaitingApproval).get()!.value;
  const pendingStudents = db.select({ value: count() }).from(students).where(studentAwaitingApproval).get()!.value;
  const stats = {
    adults: db.select({ value: count() }).from(adults).get()!.value,
    students: db.select({ value: count() }).from(students).get()!.value,
    teachers: db.select({ value: count() }).from(adults).where(and(eq(adults.role, "teacher"), eq(adults.status, "active"), eq(adults.teacherStatus, "approved"))).get()!.value,
    pending: pendingAdults + pendingStudents,
  };
  // One queue for students, parents and teacher requests, oldest first.
  const approvals = {
    users: [
      ...db.select(adultFields).from(adults).where(adultAwaitingApproval).orderBy(asc(adults.createdAt), adults.id).limit(APPROVAL_QUEUE_LIMIT).all().map((user) => ({ ...user, kind: "adult" as const })),
      ...db.select(studentFields).from(students).where(studentAwaitingApproval).orderBy(asc(students.createdAt), students.id).limit(APPROVAL_QUEUE_LIMIT).all().map((user) => ({ ...user, role: "student", teacherStatus: "none", kind: "student" as const })),
    ].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).slice(0, APPROVAL_QUEUE_LIMIT),
    total: stats.pending,
  };
  const events = db.select({ id: userAuditEvents.id, action: userAuditEvents.action, targetType: userAuditEvents.targetType, targetId: userAuditEvents.targetId, createdAt: userAuditEvents.createdAt })
    .from(userAuditEvents).orderBy(desc(userAuditEvents.createdAt), desc(userAuditEvents.id)).limit(15).all();
  const labels = await auditTargetLabels(db, events);
  const audit = events.map((event) => ({ ...event, targetLabel: labels.get(`${event.targetType}:${event.targetId}`) ?? null }));
  return { users, total, page, pageSize, stats, approvals, audit };
}

export async function updateUser(actorId: string, id: string, input: Record<string, unknown>) {
  if (input.kind !== "adult" && input.kind !== "student") throw refuse(CHOOSE_KIND);
  if (input.displayName !== undefined && (typeof input.displayName !== "string" || !input.displayName.trim() || input.displayName.trim().length > 60)) throw refuse(["Use a display name of 1–60 characters.", "১–৬০ অক্ষরের একটি প্রদর্শিত নাম দিন।"]);
  if (input.status !== undefined && !isStatus(input.status)) throw refuse(["Invalid account status.", "অ্যাকাউন্টের অবস্থাটি সঠিক নয়।"]);
  if (input.role !== undefined && !isRole(input.role)) throw refuse(["Invalid account role.", "অ্যাকাউন্টের ভূমিকাটি সঠিক নয়।"]);
  const action = input.action ?? "update";
  if (!["update", "approve", "reject", "revoke-sessions"].includes(String(action))) throw refuse(["Invalid management action.", "এই কাজটি করা যায় না।"]);
  const deciding = action === "approve" || action === "reject";
  const db = await getDb();
  return db.transaction((tx) => {
    authorize(tx, actorId);
    if (input.kind === "student") {
      if (input.role !== undefined) throw refuse(["Student accounts cannot be promoted to staff.", "শিক্ষার্থীর অ্যাকাউন্টকে শিক্ষক বা প্রশাসক করা যায় না।"]);
      const current = tx.select(studentFields).from(students).where(eq(students.id, id)).get();
      if (!current) throw refuse(NOT_FOUND, 404);
      const next = { displayName: typeof input.displayName === "string" ? input.displayName.trim() : current.displayName, status: isStatus(input.status) ? input.status : current.status, approvalStatus: current.approvalStatus };
      // Approve a waiting or previously declined account; decline only one that is waiting.
      if (deciding) {
        if (current.status !== "active") throw refuse(SUSPENDED_DECISION, 409);
        if (action === "approve" ? current.approvalStatus === "approved" : current.approvalStatus !== "pending") throw refuse(NOT_AWAITING, 409);
        next.approvalStatus = action === "approve" ? "approved" : "declined";
      }
      tx.update(students).set(next).where(eq(students.id, id)).run();
      if (next.status !== current.status || next.approvalStatus === "declined" || action === "revoke-sessions") tx.delete(studentSessions).where(eq(studentSessions.studentId, id)).run();
      record(tx, actorId, id, "student", deciding ? `account-${action === "approve" ? "approved" : "declined"}` : String(action), { previousStatus: current.status, status: next.status, approvalStatus: next.approvalStatus });
      return { ...current, ...next };
    }
    const current = tx.select(adultFields).from(adults).where(eq(adults.id, id)).get();
    if (!current) throw refuse(NOT_FOUND, 404);
    const next = {
      displayName: typeof input.displayName === "string" ? input.displayName.trim() : current.displayName,
      status: isStatus(input.status) ? input.status : current.status,
      role: isRole(input.role) ? input.role : current.role,
      teacherStatus: current.teacherStatus,
      approvalStatus: current.approvalStatus,
    };
    let audited = String(action);
    if (deciding && current.status !== "active") throw refuse(SUSPENDED_DECISION, 409);
    // Declining a teacher applicant at sign-up refuses the account and the request together (only that sets
    // both), so approving the account later grants the request too rather than silently dropping it.
    const declinedApplicant = action === "approve" && current.approvalStatus === "declined" && current.teacherStatus === "rejected";
    if (deciding && (current.teacherStatus === "pending" || declinedApplicant)) {
      if (current.role !== "parent") throw refuse(["This request is no longer awaiting approval.", "এই আবেদনটি আর অনুমোদনের অপেক্ষায় নেই।"], 409);
      next.role = action === "approve" ? "teacher" : "parent";
      next.teacherStatus = action === "approve" ? "approved" : "rejected";
      // A teacher request made at sign-up is also the account's approval; an existing parent's account is unaffected.
      if (current.approvalStatus !== "approved") next.approvalStatus = action === "approve" ? "approved" : "declined";
    } else if (deciding) {
      if (action === "approve" ? current.approvalStatus === "approved" : current.approvalStatus !== "pending") throw refuse(NOT_AWAITING, 409);
      next.approvalStatus = action === "approve" ? "approved" : "declined";
      audited = `account-${action === "approve" ? "approved" : "declined"}`;
    } else if (next.role !== current.role) next.teacherStatus = next.role === "teacher" ? "approved" : "none";
    if (id === actorId && (next.role !== current.role || next.status !== current.status)) throw refuse(["You cannot change your own role or suspend your own account.", "নিজের ভূমিকা বদলানো বা নিজের অ্যাকাউন্ট স্থগিত করা যায় না।"], 409);
    if (current.role === "admin" && current.status === "active" && (next.role !== "admin" || next.status !== "active")) {
      const remaining = tx.select({ value: count() }).from(adults).where(and(eq(adults.role, "admin"), eq(adults.status, "active"))).get()!.value;
      if (remaining <= 1) throw refuse(["At least one active administrator must remain.", "অন্তত একজন সক্রিয় প্রশাসক থাকতে হবে।"], 409);
    }
    tx.update(adults).set(next).where(eq(adults.id, id)).run();
    if (next.role !== current.role || next.status !== current.status || next.approvalStatus === "declined" || action === "revoke-sessions") tx.delete(adultSessions).where(eq(adultSessions.adultId, id)).run();
    record(tx, actorId, id, "adult", audited, { previousRole: current.role, role: next.role, previousStatus: current.status, status: next.status, teacherStatus: next.teacherStatus, approvalStatus: next.approvalStatus });
    return { ...current, ...next };
  });
}

/**
 * Create an approved account with a generated temporary password that the owner must replace at
 * first sign-in. The password, and an adult's recovery codes, are returned once and only hashes are stored.
 */
export async function createUser(actorId: string, input: Record<string, unknown>) {
  const name = typeof input.displayName === "string" ? input.displayName.trim() : "";
  const kind = input.kind;
  if (!name || name.length > 60 || !["adult", "student"].includes(String(kind))) throw refuse(["Choose an account type and a display name of 1–60 characters.", "অ্যাকাউন্টের ধরন ও ১–৬০ অক্ষরের একটি প্রদর্শিত নাম দিন।"]);
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const username = typeof input.username === "string" ? input.username.trim().toLowerCase() : "";
  if (kind === "adult" && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120 || !["parent", "teacher"].includes(String(input.role)))) throw refuse(["Choose parent or teacher and a valid email address.", "অভিভাবক বা শিক্ষক বেছে নিন এবং একটি সঠিক ইমেইল ঠিকানা দিন।"]);
  if (kind === "student" && !/^[a-z0-9._-]{3,40}$/.test(username)) throw refuse(["Choose a username of 3–40 letters, numbers, dots, dashes or underscores.", "৩–৪০টি অক্ষর, সংখ্যা, ডট, ড্যাশ বা আন্ডারস্কোর দিয়ে একটি ইউজারনেম দিন।"]);
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPasswordAsync(temporaryPassword);
  const codes = kind === "adult" ? Array.from({ length: 8 }, () => generateRecoveryCode()) : [];
  const db = await getDb();
  return db.transaction((tx) => {
    authorize(tx, actorId);
    const id = crypto.randomUUID();
    if (kind === "student") {
      const user = tx.insert(students).values({ id, username, displayName: name, passwordHash, mustChangePassword: true }).onConflictDoNothing({ target: students.username }).returning(studentFields).get();
      if (!user) throw refuse(["That username is already taken.", "এই ইউজারনেমটি আগেই নেওয়া হয়েছে।"], 409);
      record(tx, actorId, id, "student", "created");
      return { user: { ...user, kind: "student" as const }, temporaryPassword };
    }
    const role = input.role === "teacher" ? "teacher" : "parent";
    const user = tx.insert(adults).values({ id, email, displayName: name, passwordHash, role, teacherStatus: role === "teacher" ? "approved" : "none", mustChangePassword: true })
      .onConflictDoNothing({ target: adults.email }).returning(adultFields).get();
    if (!user) throw refuse(["That email is already registered.", "এই ইমেইলটি আগেই নিবন্ধিত।"], 409);
    tx.insert(recoveryCodes).values(codes.map((code) => ({ id: crypto.randomUUID(), adultId: id, codeHash: hashSessionToken(normalizeRecoveryCode(code)) }))).run();
    record(tx, actorId, id, "adult", "created", { role });
    return { user: { ...user, kind: "adult" as const }, temporaryPassword, recoveryCodes: codes };
  });
}

/**
 * Give a student or adult a new temporary password (for a forgotten one): it must be replaced at the
 * next sign-in and every existing session ends. Administrators may reset other administrators, never
 * themselves. The password is returned once and only its hash is stored.
 */
export async function resetPassword(actorId: string, id: string, input: Record<string, unknown>) {
  if (input.kind !== "adult" && input.kind !== "student") throw refuse(CHOOSE_KIND);
  if (id === actorId) throw refuse(["You cannot reset your own password here. Change it from My account.", "এখানে নিজের পাসওয়ার্ড রিসেট করা যায় না। ‘আমার অ্যাকাউন্ট’ থেকে বদলান।"], 409);
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPasswordAsync(temporaryPassword);
  const db = await getDb();
  return db.transaction((tx) => {
    authorize(tx, actorId);
    if (input.kind === "student") {
      const user = tx.update(students).set({ passwordHash, mustChangePassword: true }).where(eq(students.id, id))
        .returning({ id: students.id, username: students.username, displayName: students.displayName }).get();
      if (!user) throw refuse(NOT_FOUND, 404);
      tx.delete(studentSessions).where(eq(studentSessions.studentId, id)).run();
      record(tx, actorId, id, "student", "password-reset");
      return { user: { ...user, kind: "student" as const }, temporaryPassword };
    }
    const user = tx.update(adults).set({ passwordHash, mustChangePassword: true }).where(eq(adults.id, id))
      .returning({ id: adults.id, email: adults.email, displayName: adults.displayName }).get();
    if (!user) throw refuse(NOT_FOUND, 404);
    tx.delete(adultSessions).where(eq(adultSessions.adultId, id)).run();
    record(tx, actorId, id, "adult", "password-reset");
    return { user: { ...user, kind: "adult" as const }, temporaryPassword };
  });
}

import { randomInt } from "node:crypto";
import { and, eq, inArray, notInArray, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import { adults, classes, students, classStudents, studentClassEnrollments, userAuditEvents } from "../db/schema";
import { canTeach } from "./roles";
import { createSessionToken, generateTemporaryPassword, hashPasswordAsync, hashSessionToken } from "./password";
import { bnNumber, nameKey, parseStudentCsv, quote, sameName, usernameSlug, type SignInSheetRow, type StudentImportIssue } from "./student-import";
import { UserManagementError } from "./user-management";
import { currentMembers } from "./class-roster";

export type Tx = Parameters<Parameters<Awaited<ReturnType<typeof getDb>>["transaction"]>[0]>[0];
function authorize(tx: Tx, actorId: string, classId: string) {
  const actor = tx.select().from(adults).where(eq(adults.id, actorId)).get();
  if (!actor || !canTeach(actor)) throw new UserManagementError("Approved teacher access required.", 403, "অনুমোদিত শিক্ষকের অ্যাকাউন্ট প্রয়োজন।");
  const classroom = tx.select().from(classes).where(eq(classes.id, classId)).get();
  if (!classroom || (actor.role !== "admin" && classroom.teacherId !== actor.id)) throw new UserManagementError("Class not found.", 404, "ক্লাসটি পাওয়া যায়নি।");
}
/** Students a class, or a family, can take in: active and approved. */
export const addable = and(eq(students.status, "active"), eq(students.approvalStatus, "approved"))!;
/**
 * The students now in a class, A–Z: allocated students (with username) and any old class-code learners
 * (no account). Students whose allocation was removed are not listed.
 */
export async function roster(actorId: string, classId: string) {
  const db = await getDb();
  return db.transaction((tx) => {
    authorize(tx, actorId, classId);
    return currentMembers(tx, [classId]).map(({ id, studentId, username, displayName }) => ({ id, studentId, username, displayName }));
  });
}
/**
 * Give a student access to a class: reactivate a removed allocation, or add the roster row and
 * enrollment, and audit it. Returns false when the student already had access. Callers have
 * checked the actor and that the student is active and approved.
 */
export function enrol(tx: Tx, actorId: string, classId: string, student: { id: string; displayName: string }): boolean {
  const existing = tx.select().from(studentClassEnrollments).where(and(eq(studentClassEnrollments.studentId, student.id), eq(studentClassEnrollments.classId, classId))).get();
  if (existing?.active) return false;
  if (existing) tx.update(studentClassEnrollments).set({ active: true }).where(eq(studentClassEnrollments.id, existing.id)).run();
  else {
    const rosterId = crypto.randomUUID();
    tx.insert(classStudents).values({ id: rosterId, classId, displayName: student.displayName, tokenHash: hashSessionToken(createSessionToken()) }).run();
    tx.insert(studentClassEnrollments).values({ id: crypto.randomUUID(), studentId: student.id, classId, classStudentId: rosterId }).run();
  }
  tx.insert(userAuditEvents).values({ id: crypto.randomUUID(), actorId, targetId: student.id, targetType: "student", action: "class-allocated", detailsJson: JSON.stringify({ classId }) }).run();
  return true;
}
export async function allocateStudent(actorId: string, classId: string, username: string) {
  if (!/^[a-z0-9._-]{3,40}$/i.test(username.trim())) throw new UserManagementError("Enter the student's registered username (3–40 characters).", 400, "শিক্ষার্থীর নিবন্ধিত ব্যবহারকারীর নাম লিখুন (৩–৪০ অক্ষর)।");
  const db = await getDb();
  return db.transaction((tx) => {
    authorize(tx, actorId, classId);
    const student = tx.select().from(students).where(and(eq(students.username, username.trim().toLowerCase()), addable)).get();
    if (!student) throw new UserManagementError("No active student has that username.", 404, "এই ব্যবহারকারীর নামে কোনো সক্রিয় শিক্ষার্থী নেই।");
    enrol(tx, actorId, classId, student);
    return { allocated: true };
  });
}

/** How many students the class picker lists at once; searching narrows the list. */
export const AVAILABLE_STUDENTS_LIMIT = 50;
/** The most students one "Add selected" request may allocate (the same as one CSV upload). */
export const MAX_BULK_ALLOCATION = 200;
const likePattern = (value: string) => `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

/**
 * Active, approved students not yet in this class, for the click-to-add picker: name and username
 * only, A–Z, searched by either, at most AVAILABLE_STUDENTS_LIMIT (`more` says when there are others).
 * Any approved teacher may search every student when adding to a class they manage; rosters,
 * results and families stay limited to their own classes.
 */
export async function availableStudents(actorId: string, classId: string, query = "") {
  const search = query.trim().slice(0, 60);
  const db = await getDb();
  return db.transaction((tx) => {
    authorize(tx, actorId, classId);
    const inClass = tx.select({ id: studentClassEnrollments.studentId }).from(studentClassEnrollments)
      .where(and(eq(studentClassEnrollments.classId, classId), eq(studentClassEnrollments.active, true)));
    const pattern = likePattern(search);
    const matches = search ? or(sql`${students.displayName} LIKE ${pattern} ESCAPE '\\'`, sql`${students.username} LIKE ${pattern} ESCAPE '\\'`) : undefined;
    const rows = tx.select({ id: students.id, displayName: students.displayName, username: students.username }).from(students)
      .where(and(addable, notInArray(students.id, inClass), matches))
      .orderBy(sql`${students.displayName} COLLATE NOCASE`, students.username).limit(AVAILABLE_STUDENTS_LIMIT + 1).all();
    return { students: rows.slice(0, AVAILABLE_STUDENTS_LIMIT), more: rows.length > AVAILABLE_STUDENTS_LIMIT };
  });
}

/** Allocate the students a teacher ticked, all or none, auditing each one who gains access. */
export async function allocateStudents(actorId: string, classId: string, studentIds: string[]) {
  const ids = [...new Set(studentIds)];
  if (!ids.length || ids.length > MAX_BULK_ALLOCATION) throw new UserManagementError(`Choose between 1 and ${MAX_BULK_ALLOCATION} students to add.`, 400, `যোগ করতে ১ থেকে ${bnNumber(MAX_BULK_ALLOCATION)} জন শিক্ষার্থী বেছে নিন।`);
  const db = await getDb();
  return db.transaction((tx) => {
    authorize(tx, actorId, classId);
    const found = tx.select({ id: students.id, displayName: students.displayName }).from(students).where(and(inArray(students.id, ids), addable)).all();
    if (found.length !== ids.length) throw new UserManagementError("Some of the selected students can no longer be added. Search again and choose them again.", 409, "বাছাই করা কয়েকজন শিক্ষার্থীকে এখন আর যোগ করা যাচ্ছে না। আবার খুঁজে নতুন করে বেছে নিন।");
    const allocated = found.filter((student) => enrol(tx, actorId, classId, student)).length;
    return { allocated, alreadyAllocated: found.length - allocated };
  });
}

export async function removeAllocation(actorId: string, classId: string, studentId: string) {
  const db = await getDb();
  return db.transaction((tx) => {
    authorize(tx, actorId, classId);
    const updated = tx.update(studentClassEnrollments).set({ active: false })
      .where(and(eq(studentClassEnrollments.classId, classId), eq(studentClassEnrollments.studentId, studentId), eq(studentClassEnrollments.active, true))).returning().get();
    if (!updated) throw new UserManagementError("Active allocation not found.", 404, "সক্রিয় বরাদ্দটি পাওয়া যায়নি।");
    tx.insert(userAuditEvents).values({ id: crypto.randomUUID(), actorId, targetId: studentId, targetType: "student", action: "class-allocation-removed", detailsJson: JSON.stringify({ classId }) }).run();
    return { removed: true };
  });
}

/**
 * Name slug plus a short random number, unique in the database and in this upload; widens to six
 * digits when the four-digit names are crowded. `random` is replaceable so tests can force collisions.
 */
export function generateUsername(tx: Tx, displayName: string, used: Set<string>, random: (min: number, max: number) => number = randomInt) {
  const base = usernameSlug(displayName);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = `${base}${attempt < 10 ? random(1000, 10000) : random(100000, 1000000)}`;
    if (used.has(candidate) || tx.select({ id: students.id }).from(students).where(eq(students.username, candidate)).get()) continue;
    used.add(candidate);
    return candidate;
  }
  throw new UserManagementError("Could not generate unique usernames. Please try again.", 503, "আলাদা ব্যবহারকারীর নাম তৈরি করা যায়নি। আবার চেষ্টা করুন।");
}

/** A student the upload put in the class with the account they already had (their password is unchanged). */
export type ExistingAllocation = { displayName: string; username: string; alreadyInClass: boolean };
export type StudentImportOutcome = { created: SignInSheetRow[]; existing: ExistingAllocation[] } | { errors: StudentImportIssue[]; sameNames: boolean };
type Account = { id: string; username: string; displayName: string; status: string; approvalStatus: string };
type PlannedRow = { account: Account } | { displayName: string; username: string };

/** "a, b, c and 2 more" in English and Bangla, for listing the usernames that share a name. */
export function usernameList(usernames: string[]): [string, string] {
  const shown = usernames.slice(0, 3).join(", ");
  const more = usernames.length - 3;
  return more > 0 ? [`${shown} and ${more} more`, `${shown} এবং আরও ${bnNumber(more)} জন`] : [shown, shown];
}

/**
 * Put every row of a teacher's CSV in the class. A row whose username belongs to an active, approved
 * student (with the same name) allocates that student; other rows create a student account, roster row
 * and enrollment. A row that would create an account (no username, or a username no account has, often
 * a mistyped one) for a name that already has an account is refused unless `createSameNames`, so a list
 * of existing students does not silently create second accounts.
 * All or nothing: any invalid row creates nothing and returns every row error.
 * Temporary passwords are returned once and only their hashes are stored.
 */
export async function importStudents(actorId: string, classId: string, csv: string, options: { createSameNames?: boolean } = {}): Promise<StudentImportOutcome> {
  const parsed = parseStudentCsv(csv);
  const db = await getDb();
  const plan = db.transaction((tx): { errors: StudentImportIssue[]; sameNames: boolean } | { rows: PlannedRow[] } => {
    authorize(tx, actorId, classId);
    const requested = parsed.rows.flatMap((row) => row.username ? [row.username] : []);
    const accounts = new Map<string, Account>(requested.length ? tx.select({ id: students.id, username: students.username, displayName: students.displayName, status: students.status, approvalStatus: students.approvalStatus })
      .from(students).where(inArray(students.username, requested)).all().map((account) => [account.username, account]) : []);
    // Students who already have an account under the name of a row that would create one, by name.
    const creating = parsed.rows.filter((row) => !row.username || !accounts.has(row.username));
    const namesakes = new Map<string, string[]>();
    if (!options.createSameNames && creating.length) {
      const wanted = new Set(creating.map((row) => nameKey(row.displayName)));
      for (const student of tx.select({ username: students.username, displayName: students.displayName }).from(students).where(addable).orderBy(students.username).all()) {
        const key = nameKey(student.displayName);
        if (wanted.has(key)) namesakes.set(key, [...(namesakes.get(key) ?? []), student.username]);
      }
    }
    const errors = [...parsed.errors];
    let sameNames = false;
    for (const row of parsed.rows) {
      const account = row.username ? accounts.get(row.username) : undefined;
      const namesake = account ? undefined : namesakes.get(nameKey(row.displayName));
      if (account && (account.status !== "active" || account.approvalStatus !== "approved")) {
        errors.push({ line: row.line, message: `The username "${row.username}" is already taken. Choose another or leave it blank to generate one.`, messageBn: `ব্যবহারকারীর নাম "${row.username}" আগেই নেওয়া হয়েছে। অন্য একটি দিন, অথবা ফাঁকা রাখুন—নাম থেকে তৈরি হবে।` });
      } else if (account && !sameName(account.displayName, row.displayName)) {
        errors.push({ line: row.line,
          message: `The username "${row.username}" is already taken by ${quote(account.displayName)}. To add that student, write their name as it is on the account; for a new student, choose another username or leave it blank.`,
          messageBn: `ব্যবহারকারীর নাম "${row.username}" আগে থেকেই ${quote(account.displayName)}-এর। ওই শিক্ষার্থীকে যোগ করতে অ্যাকাউন্টে যেভাবে নাম আছে সেভাবে লিখুন; নতুন শিক্ষার্থীর জন্য অন্য ব্যবহারকারীর নাম দিন বা ফাঁকা রাখুন।` });
      } else if (namesake) {
        const [list, listBn] = usernameList(namesake);
        sameNames = true;
        errors.push(row.username ? { line: row.line,
          message: `No student has the username "${row.username}", but a student named ${quote(row.displayName)} already has an account (${list}). To add them, check the username and upload again. If this is a different child, tick "Create new accounts for matching names too" and upload again.`,
          messageBn: `"${row.username}" ব্যবহারকারীর নামে কোনো শিক্ষার্থী নেই, তবে ${quote(row.displayName)} নামে একজন শিক্ষার্থীর আগেই অ্যাকাউন্ট আছে (${listBn})। তাকে যোগ করতে ব্যবহারকারীর নামটি মিলিয়ে দেখে আবার আপলোড করুন। এটি অন্য কোনো শিশু হলে "মিলে যাওয়া নামের জন্যও নতুন অ্যাকাউন্ট তৈরি করুন" টিক দিয়ে আবার আপলোড করুন।` } : { line: row.line,
          message: `A student named ${quote(row.displayName)} already has an account (${list}). To add them, write their username in the "username" column. If this is a different child, tick "Create new accounts for matching names too" and upload again.`,
          messageBn: `${quote(row.displayName)} নামে একজন শিক্ষার্থীর আগেই অ্যাকাউন্ট আছে (${listBn})। তাকে যোগ করতে "username" কলামে তার ব্যবহারকারীর নাম লিখুন। এটি অন্য কোনো শিশু হলে "মিলে যাওয়া নামের জন্যও নতুন অ্যাকাউন্ট তৈরি করুন" টিক দিয়ে আবার আপলোড করুন।` });
      }
    }
    if (errors.length) return { errors: errors.sort((a, b) => a.line - b.line), sameNames };
    const used = new Set(requested);
    return { rows: parsed.rows.map((row): PlannedRow => {
      const account = row.username ? accounts.get(row.username) : undefined;
      return account ? { account } : { displayName: row.displayName, username: row.username ?? generateUsername(tx, row.displayName, used) };
    }) };
  });
  if ("errors" in plan) return plan;
  // scrypt is deliberately slow: hash outside the write transaction, off the main thread.
  const fresh = await Promise.all(plan.rows.flatMap((row) => "account" in row ? [] : [row]).map(async (row) => {
    const temporaryPassword = generateTemporaryPassword();
    return { ...row, temporaryPassword, passwordHash: await hashPasswordAsync(temporaryPassword) };
  }));
  const existing = plan.rows.flatMap((row) => "account" in row ? [row.account] : []);
  const allocated = db.transaction((tx) => {
    authorize(tx, actorId, classId);
    for (const account of fresh) {
      const id = crypto.randomUUID();
      const created = tx.insert(students).values({ id, username: account.username, displayName: account.displayName, passwordHash: account.passwordHash, mustChangePassword: true })
        .onConflictDoNothing({ target: students.username }).returning({ id: students.id }).get();
      if (!created) throw new UserManagementError(`The username "${account.username}" was taken during the upload. Nothing was created; upload the file again.`, 409, `আপলোডের সময় ব্যবহারকারীর নাম "${account.username}" অন্য কেউ নিয়ে নিয়েছে। কিছুই তৈরি হয়নি; ফাইলটি আবার আপলোড করুন।`);
      const rosterId = crypto.randomUUID();
      tx.insert(classStudents).values({ id: rosterId, classId, displayName: account.displayName, tokenHash: hashSessionToken(createSessionToken()) }).run();
      tx.insert(studentClassEnrollments).values({ id: crypto.randomUUID(), studentId: id, classId, classStudentId: rosterId }).run();
      tx.insert(userAuditEvents).values({ id: crypto.randomUUID(), actorId, targetId: id, targetType: "student", action: "student-provisioned", detailsJson: JSON.stringify({ classId }) }).run();
    }
    return existing.map((account): ExistingAllocation => {
      // Suspended or declined while passwords were hashed: refuse the whole upload rather than add them.
      const current = tx.select({ id: students.id, displayName: students.displayName }).from(students).where(and(eq(students.id, account.id), addable)).get();
      if (!current) throw new UserManagementError(`The account "${account.username}" changed during the upload. Nothing was created; upload the file again.`, 409, `আপলোডের সময় "${account.username}" অ্যাকাউন্টটি বদলে গেছে। কিছুই তৈরি হয়নি; ফাইলটি আবার আপলোড করুন।`);
      return { displayName: current.displayName, username: account.username, alreadyInClass: !enrol(tx, actorId, classId, current) };
    });
  });
  return { created: fresh.map(({ displayName, username, temporaryPassword }) => ({ displayName, username, temporaryPassword })), existing: allocated };
}

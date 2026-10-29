import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { adults, classes, parentStudentLinks, students, userAuditEvents } from "../db/schema";
import { canManageUsers } from "./roles";
import { generateTemporaryPassword, hashPasswordAsync } from "./password";
import { parseFamilyCsv, type FamilySheetRow } from "./family-import";
import { nameKey, quote, sameName, type ImportIssue } from "./student-import";
import { addable, enrol, generateUsername, usernameList, type Tx } from "./enrollments";
import { UserManagementError } from "./user-management";

type ParentAccount = { id: string; email: string; displayName: string; role: string; status: string; approvalStatus: string };
type StudentAccount = { id: string; username: string; displayName: string; status: string; approvalStatus: string };
/** One row to write: the student is new unless `studentId` names their account; the parent is new unless `parentId` does. */
type PlannedFamily = { studentName: string; username: string; studentId: string | null; parentEmail: string; parentName: string; parentId: string | null };
export type FamilyImportOutcome = { families: FamilySheetRow[]; className: string | null } | { errors: ImportIssue[]; sameNames: boolean };

function requireAdministrator(tx: Tx, actorId: string) {
  const actor = tx.select({ role: adults.role, status: adults.status, teacherStatus: adults.teacherStatus }).from(adults).where(eq(adults.id, actorId)).get();
  if (!actor || !canManageUsers(actor)) throw new UserManagementError("Administrator access required.", 403, "প্রশাসকের অ্যাকাউন্ট প্রয়োজন।");
}

function findClass(tx: Tx, classId: string | null) {
  if (!classId) return null;
  const classroom = tx.select({ id: classes.id, name: classes.name }).from(classes).where(eq(classes.id, classId)).get();
  if (!classroom) throw new UserManagementError("Class not found.", 404, "ক্লাসটি পাওয়া যায়নি।");
  return classroom;
}

const reusable = (account: ParentAccount) => account.role === "parent" && account.status === "active" && account.approvalStatus === "approved";

/** Why a row's parent e-mail cannot be used for this family, in English and Bangla, or null when it can. */
function parentProblem(account: ParentAccount, parentName: string): [string, string] | null {
  const email = quote(account.email);
  if (account.role !== "parent") return [`The e-mail ${email} belongs to a teacher or administrator account. Use the parent's own e-mail address.`, `ইমেইল ${email} একজন শিক্ষক বা প্রশাসকের অ্যাকাউন্টের। অভিভাবকের নিজের ইমেইল ঠিকানা দিন।`];
  if (account.status !== "active") return [`The e-mail ${email} belongs to a suspended account. Reactivate it on the Users page first, or use another e-mail address.`, `ইমেইল ${email} একটি স্থগিত অ্যাকাউন্টের। আগে ব্যবহারকারী পাতায় অ্যাকাউন্টটি পুনরায় চালু করুন, অথবা অন্য ইমেইল দিন।`];
  if (account.approvalStatus === "pending") return [`The e-mail ${email} belongs to an account that is waiting for approval. Approve or decline it on the Users page first.`, `ইমেইল ${email} এমন একটি অ্যাকাউন্টের, যা অনুমোদনের অপেক্ষায় আছে। আগে ব্যবহারকারী পাতায় অনুমোদন বা প্রত্যাখ্যান করুন।`];
  if (account.approvalStatus !== "approved") return [`The e-mail ${email} belongs to a declined account. Approve it on the Users page first, or use another e-mail address.`, `ইমেইল ${email} একটি প্রত্যাখ্যাত অ্যাকাউন্টের। আগে ব্যবহারকারী পাতায় অনুমোদন করুন, অথবা অন্য ইমেইল দিন।`];
  // A child is only linked to an existing account the administrator clearly meant: a different name suggests a mistyped e-mail.
  if (!sameName(account.displayName, parentName)) return [`The e-mail ${email} belongs to an existing parent account named ${quote(account.displayName)}, not ${quote(parentName)}. Check the e-mail address, or use the name on the account.`, `ইমেইল ${email} ${quote(account.displayName)} নামের একটি অভিভাবক অ্যাকাউন্টের, ${quote(parentName)}-এর নয়। ইমেইল ঠিকানাটি দেখে নিন, অথবা অ্যাকাউন্টের নামটি লিখুন।`];
  return null;
}

/**
 * Create a student account for every row of an administrator's family CSV and link it to the parent.
 * A parent e-mail that belongs to an active, approved parent account with the same name reuses that
 * account (its password is unchanged); unknown e-mails get a new parent account, shared by siblings.
 * A "student username" that belongs to an active, approved student with the same name links that
 * student instead of creating one; rows sharing a username are one child with two parents.
 * So that a child never gets a second account: a row for a child already linked to the reused parent
 * under the same name is refused, and a row that would create an account for a name that already has
 * one (no username, or a username no account has, often a mistyped one) is refused unless
 * `createSameNames` says the rows are different children.
 * New accounts are approved and get a temporary password that must be changed at first sign-in.
 * With `classId`, every student is also allocated to that class.
 * All or nothing: any invalid row creates nothing and returns every row error.
 * Temporary passwords are returned once and only their hashes are stored.
 */
export async function importFamilies(actorId: string, csv: string, classId: string | null = null, options: { createSameNames?: boolean } = {}): Promise<FamilyImportOutcome> {
  const parsed = parseFamilyCsv(csv);
  const db = await getDb();
  const plan = db.transaction((tx): { errors: ImportIssue[]; sameNames: boolean } | { rows: PlannedFamily[]; className: string | null } => {
    requireAdministrator(tx, actorId);
    const classroom = findClass(tx, classId);
    const emails = [...new Set(parsed.rows.map((row) => row.parentEmail))];
    const parents = new Map<string, ParentAccount>(emails.length ? tx.select({ id: adults.id, email: adults.email, displayName: adults.displayName, role: adults.role, status: adults.status, approvalStatus: adults.approvalStatus })
      .from(adults).where(inArray(adults.email, emails)).all().map((account) => [account.email, account]) : []);
    const requested = [...new Set(parsed.rows.flatMap((row) => row.username ? [row.username] : []))];
    const accounts = new Map<string, StudentAccount>(requested.length ? tx.select({ id: students.id, username: students.username, displayName: students.displayName, status: students.status, approvalStatus: students.approvalStatus })
      .from(students).where(inArray(students.username, requested)).all().map((account) => [account.username, account]) : []);
    // The children already linked to each reused parent, by name, so an upload repeated or extended later is caught.
    const reusedIds = [...parents.values()].filter(reusable).map((account) => account.id);
    const linked = new Map<string, string[]>();
    if (reusedIds.length) {
      for (const child of tx.select({ parentId: parentStudentLinks.parentId, username: students.username, displayName: students.displayName }).from(parentStudentLinks)
        .innerJoin(students, eq(students.id, parentStudentLinks.studentId)).where(inArray(parentStudentLinks.parentId, reusedIds)).orderBy(students.username).all()) {
        const key = `${child.parentId}\n${nameKey(child.displayName)}`;
        linked.set(key, [...(linked.get(key) ?? []), child.username]);
      }
    }
    // Students who already have an account under the name of a row that would create one, by name.
    const creating = parsed.rows.filter((row) => !row.username || !accounts.has(row.username));
    const namesakes = new Map<string, string[]>();
    if (!options.createSameNames && creating.length) {
      const wanted = new Set(creating.map((row) => nameKey(row.studentName)));
      for (const student of tx.select({ username: students.username, displayName: students.displayName }).from(students).where(addable).orderBy(students.username).all()) {
        const key = nameKey(student.displayName);
        if (wanted.has(key)) namesakes.set(key, [...(namesakes.get(key) ?? []), student.username]);
      }
    }
    const errors = [...parsed.errors];
    let sameNames = false;
    for (const row of parsed.rows) {
      const parent = parents.get(row.parentEmail);
      const problem = parent && parentProblem(parent, row.parentName);
      const children = parent && !problem ? linked.get(`${parent.id}\n${nameKey(row.studentName)}`) : undefined;
      const account = row.username ? accounts.get(row.username) : undefined;
      const namesake = account ? undefined : namesakes.get(nameKey(row.studentName));
      if (problem) errors.push({ line: row.line, message: problem[0], messageBn: problem[1] });
      if (children) {
        const [list, listBn] = usernameList(children);
        errors.push({ line: row.line,
          message: `${quote(row.studentName)} is already linked to this parent as ${list}. Remove this row: the student already has an account. To put them in a class, use "Allocate students" on that class.`,
          messageBn: `${quote(row.studentName)} এই অভিভাবকের সঙ্গে আগেই ${listBn} নামে যুক্ত আছে। সারিটি বাদ দিন: শিক্ষার্থীর আগেই অ্যাকাউন্ট আছে। কোনো ক্লাসে যোগ করতে ওই ক্লাসের "শিক্ষার্থী বরাদ্দ" অংশ ব্যবহার করুন।` });
      } else if (account && (account.status !== "active" || account.approvalStatus !== "approved")) {
        errors.push({ line: row.line, message: `The username "${row.username}" is already taken. Choose another or leave it blank to generate one.`, messageBn: `ব্যবহারকারীর নাম "${row.username}" আগেই নেওয়া হয়েছে। অন্য একটি দিন, অথবা ফাঁকা রাখুন—নাম থেকে তৈরি হবে।` });
      } else if (account && !sameName(account.displayName, row.studentName)) {
        errors.push({ line: row.line,
          message: `The username "${row.username}" is already taken by ${quote(account.displayName)}. To link that student, write their name as it is on the account; for a new student, choose another username or leave it blank.`,
          messageBn: `ব্যবহারকারীর নাম "${row.username}" আগে থেকেই ${quote(account.displayName)}-এর। ওই শিক্ষার্থীকে যুক্ত করতে অ্যাকাউন্টে যেভাবে নাম আছে সেভাবে লিখুন; নতুন শিক্ষার্থীর জন্য অন্য ব্যবহারকারীর নাম দিন বা ফাঁকা রাখুন।` });
      } else if (namesake) {
        const [list, listBn] = usernameList(namesake);
        sameNames = true;
        errors.push(row.username ? { line: row.line,
          message: `No student has the username "${row.username}", but a student named ${quote(row.studentName)} already has an account (${list}). To link them, check the username and upload again. If this is a different child, tick "Create new accounts for matching names too" and upload again.`,
          messageBn: `"${row.username}" ব্যবহারকারীর নামে কোনো শিক্ষার্থী নেই, তবে ${quote(row.studentName)} নামে একজন শিক্ষার্থীর আগেই অ্যাকাউন্ট আছে (${listBn})। তাকে যুক্ত করতে ব্যবহারকারীর নামটি মিলিয়ে দেখে আবার আপলোড করুন। এটি অন্য কোনো শিশু হলে "মিলে যাওয়া নামের জন্যও নতুন অ্যাকাউন্ট তৈরি করুন" টিক দিয়ে আবার আপলোড করুন।` } : { line: row.line,
          message: `A student named ${quote(row.studentName)} already has an account (${list}). To link them to this parent, write their username in the "student username" column. If this is a different child, tick "Create new accounts for matching names too" and upload again.`,
          messageBn: `${quote(row.studentName)} নামে একজন শিক্ষার্থীর আগেই অ্যাকাউন্ট আছে (${listBn})। তাকে এই অভিভাবকের সঙ্গে যুক্ত করতে "student username" কলামে তার ব্যবহারকারীর নাম লিখুন। এটি অন্য কোনো শিশু হলে "মিলে যাওয়া নামের জন্যও নতুন অ্যাকাউন্ট তৈরি করুন" টিক দিয়ে আবার আপলোড করুন।` });
      }
    }
    if (errors.length) return { errors: errors.sort((a, b) => a.line - b.line), sameNames };
    const used = new Set(requested);
    // Siblings may spell their parent's name, and two parents their child's, with different capitals: the first row's spelling names a new account.
    const firstNames = new Map(parsed.rows.toReversed().map((row) => [row.parentEmail, row.parentName]));
    const firstStudentNames = new Map(parsed.rows.toReversed().flatMap((row) => row.username ? [[row.username, row.studentName] as const] : []));
    return { className: classroom?.name ?? null, rows: parsed.rows.map((row) => {
      const parent = parents.get(row.parentEmail);
      const account = row.username ? accounts.get(row.username) : undefined;
      return { studentName: account?.displayName ?? (row.username ? firstStudentNames.get(row.username)! : row.studentName),
        username: row.username ?? generateUsername(tx, row.studentName, used), studentId: account?.id ?? null, parentEmail: row.parentEmail,
        parentName: parent ? parent.displayName : firstNames.get(row.parentEmail)!, parentId: parent?.id ?? null };
    }) };
  });
  if ("errors" in plan) return plan;

  // scrypt is deliberately slow: hash outside the write transaction, off the main thread. Siblings share one new parent,
  // and two parents one new child.
  const credentials = async () => { const temporaryPassword = generateTemporaryPassword(); return { temporaryPassword, passwordHash: await hashPasswordAsync(temporaryPassword) }; };
  const newParents = new Map(await Promise.all([...new Map(plan.rows.filter((row) => !row.parentId).map((row) => [row.parentEmail, row.parentName]))]
    .map(async ([email, name]) => [email, { name, ...(await credentials()) }] as const)));
  const newStudents = new Map(await Promise.all([...new Map(plan.rows.filter((row) => !row.studentId).map((row) => [row.username, row.studentName]))]
    .map(async ([username, name]) => [username, { name, ...(await credentials()) }] as const)));

  db.transaction((tx) => {
    requireAdministrator(tx, actorId);
    findClass(tx, classId);
    const parentIds = new Map<string, string>();
    for (const [email, parent] of newParents) {
      const id = crypto.randomUUID();
      const created = tx.insert(adults).values({ id, email, displayName: parent.name, passwordHash: parent.passwordHash, role: "parent", teacherStatus: "none", approvalStatus: "approved", mustChangePassword: true })
        .onConflictDoNothing({ target: adults.email }).returning({ id: adults.id }).get();
      if (!created) throw new UserManagementError(`The e-mail "${email}" was registered during the upload. Nothing was created; upload the file again.`, 409, `আপলোডের সময় "${email}" ইমেইলে একটি অ্যাকাউন্ট খোলা হয়েছে। কিছুই তৈরি হয়নি; ফাইলটি আবার আপলোড করুন।`);
      tx.insert(userAuditEvents).values({ id: crypto.randomUUID(), actorId, targetId: id, targetType: "adult", action: "created", detailsJson: JSON.stringify({ role: "parent", source: "family-import" }) }).run();
      parentIds.set(email, id);
    }
    for (const row of plan.rows) {
      if (!row.parentId || parentIds.has(row.parentEmail)) continue;
      // Suspended, re-roled or declined while passwords were hashed: refuse the whole upload rather than link the child.
      const current = tx.select({ id: adults.id, email: adults.email, displayName: adults.displayName, role: adults.role, status: adults.status, approvalStatus: adults.approvalStatus }).from(adults).where(eq(adults.id, row.parentId)).get();
      if (!current || !reusable(current)) throw new UserManagementError(`The parent account "${row.parentEmail}" changed during the upload. Nothing was created; upload the file again.`, 409, `আপলোডের সময় "${row.parentEmail}" অভিভাবক অ্যাকাউন্টটি বদলে গেছে। কিছুই তৈরি হয়নি; ফাইলটি আবার আপলোড করুন।`);
      parentIds.set(row.parentEmail, current.id);
    }
    const studentIds = new Map<string, { id: string; displayName: string }>();
    for (const [username, student] of newStudents) {
      const id = crypto.randomUUID();
      const created = tx.insert(students).values({ id, username, displayName: student.name, passwordHash: student.passwordHash, mustChangePassword: true })
        .onConflictDoNothing({ target: students.username }).returning({ id: students.id }).get();
      if (!created) throw new UserManagementError(`The username "${username}" was taken during the upload. Nothing was created; upload the file again.`, 409, `আপলোডের সময় ব্যবহারকারীর নাম "${username}" অন্য কেউ নিয়ে নিয়েছে। কিছুই তৈরি হয়নি; ফাইলটি আবার আপলোড করুন।`);
      tx.insert(userAuditEvents).values({ id: crypto.randomUUID(), actorId, targetId: id, targetType: "student", action: "created", detailsJson: JSON.stringify({ source: "family-import" }) }).run();
      studentIds.set(username, { id, displayName: student.name });
    }
    for (const row of plan.rows) {
      if (!row.studentId || studentIds.has(row.username)) continue;
      // Suspended or declined while passwords were hashed: refuse the whole upload rather than link them.
      const current = tx.select({ id: students.id, displayName: students.displayName }).from(students).where(and(eq(students.id, row.studentId), addable)).get();
      if (!current) throw new UserManagementError(`The account "${row.username}" changed during the upload. Nothing was created; upload the file again.`, 409, `আপলোডের সময় "${row.username}" অ্যাকাউন্টটি বদলে গেছে। কিছুই তৈরি হয়নি; ফাইলটি আবার আপলোড করুন।`);
      studentIds.set(row.username, current);
    }
    for (const row of plan.rows) {
      const studentId = studentIds.get(row.username)!.id;
      const parentId = parentIds.get(row.parentEmail)!;
      const link = tx.insert(parentStudentLinks).values({ id: crypto.randomUUID(), parentId, studentId }).onConflictDoNothing({ target: [parentStudentLinks.parentId, parentStudentLinks.studentId] }).returning({ id: parentStudentLinks.id }).get();
      if (link) tx.insert(userAuditEvents).values({ id: crypto.randomUUID(), actorId, targetId: studentId, targetType: "student", action: "parent-linked", detailsJson: JSON.stringify({ parentId, source: "family-import" }) }).run();
    }
    if (classId) for (const student of studentIds.values()) enrol(tx, actorId, classId, student);
  });
  return {
    className: plan.className,
    families: plan.rows.map((row) => ({ studentName: row.studentName, username: row.username, temporaryPassword: newStudents.get(row.username)?.temporaryPassword ?? null, parentName: row.parentName,
      parentEmail: row.parentEmail, parentTemporaryPassword: newParents.get(row.parentEmail)?.temporaryPassword ?? null })),
  };
}

import { eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { adults, classes, parentStudentLinks, students, userAuditEvents } from "../db/schema";
import { canManageUsers } from "./roles";
import { generateTemporaryPassword, hashPasswordAsync } from "./password";
import { parseFamilyCsv, type FamilySheetRow } from "./family-import";
import { quote, sameName, type ImportIssue } from "./student-import";
import { enrol, generateUsername, type Tx } from "./enrollments";
import { UserManagementError } from "./user-management";

type ParentAccount = { id: string; email: string; displayName: string; role: string; status: string; approvalStatus: string };
type PlannedFamily = { studentName: string; username: string; parentEmail: string; parentName: string; parentId: string | null };

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
 * New accounts are approved and get a temporary password that must be changed at first sign-in.
 * With `classId`, every student is also allocated to that class.
 * All or nothing: any invalid row creates nothing and returns every row error.
 * Temporary passwords are returned once and only their hashes are stored.
 */
export async function importFamilies(actorId: string, csv: string, classId: string | null = null): Promise<{ families: FamilySheetRow[]; className: string | null } | { errors: ImportIssue[] }> {
  const parsed = parseFamilyCsv(csv);
  const db = await getDb();
  const plan = db.transaction((tx): { errors: ImportIssue[] } | { rows: PlannedFamily[]; className: string | null } => {
    requireAdministrator(tx, actorId);
    const classroom = findClass(tx, classId);
    const emails = [...new Set(parsed.rows.map((row) => row.parentEmail))];
    const parents = new Map<string, ParentAccount>(emails.length ? tx.select({ id: adults.id, email: adults.email, displayName: adults.displayName, role: adults.role, status: adults.status, approvalStatus: adults.approvalStatus })
      .from(adults).where(inArray(adults.email, emails)).all().map((account) => [account.email, account]) : []);
    const requested = parsed.rows.flatMap((row) => row.username ? [row.username] : []);
    const taken = new Set(requested.length ? tx.select({ username: students.username }).from(students).where(inArray(students.username, requested)).all().map((row) => row.username) : []);
    const errors = [...parsed.errors];
    for (const row of parsed.rows) {
      const account = parents.get(row.parentEmail);
      const problem = account && parentProblem(account, row.parentName);
      if (problem) errors.push({ line: row.line, message: problem[0], messageBn: problem[1] });
      if (row.username && taken.has(row.username)) errors.push({ line: row.line, message: `The username "${row.username}" is already taken. Choose another or leave it blank to generate one.`, messageBn: `ব্যবহারকারীর নাম "${row.username}" আগেই নেওয়া হয়েছে। অন্য একটি দিন, অথবা ফাঁকা রাখুন—নাম থেকে তৈরি হবে।` });
    }
    if (errors.length) return { errors: errors.sort((a, b) => a.line - b.line) };
    const used = new Set(requested);
    // Siblings may spell their parent's name with different capitals: the first row's spelling names a new account.
    const firstNames = new Map(parsed.rows.toReversed().map((row) => [row.parentEmail, row.parentName]));
    return { className: classroom?.name ?? null, rows: parsed.rows.map((row) => {
      const account = parents.get(row.parentEmail);
      return { studentName: row.studentName, username: row.username ?? generateUsername(tx, row.studentName, used), parentEmail: row.parentEmail,
        parentName: account ? account.displayName : firstNames.get(row.parentEmail)!, parentId: account?.id ?? null };
    }) };
  });
  if ("errors" in plan) return { errors: plan.errors };

  // scrypt is deliberately slow: hash outside the write transaction, off the main thread. Siblings share one new parent.
  const credentials = async () => { const temporaryPassword = generateTemporaryPassword(); return { temporaryPassword, passwordHash: await hashPasswordAsync(temporaryPassword) }; };
  const newParents = new Map(await Promise.all([...new Map(plan.rows.filter((row) => !row.parentId).map((row) => [row.parentEmail, row.parentName]))]
    .map(async ([email, name]) => [email, { name, ...(await credentials()) }] as const)));
  const children = await Promise.all(plan.rows.map(async (row) => ({ ...row, ...(await credentials()) })));

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
    for (const row of children) {
      if (!row.parentId || parentIds.has(row.parentEmail)) continue;
      // Suspended, re-roled or declined while passwords were hashed: refuse the whole upload rather than link the child.
      const current = tx.select({ id: adults.id, email: adults.email, displayName: adults.displayName, role: adults.role, status: adults.status, approvalStatus: adults.approvalStatus }).from(adults).where(eq(adults.id, row.parentId)).get();
      if (!current || !reusable(current)) throw new UserManagementError(`The parent account "${row.parentEmail}" changed during the upload. Nothing was created; upload the file again.`, 409, `আপলোডের সময় "${row.parentEmail}" অভিভাবক অ্যাকাউন্টটি বদলে গেছে। কিছুই তৈরি হয়নি; ফাইলটি আবার আপলোড করুন।`);
      parentIds.set(row.parentEmail, current.id);
    }
    for (const row of children) {
      const id = crypto.randomUUID();
      const created = tx.insert(students).values({ id, username: row.username, displayName: row.studentName, passwordHash: row.passwordHash, mustChangePassword: true })
        .onConflictDoNothing({ target: students.username }).returning({ id: students.id }).get();
      if (!created) throw new UserManagementError(`The username "${row.username}" was taken during the upload. Nothing was created; upload the file again.`, 409, `আপলোডের সময় ব্যবহারকারীর নাম "${row.username}" অন্য কেউ নিয়ে নিয়েছে। কিছুই তৈরি হয়নি; ফাইলটি আবার আপলোড করুন।`);
      tx.insert(userAuditEvents).values({ id: crypto.randomUUID(), actorId, targetId: id, targetType: "student", action: "created", detailsJson: JSON.stringify({ source: "family-import" }) }).run();
      const parentId = parentIds.get(row.parentEmail)!;
      tx.insert(parentStudentLinks).values({ id: crypto.randomUUID(), parentId, studentId: id }).onConflictDoNothing({ target: [parentStudentLinks.parentId, parentStudentLinks.studentId] }).run();
      tx.insert(userAuditEvents).values({ id: crypto.randomUUID(), actorId, targetId: id, targetType: "student", action: "parent-linked", detailsJson: JSON.stringify({ parentId, source: "family-import" }) }).run();
      if (classId) enrol(tx, actorId, classId, { id, displayName: row.studentName });
    }
  });
  return {
    className: plan.className,
    families: children.map((row) => ({ studentName: row.studentName, username: row.username, temporaryPassword: row.temporaryPassword, parentName: row.parentName,
      parentEmail: row.parentEmail, parentTemporaryPassword: newParents.get(row.parentEmail)?.temporaryPassword ?? null })),
  };
}

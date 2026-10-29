import { csvRows } from "./csv";
import {
  bnNumber, fileTooLargeIssue, headerKey, importTooLarge, isBlankRecord, issue, MAX_IMPORT_ROWS, nameIssues, nameKey, quote,
  readCsvRecords, sameName, tooManyRowsIssue, usernameIssues, type ImportIssue,
} from "./student-import";

/**
 * Pure helpers for the administrator's family upload: one CSV with each student's name and their
 * parent's name and e-mail. Same reader, limits and line-numbered errors as the class student import,
 * and no Node-only imports, so the browser shares the template and the sign-in sheet builder.
 */

export const FAMILY_IMPORT_TEMPLATE = "student name,parent name,parent email\nMaya Rahman,Farida Rahman,farida.rahman@example.com\nArif Rahman,Farida Rahman,farida.rahman@example.com\nNadia Islam,Karim Islam,karim.islam@example.com\n";
export const MAX_EMAIL_LENGTH = 120;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type FamilyImportRow = { line: number; studentName: string; parentName: string; parentEmail: string; username?: string };
export type FamilyImportResult = { rows: FamilyImportRow[]; errors: ImportIssue[] };
/**
 * One imported student with their parent. `temporaryPassword` is null for a student who already had an
 * account, and `parentTemporaryPassword` for an existing parent account: their passwords are unchanged.
 */
export type FamilySheetRow = { studentName: string; username: string; temporaryPassword: string | null; parentName: string; parentEmail: string; parentTemporaryPassword: string | null };
export type FamilyGroup = { parentName: string; parentEmail: string; parentTemporaryPassword: string | null; children: FamilySheetRow[] };

type Column = "studentName" | "parentName" | "parentEmail" | "username";
const HEADERS: Record<Column, Set<string>> = {
  studentName: new Set(["student name", "student", "child name", "child", "student full name"]),
  parentName: new Set(["parent name", "parent", "guardian name", "guardian", "parent full name"]),
  parentEmail: new Set(["parent email", "email", "parent email address", "email address", "guardian email"]),
  username: new Set(["student username", "username", "user name", "student user name"]),
};
const LABELS: Record<Column, string> = { studentName: "student name", parentName: "parent name", parentEmail: "parent email", username: "student username" };
const REQUIRED: Column[] = ["studentName", "parentName", "parentEmail"];
// "E-mail", "e_mail" and "Parent E-Mail" are the same column as "email".
const familyHeaderKey = (value: string) => headerKey(value).replace(/\be[ -]mail\b/g, "email");

/**
 * Parse an administrator's family list. A header row is required with student name, parent name and
 * parent email columns (case and spacing do not matter; "student", "parent" and "email" also work) and
 * an optional student username column. Rows that share a parent e-mail are siblings and must give the
 * same parent name. Rows that share a student username are one child with two parents, so they must
 * give the same student name; the same name under two parent e-mails needs usernames to say whether it
 * is one child or two. Every problem is reported with its line number.
 */
export function parseFamilyCsv(input: string): FamilyImportResult {
  if (importTooLarge(input)) return { rows: [], errors: [fileTooLargeIssue()] };
  const { records, error } = readCsvRecords(input.replace(/^﻿/, ""));
  if (error) return { rows: [], errors: [error] };
  const content = records.filter((record) => !isBlankRecord(record));
  const header = content[0];
  if (!header) return { rows: [], errors: [issue(0, "The file is empty. Add a header row (student name,parent name,parent email) and one student per line.", "ফাইলটি খালি। প্রথমে একটি শিরোনাম সারি (student name,parent name,parent email) দিন, তারপর প্রতি লাইনে একজন শিক্ষার্থী।")] };

  const columns = new Map<Column, number>();
  const headerErrors: ImportIssue[] = [];
  const unknown: string[] = [];
  header.fields.forEach((value, index) => {
    const key = familyHeaderKey(value);
    if (!key) return;
    const column = (Object.keys(HEADERS) as Column[]).find((name) => HEADERS[name].has(key));
    if (!column) unknown.push(quote(value.trim()));
    else if (columns.has(column)) headerErrors.push(issue(header.line, `The header row has more than one "${LABELS[column]}" column. Keep only one.`, `শিরোনাম সারিতে একাধিক "${LABELS[column]}" কলাম আছে। একটি রাখুন।`));
    else columns.set(column, index);
  });
  const missing = REQUIRED.filter((column) => !columns.has(column)).map((column) => `"${LABELS[column]}"`);
  if (missing.length) {
    const found = unknown.length ? ` Found: ${unknown.join(", ")}.` : "";
    const foundBn = unknown.length ? ` পাওয়া গেছে: ${unknown.join(", ")}।` : "";
    return { rows: [], errors: [issue(header.line,
      `The first row must be a header with "student name", "parent name" and "parent email" columns. Missing: ${missing.join(", ")}.${found}`,
      `প্রথম সারিটি হতে হবে শিরোনাম, যেখানে "student name", "parent name" ও "parent email" কলাম থাকবে। নেই: ${missing.join(", ")}।${foundBn}`)] };
  }
  for (const column of unknown) headerErrors.push(issue(header.line, `Unknown column ${column}. Use "student name", "parent name", "parent email" and, optionally, "student username".`, `অচেনা কলাম ${column}। "student name", "parent name", "parent email" এবং চাইলে "student username" ব্যবহার করুন।`));
  if (headerErrors.length) return { rows: [], errors: headerErrors };

  const data = content.slice(1);
  if (!data.length) return { rows: [], errors: [issue(header.line, "Add at least one student below the header row.", "শিরোনাম সারির নিচে অন্তত একজন শিক্ষার্থী যোগ করুন।")] };
  if (data.length > MAX_IMPORT_ROWS) return { rows: [], errors: [tooManyRowsIssue(data[MAX_IMPORT_ROWS].line, data.length)] };

  const used = new Set(columns.values());
  const cell = (record: { fields: string[] }, column: Column) => columns.has(column) ? (record.fields[columns.get(column)!] ?? "").trim() : "";
  const rows: FamilyImportRow[] = [];
  const errors: ImportIssue[] = [];
  // The first row for each username, parent e-mail and parent-and-child pair, so later rows can be checked against it.
  const usernames = new Map<string, { line: number; studentName: string; parentEmail: string }>();
  const parents = new Map<string, { line: number; name: string }>();
  const children = new Map<string, number>();
  // Accepted rows by student name, to catch one child listed under two parents without a shared username.
  const named = new Map<string, FamilyImportRow[]>();
  for (const record of data) {
    const rowErrors: ImportIssue[] = [];
    if (record.fields.some((value, index) => !used.has(index) && value.trim())) {
      rowErrors.push(issue(record.line, 'This row has more values than the header. Put names that contain commas in double quotes, e.g. "Rahman, Maya".', 'এই সারিতে শিরোনামের চেয়ে বেশি মান আছে। কমা আছে এমন নাম ডাবল কোটের মধ্যে লিখুন, যেমন "Rahman, Maya"।'));
    }
    const studentName = cell(record, "studentName");
    const parentName = cell(record, "parentName");
    const rawEmail = cell(record, "parentEmail");
    const parentEmail = rawEmail.toLowerCase();
    rowErrors.push(...nameIssues(record.line, studentName, ["student", "শিক্ষার্থীর"]));
    const parentNameErrors = nameIssues(record.line, parentName, ["parent", "অভিভাবকের"]);
    rowErrors.push(...parentNameErrors);
    let emailValid = false;
    if (!rawEmail) rowErrors.push(issue(record.line, "Enter the parent's e-mail address.", "অভিভাবকের ইমেইল ঠিকানা লিখুন।"));
    else if (parentEmail.length > MAX_EMAIL_LENGTH) rowErrors.push(issue(record.line, `E-mail addresses can be at most ${MAX_EMAIL_LENGTH} characters.`, `ইমেইল ঠিকানা সর্বোচ্চ ${bnNumber(MAX_EMAIL_LENGTH)} অক্ষরের হতে পারে।`));
    else if (!EMAIL_PATTERN.test(parentEmail)) rowErrors.push(issue(record.line, `Parent e-mail ${quote(rawEmail)} is not a valid e-mail address.`, `অভিভাবকের ইমেইল ${quote(rawEmail)} সঠিক ইমেইল ঠিকানা নয়।`));
    else emailValid = true;
    // Only the format here: a repeated username is allowed for one child with two parents (below).
    const checked = usernameIssues(record.line, cell(record, "username"), new Map());
    rowErrors.push(...checked.errors);
    const username = checked.errors.length ? "" : checked.username;

    let duplicate = false;
    if (emailValid && !parentNameErrors.length) {
      const first = parents.get(parentEmail);
      if (!first) parents.set(parentEmail, { line: record.line, name: parentName });
      else if (!sameName(first.name, parentName)) {
        rowErrors.push(issue(record.line,
          `Parent e-mail ${quote(parentEmail)} is used on line ${first.line} for ${quote(first.name)}. Rows for the same parent need the same parent name.`,
          `অভিভাবকের ইমেইল ${quote(parentEmail)} লাইন ${bnNumber(first.line)}-এ ${quote(first.name)}-এর জন্য ব্যবহার হয়েছে। একই অভিভাবকের সব সারিতে একই নাম দিন।`));
      }
      if (studentName) {
        const key = `${parentEmail}\n${nameKey(studentName)}`;
        duplicate = children.has(key);
        if (duplicate) rowErrors.push(issue(record.line, `${quote(studentName)} is already listed with this parent on line ${children.get(key)}.`, `${quote(studentName)} এই অভিভাবকের সঙ্গে লাইন ${bnNumber(children.get(key)!)}-এ আগেই আছে।`));
        else children.set(key, record.line);
      }
    }
    if (username && !duplicate) {
      const first = usernames.get(username);
      if (!first) usernames.set(username, { line: record.line, studentName, parentEmail });
      else if (!sameName(first.studentName, studentName) || first.parentEmail === parentEmail) {
        rowErrors.push(issue(record.line,
          `Username ${quote(username)} is already used on line ${first.line}. Rows may share a username only for the same child with another parent.`,
          `ব্যবহারকারীর নাম ${quote(username)} লাইন ${bnNumber(first.line)}-এ আগেই ব্যবহার হয়েছে। একই শিশুর অন্য অভিভাবকের সারি ছাড়া কোনো সারিতে একই ব্যবহারকারীর নাম দেওয়া যায় না।`));
      }
    }
    if (!rowErrors.length) {
      // The same name under another parent: one child with two parents shares a username; different children each have their own.
      const other = (named.get(nameKey(studentName)) ?? []).find((row) => row.parentEmail !== parentEmail && (!row.username || !username));
      if (other) {
        rowErrors.push(issue(record.line,
          `${quote(studentName)} is also listed on line ${other.line} with another parent's e-mail. If this is one child with two parents, write the same username in the "student username" column on both rows, so the child gets one account. If they are different children, give each row its own username.`,
          `${quote(studentName)} লাইন ${bnNumber(other.line)}-এ অন্য একজন অভিভাবকের ইমেইলের সঙ্গেও আছে। একই শিশুর দুজন অভিভাবক হলে দুই সারিতেই "student username" কলামে একই ব্যবহারকারীর নাম লিখুন, যাতে শিশুটির একটিই অ্যাকাউন্ট হয়। আলাদা শিশু হলে প্রতিটি সারিতে আলাদা ব্যবহারকারীর নাম দিন।`));
      }
    }

    if (rowErrors.length) errors.push(...rowErrors);
    else {
      const row: FamilyImportRow = { line: record.line, studentName, parentName, parentEmail, ...(username ? { username } : {}) };
      rows.push(row);
      named.set(nameKey(studentName), [...(named.get(nameKey(studentName)) ?? []), row]);
    }
  }
  return { rows, errors };
}

/** Sign-in sheet rows grouped by parent, in upload order, so siblings share one family block. */
export function groupFamilies(rows: FamilySheetRow[]): FamilyGroup[] {
  const groups = new Map<string, FamilyGroup>();
  for (const row of rows) {
    const group = groups.get(row.parentEmail) ?? { parentName: row.parentName, parentEmail: row.parentEmail, parentTemporaryPassword: row.parentTemporaryPassword, children: [] };
    group.children.push(row);
    groups.set(row.parentEmail, group);
  }
  return [...groups.values()];
}

/** The family sign-in sheet as CSV (one row per student and parent), with the formula guard. Headers follow the page language. */
export function familySheetCsv(rows: FamilySheetRow[], language: "en" | "bn" = "en"): string {
  const bn = language === "bn";
  const header = bn
    ? ["শিক্ষার্থীর নাম", "শিক্ষার্থীর ব্যবহারকারীর নাম", "শিক্ষার্থীর অস্থায়ী পাসওয়ার্ড", "অভিভাবকের নাম", "অভিভাবকের ইমেইল", "অভিভাবকের অস্থায়ী পাসওয়ার্ড"]
    : ["Student name", "Student username", "Student temporary password", "Parent name", "Parent email", "Parent temporary password"];
  const existing = bn ? "আগের অ্যাকাউন্ট, পাসওয়ার্ড বদলায়নি" : "Existing account, password unchanged";
  return csvRows([header, ...rows.map((row) => [row.studentName, row.username, row.temporaryPassword ?? existing, row.parentName, row.parentEmail, row.parentTemporaryPassword ?? existing])]);
}

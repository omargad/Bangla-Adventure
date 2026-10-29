import { csvRows } from "./csv";

/**
 * Pure helpers for the teacher's "add students from a CSV file" upload:
 * parsing and row validation, generated-username slugs and the sign-in sheet.
 * No Node-only imports, so the browser can share the limits and the sheet builder.
 * The record reader and issue helpers are shared with the family import (lib/family-import.ts).
 */

export const MAX_IMPORT_ROWS = 200;
export const MAX_IMPORT_BYTES = 64 * 1024;
export const MAX_NAME_LENGTH = 60;
export const STUDENT_IMPORT_TEMPLATE = "name,username\nMaya Rahman,\nArif Hossain,arif.hossain\n";

export type StudentImportRow = { line: number; displayName: string; username?: string };
/** `line` is the 1-based line in the file; 0 means the file as a whole. `messageBn` is the same message in Bangla. */
export type StudentImportIssue = { line: number; message: string; messageBn?: string };
export type ImportIssue = StudentImportIssue;
export type StudentImportResult = { rows: StudentImportRow[]; errors: StudentImportIssue[] };
export type SignInSheetRow = { displayName: string; username: string; temporaryPassword: string };

const NAME_HEADERS = new Set(["name", "student name", "display name", "displayname"]);
const USERNAME_HEADERS = new Set(["username", "user name"]);
export const USERNAME_PATTERN = /^[a-z0-9._-]{3,40}$/;
export const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

export type CsvRecord = { line: number; fields: string[] };

export function importTooLarge(text: string): boolean {
  return text.length > MAX_IMPORT_BYTES || new TextEncoder().encode(text).length > MAX_IMPORT_BYTES;
}

/** A row or file problem in English and Bangla. */
export function issue(line: number, message: string, messageBn: string): ImportIssue {
  return { line, message, messageBn };
}

/** A number written with Bangla digits, for the Bangla half of a message. */
export function bnNumber(value: number): string {
  return value.toLocaleString("bn-BD", { useGrouping: false });
}

/** Echo user input in a message without letting a huge cell flood the error list. */
export function quote(value: string): string {
  return `"${value.length > 40 ? `${value.slice(0, 40)}…` : value}"`;
}

/** A name as people read it, for comparisons: case, spacing and Unicode form do not matter. */
export function nameKey(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}
export const sameName = (a: string, b: string) => nameKey(a) === nameKey(b);

export const fileTooLargeIssue = () => issue(0, `The file is larger than ${MAX_IMPORT_BYTES / 1024} KB. Split it into smaller files.`, `ফাইলটি ${bnNumber(MAX_IMPORT_BYTES / 1024)} KB-এর বড়। ছোট ছোট ফাইলে ভাগ করুন।`);

/**
 * RFC 4180 records: quoted fields may hold commas, line breaks and doubled quotes.
 * Accepts CRLF, LF or CR line endings. Each record keeps the line it starts on.
 */
export function readCsvRecords(text: string): { records: CsvRecord[]; error?: ImportIssue } {
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  let quoteLine = 1;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else {
        if (char === "\n" || (char === "\r" && text[index + 1] !== "\n")) line += 1;
        field += char;
      }
    } else if (char === '"' && !field.trim()) {
      // A quote opens a field only at its start (leading spaces allowed); elsewhere it is literal.
      quoted = true; quoteLine = line; field = "";
    } else if (char === ",") {
      fields.push(field); field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      fields.push(field); records.push({ line: recordLine, fields });
      fields = []; field = ""; line += 1; recordLine = line;
    } else field += char;
  }
  if (quoted) return { records, error: issue(quoteLine, 'A quoted value is never closed. Check for a missing double quote (").', 'একটি উদ্ধৃত মান কোথাও বন্ধ হয়নি। কোনো ডাবল কোট (") বাদ পড়েছে কি না দেখুন।') };
  if (field || fields.length) { fields.push(field); records.push({ line: recordLine, fields }); }
  return { records };
}

export const isBlankRecord = (record: CsvRecord) => record.fields.every((value) => !value.trim());
export const headerKey = (value: string) => value.trim().toLowerCase().replace(/[\s_]+/g, " ");

/** The problems with one person's name in an upload, or none. `who` describes the person in both languages. */
export function nameIssues(line: number, name: string, who: [string, string]): ImportIssue[] {
  if (!name) return [issue(line, `Enter the ${who[0]}'s name.`, `${who[1]} নাম লিখুন।`)];
  if (name.length > MAX_NAME_LENGTH) return [issue(line, `Names can be at most ${MAX_NAME_LENGTH} characters.`, `নাম সর্বোচ্চ ${bnNumber(MAX_NAME_LENGTH)} অক্ষরের হতে পারে।`)];
  if (CONTROL_CHARS.test(name)) return [issue(line, "Keep each name on one line, without tabs or line breaks.", "প্রতিটি নাম এক লাইনে লিখুন, ট্যাব বা লাইন ভাঙা ছাড়া।")];
  return [];
}

/** Checks an optional username cell; remembers valid ones in `seen` so a repeat names the earlier line. */
export function usernameIssues(line: number, rawUsername: string, seen: Map<string, number>): { username: string; errors: ImportIssue[] } {
  const username = rawUsername.toLowerCase();
  if (rawUsername && !USERNAME_PATTERN.test(username)) {
    return { username, errors: [issue(line, `Username ${quote(rawUsername)} must be 3–40 letters, numbers, dots, dashes or underscores.`, `ব্যবহারকারীর নাম ${quote(rawUsername)}-এ ৩–৪০টি অক্ষর, সংখ্যা, ডট, ড্যাশ বা আন্ডারস্কোর থাকতে হবে।`)] };
  }
  if (username && seen.has(username)) {
    return { username, errors: [issue(line, `Username ${quote(username)} is already used on line ${seen.get(username)}.`, `ব্যবহারকারীর নাম ${quote(username)} লাইন ${bnNumber(seen.get(username)!)}-এ আগেই ব্যবহার হয়েছে।`)] };
  }
  if (username) seen.set(username, line);
  return { username, errors: [] };
}

export const tooManyRowsIssue = (line: number, rows: number) => issue(line,
  `Upload at most ${MAX_IMPORT_ROWS} students at a time. This file has ${rows}; split it into smaller files.`,
  `একবারে সর্বোচ্চ ${bnNumber(MAX_IMPORT_ROWS)} জন শিক্ষার্থী আপলোড করুন। এই ফাইলে আছে ${bnNumber(rows)} জন; ছোট ছোট ফাইলে ভাগ করুন।`);

/**
 * Parse a teacher's student list. A header row is required with a name column
 * ("name", "student name", "display name" or "displayname") and an optional
 * "username"/"user name" column. Every problem is reported with its line number.
 */
export function parseStudentCsv(input: string): StudentImportResult {
  if (importTooLarge(input)) return { rows: [], errors: [fileTooLargeIssue()] };
  const { records, error } = readCsvRecords(input.replace(/^﻿/, ""));
  if (error) return { rows: [], errors: [error] };
  const content = records.filter((record) => !isBlankRecord(record));
  const header = content[0];
  if (!header) return { rows: [], errors: [issue(0, "The file is empty. Add a header row (name,username) and one student per line.", "ফাইলটি খালি। প্রথমে একটি শিরোনাম সারি (name,username) দিন, তারপর প্রতি লাইনে একজন শিক্ষার্থী।")] };

  const headerErrors: StudentImportIssue[] = [];
  const unknown: string[] = [];
  let nameIndex = -1;
  let usernameIndex = -1;
  header.fields.forEach((value, index) => {
    const key = headerKey(value);
    if (!key) return;
    if (NAME_HEADERS.has(key)) {
      if (nameIndex >= 0) headerErrors.push(issue(header.line, "The header row has more than one name column. Keep only one.", "শিরোনাম সারিতে একাধিক নামের কলাম আছে। একটি রাখুন।"));
      else nameIndex = index;
    } else if (USERNAME_HEADERS.has(key)) {
      if (usernameIndex >= 0) headerErrors.push(issue(header.line, "The header row has more than one username column. Keep only one.", "শিরোনাম সারিতে একাধিক username কলাম আছে। একটি রাখুন।"));
      else usernameIndex = index;
    } else unknown.push(quote(value.trim()));
  });
  if (nameIndex < 0) {
    const found = unknown.length ? ` Found: ${unknown.join(", ")}.` : "";
    const foundBn = unknown.length ? ` পাওয়া গেছে: ${unknown.join(", ")}।` : "";
    return { rows: [], errors: [issue(header.line, `The first row must be a header with a name column ("name", "student name" or "display name") and, optionally, "username".${found}`, `প্রথম সারিটি হতে হবে শিরোনাম, যেখানে একটি নামের কলাম ("name", "student name" বা "display name") আর চাইলে "username" থাকবে।${foundBn}`)] };
  }
  for (const column of unknown) headerErrors.push(issue(header.line, `Unknown column ${column}. Use only "name" and, optionally, "username".`, `অচেনা কলাম ${column}। শুধু "name" এবং চাইলে "username" ব্যবহার করুন।`));
  if (headerErrors.length) return { rows: [], errors: headerErrors };

  const data = content.slice(1);
  if (!data.length) return { rows: [], errors: [issue(header.line, "Add at least one student below the header row.", "শিরোনাম সারির নিচে অন্তত একজন শিক্ষার্থী যোগ করুন।")] };
  if (data.length > MAX_IMPORT_ROWS) return { rows: [], errors: [tooManyRowsIssue(data[MAX_IMPORT_ROWS].line, data.length)] };

  const rows: StudentImportRow[] = [];
  const errors: StudentImportIssue[] = [];
  const usernameLines = new Map<string, number>();
  for (const record of data) {
    const rowErrors: StudentImportIssue[] = [];
    if (record.fields.some((value, index) => index !== nameIndex && index !== usernameIndex && value.trim())) {
      rowErrors.push(issue(record.line, 'This row has more values than the header. Put names that contain commas in double quotes, e.g. "Rahman, Maya".', 'এই সারিতে শিরোনামের চেয়ে বেশি মান আছে। কমা আছে এমন নাম ডাবল কোটের মধ্যে লিখুন, যেমন "Rahman, Maya"।'));
    }
    const displayName = (record.fields[nameIndex] ?? "").trim();
    rowErrors.push(...nameIssues(record.line, displayName, ["student", "শিক্ষার্থীর"]));
    const checked = usernameIssues(record.line, usernameIndex >= 0 ? (record.fields[usernameIndex] ?? "").trim() : "", usernameLines);
    rowErrors.push(...checked.errors);

    if (rowErrors.length) errors.push(...rowErrors);
    else rows.push({ line: record.line, displayName, ...(checked.username ? { username: checked.username } : {}) });
  }
  return { rows, errors };
}

/** ASCII base for a generated username ("Maya Rahman" → "maya.rahman"); "student" when nothing is left. */
export function usernameSlug(displayName: string): string {
  const slug = displayName.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/['’]/g, "").replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "")
    .slice(0, 24).replace(/\.+$/, "");
  return slug || "student";
}

/** The printable sign-in sheet as CSV, with the same formula guard as the grade export. Headers follow the page language. */
export function signInSheetCsv(accounts: SignInSheetRow[], language: "en" | "bn" = "en"): string {
  const header = language === "bn" ? ["নাম", "ব্যবহারকারীর নাম", "অস্থায়ী পাসওয়ার্ড"] : ["Name", "Username", "Temporary password"];
  return csvRows([header, ...accounts.map((account) => [account.displayName, account.username, account.temporaryPassword])]);
}

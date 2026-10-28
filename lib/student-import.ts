import { csvRows } from "./csv";

/**
 * Pure helpers for the teacher's "add students from a CSV file" upload:
 * parsing and row validation, generated-username slugs and the sign-in sheet.
 * No Node-only imports, so the browser can share the limits and the sheet builder.
 */

export const MAX_IMPORT_ROWS = 200;
export const MAX_IMPORT_BYTES = 64 * 1024;
export const MAX_NAME_LENGTH = 60;
export const STUDENT_IMPORT_TEMPLATE = "name,username\nMaya Rahman,\nArif Hossain,arif.hossain\n";

export type StudentImportRow = { line: number; displayName: string; username?: string };
/** `line` is the 1-based line in the file; 0 means the file as a whole. */
export type StudentImportIssue = { line: number; message: string };
export type StudentImportResult = { rows: StudentImportRow[]; errors: StudentImportIssue[] };
export type SignInSheetRow = { displayName: string; username: string; temporaryPassword: string };

const NAME_HEADERS = new Set(["name", "student name", "display name", "displayname"]);
const USERNAME_HEADERS = new Set(["username", "user name"]);
const USERNAME_PATTERN = /^[a-z0-9._-]{3,40}$/;
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

type CsvRecord = { line: number; fields: string[] };

export function importTooLarge(text: string): boolean {
  return text.length > MAX_IMPORT_BYTES || new TextEncoder().encode(text).length > MAX_IMPORT_BYTES;
}

/** Echo user input in a message without letting a huge cell flood the error list. */
function quote(value: string): string {
  return `"${value.length > 40 ? `${value.slice(0, 40)}…` : value}"`;
}

/**
 * RFC 4180 records: quoted fields may hold commas, line breaks and doubled quotes.
 * Accepts CRLF, LF or CR line endings. Each record keeps the line it starts on.
 */
function readRecords(text: string): { records: CsvRecord[]; error?: StudentImportIssue } {
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
  if (quoted) return { records, error: { line: quoteLine, message: 'A quoted value is never closed. Check for a missing double quote (").' } };
  if (field || fields.length) { fields.push(field); records.push({ line: recordLine, fields }); }
  return { records };
}

const isBlank = (record: CsvRecord) => record.fields.every((value) => !value.trim());
const headerKey = (value: string) => value.trim().toLowerCase().replace(/[\s_]+/g, " ");

/**
 * Parse a teacher's student list. A header row is required with a name column
 * ("name", "student name", "display name" or "displayname") and an optional
 * "username"/"user name" column. Every problem is reported with its line number.
 */
export function parseStudentCsv(input: string): StudentImportResult {
  if (importTooLarge(input)) return { rows: [], errors: [{ line: 0, message: `The file is larger than ${MAX_IMPORT_BYTES / 1024} KB. Split it into smaller files.` }] };
  const { records, error } = readRecords(input.replace(/^﻿/, ""));
  if (error) return { rows: [], errors: [error] };
  const content = records.filter((record) => !isBlank(record));
  const header = content[0];
  if (!header) return { rows: [], errors: [{ line: 0, message: "The file is empty. Add a header row (name,username) and one student per line." }] };

  const headerErrors: StudentImportIssue[] = [];
  const unknown: string[] = [];
  let nameIndex = -1;
  let usernameIndex = -1;
  header.fields.forEach((value, index) => {
    const key = headerKey(value);
    if (!key) return;
    if (NAME_HEADERS.has(key)) {
      if (nameIndex >= 0) headerErrors.push({ line: header.line, message: "The header row has more than one name column. Keep only one." });
      else nameIndex = index;
    } else if (USERNAME_HEADERS.has(key)) {
      if (usernameIndex >= 0) headerErrors.push({ line: header.line, message: "The header row has more than one username column. Keep only one." });
      else usernameIndex = index;
    } else unknown.push(quote(value.trim()));
  });
  if (nameIndex < 0) {
    const found = unknown.length ? ` Found: ${unknown.join(", ")}.` : "";
    return { rows: [], errors: [{ line: header.line, message: `The first row must be a header with a name column ("name", "student name" or "display name") and, optionally, "username".${found}` }] };
  }
  for (const column of unknown) headerErrors.push({ line: header.line, message: `Unknown column ${column}. Use only "name" and, optionally, "username".` });
  if (headerErrors.length) return { rows: [], errors: headerErrors };

  const data = content.slice(1);
  if (!data.length) return { rows: [], errors: [{ line: header.line, message: "Add at least one student below the header row." }] };
  if (data.length > MAX_IMPORT_ROWS) {
    return { rows: [], errors: [{ line: data[MAX_IMPORT_ROWS].line, message: `Upload at most ${MAX_IMPORT_ROWS} students at a time. This file has ${data.length}; split it into smaller files.` }] };
  }

  const rows: StudentImportRow[] = [];
  const errors: StudentImportIssue[] = [];
  const usernameLines = new Map<string, number>();
  for (const record of data) {
    const rowErrors: string[] = [];
    if (record.fields.some((value, index) => index !== nameIndex && index !== usernameIndex && value.trim())) {
      rowErrors.push('This row has more values than the header. Put names that contain commas in double quotes, e.g. "Rahman, Maya".');
    }
    const displayName = (record.fields[nameIndex] ?? "").trim();
    if (!displayName) rowErrors.push("Enter the student's name.");
    else if (displayName.length > MAX_NAME_LENGTH) rowErrors.push(`Names can be at most ${MAX_NAME_LENGTH} characters.`);
    else if (CONTROL_CHARS.test(displayName)) rowErrors.push("Keep each name on one line, without tabs or line breaks.");

    const rawUsername = usernameIndex >= 0 ? (record.fields[usernameIndex] ?? "").trim() : "";
    const username = rawUsername.toLowerCase();
    if (rawUsername && !USERNAME_PATTERN.test(username)) {
      rowErrors.push(`Username ${quote(rawUsername)} must be 3–40 letters, numbers, dots, dashes or underscores.`);
    } else if (username && usernameLines.has(username)) {
      rowErrors.push(`Username ${quote(username)} is already used on line ${usernameLines.get(username)}.`);
    } else if (username) usernameLines.set(username, record.line);

    if (rowErrors.length) errors.push(...rowErrors.map((message) => ({ line: record.line, message })));
    else rows.push({ line: record.line, displayName, ...(username ? { username } : {}) });
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

/** The printable sign-in sheet as CSV, with the same formula guard as the grade export. */
export function signInSheetCsv(accounts: SignInSheetRow[]): string {
  return csvRows([["Name", "Username", "Temporary password"], ...accounts.map((account) => [account.displayName, account.username, account.temporaryPassword])]);
}

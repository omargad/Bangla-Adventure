import assert from "node:assert/strict";
import test from "node:test";

const {
  parseStudentCsv,
  usernameSlug,
  signInSheetCsv,
  importTooLarge,
  MAX_IMPORT_ROWS,
  MAX_IMPORT_BYTES,
  STUDENT_IMPORT_TEMPLATE,
} = await import("../lib/student-import.ts");

test("parses names and optional usernames with quotes, commas and escaped quotes", () => {
  const { rows, errors } = parseStudentCsv('Name,Username\n"Rahman, Maya",Maya.R\n"Arif ""Ari"" Hossain",\nNadia Islam\n');
  assert.deepEqual(errors, []);
  assert.deepEqual(rows, [
    { line: 2, displayName: "Rahman, Maya", username: "maya.r" },
    { line: 3, displayName: 'Arif "Ari" Hossain' },
    { line: 4, displayName: "Nadia Islam" },
  ]);
});

test("accepts CRLF, a UTF-8 BOM, blank lines and every documented header spelling", () => {
  for (const [name, username] of [["name", "username"], [" Student Name ", "User Name"], ["DISPLAY NAME", "username"], ["displayname", "user name"]]) {
    const { rows, errors } = parseStudentCsv(`﻿${name},${username}\r\n\r\nমায়া রহমান,maya1\r\n  ,  \r\nArif,\r\n`);
    assert.deepEqual(errors, [], `${name}/${username}`);
    assert.deepEqual(rows, [{ line: 3, displayName: "মায়া রহমান", username: "maya1" }, { line: 5, displayName: "Arif" }]);
  }
  assert.deepEqual(parseStudentCsv("name\rMaya\rArif").rows.map((row) => row.line), [2, 3], "old Mac line endings");
  assert.deepEqual(parseStudentCsv("name").errors, [{ line: 1, message: "Add at least one student below the header row.", messageBn: "শিরোনাম সারির নিচে অন্তত একজন শিক্ষার্থী যোগ করুন।" }]);
});

test("a quoted line break keeps later line numbers accurate", () => {
  const { rows, errors } = parseStudentCsv('name,username\n"Maya\nRahman",maya\nArif,!!\n');
  assert.equal(rows.length, 0);
  assert.deepEqual(errors.map((error) => error.line), [2, 4]);
  assert.match(errors[0].message, /one line/);
  assert.match(errors[1].message, /3–40 letters/);
});

test("reports a missing or unknown name column clearly", () => {
  const missing = parseStudentCsv("Maya Rahman,maya\nArif,arif\n");
  assert.equal(missing.rows.length, 0);
  assert.equal(missing.errors.length, 1);
  assert.equal(missing.errors[0].line, 1);
  assert.match(missing.errors[0].message, /header with a name column/);
  assert.match(missing.errors[0].message, /"Maya Rahman"/);
  const unknown = parseStudentCsv("name,email\nMaya,maya@example.com\n");
  assert.deepEqual(unknown.errors, [{ line: 1, message: 'Unknown column "email". Use only "name" and, optionally, "username".', messageBn: 'অচেনা কলাম "email"। শুধু "name" এবং চাইলে "username" ব্যবহার করুন।' }]);
  assert.match(parseStudentCsv("name,student name\nMaya,Maya\n").errors[0].message, /more than one name column/);
  assert.match(parseStudentCsv("").errors[0].message, /empty/);
  assert.match(parseStudentCsv("\n \n,,\n").errors[0].message, /empty/);
});

test("validates names, usernames and file-level duplicates on the right lines", () => {
  const { rows, errors } = parseStudentCsv([
    "name,username",
    ",nameless",
    `${"x".repeat(61)},`,
    "Maya,MAYA",
    "Maya Two,maya",
    "Arif,ab",
    "Nadia,nadia islam",
    "Islam, Nadia, Begum",
    `${"y".repeat(60)},ok_name-1`,
  ].join("\n"));
  assert.deepEqual(rows, [{ line: 4, displayName: "Maya", username: "maya" }, { line: 9, displayName: "y".repeat(60), username: "ok_name-1" }]);
  assert.deepEqual(errors.map((error) => error.line), [2, 3, 5, 6, 7, 8]);
  assert.match(errors[0].message, /name/);
  assert.match(errors[1].message, /at most 60 characters/);
  assert.equal(errors[2].message, 'Username "maya" is already used on line 4.');
  assert.match(errors[3].message, /3–40 letters/);
  assert.match(errors[4].message, /3–40 letters/);
  assert.match(errors[5].message, /more values than the header/);
});

test("unterminated quotes are reported at the line they start", () => {
  const { rows, errors } = parseStudentCsv('name\nMaya\n"Arif\nNadia\n');
  assert.equal(rows.length, 0);
  assert.deepEqual(errors, [{ line: 3, message: 'A quoted value is never closed. Check for a missing double quote (").', messageBn: 'একটি উদ্ধৃত মান কোথাও বন্ধ হয়নি। কোনো ডাবল কোট (") বাদ পড়েছে কি না দেখুন।' }]);
});

test("enforces the 200-row and 64 KB limits", () => {
  const atLimit = parseStudentCsv(["name", ...Array.from({ length: MAX_IMPORT_ROWS }, (_, index) => `Student ${index}`)].join("\n"));
  assert.equal(atLimit.rows.length, MAX_IMPORT_ROWS);
  assert.deepEqual(atLimit.errors, []);
  const overLimit = parseStudentCsv(["name", ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, index) => `Student ${index}`)].join("\n"));
  assert.equal(overLimit.rows.length, 0);
  assert.equal(overLimit.errors.length, 1);
  assert.equal(overLimit.errors[0].line, MAX_IMPORT_ROWS + 2);
  assert.match(overLimit.errors[0].message, /at most 200 students/);

  const big = `name\n${"a".repeat(MAX_IMPORT_BYTES)}`;
  assert.equal(importTooLarge(big), true);
  assert.equal(importTooLarge("name\nMaya"), false);
  // Measured in UTF-8 bytes, not characters: 22,000 Bangla letters are about 66 KB.
  assert.equal(importTooLarge(`name\n${"ক".repeat(22000)}`), true);
  assert.match(parseStudentCsv(big).errors[0].message, /larger than 64 KB/);
});

test("the downloadable template parses cleanly", () => {
  const { rows, errors } = parseStudentCsv(STUDENT_IMPORT_TEMPLATE);
  assert.deepEqual(errors, []);
  assert.ok(rows.length >= 1);
});

test("generated username bases are ASCII slugs with a fallback", () => {
  assert.equal(usernameSlug("Maya Rahman"), "maya.rahman");
  assert.equal(usernameSlug("  José Núñez-O'Brien "), "jose.nunez.obrien");
  assert.equal(usernameSlug("মায়া"), "student");
  assert.equal(usernameSlug("!!!"), "student");
  const long = usernameSlug("Abcdefghij Klmnopqrst Uvwxyz Extra");
  assert.ok(long.length <= 24 && !long.endsWith("."), long);
  for (const name of ["Maya Rahman", "মায়া", "A"]) assert.match(`${usernameSlug(name)}1234`, /^[a-z0-9._-]{3,40}$/);
});

test("the sign-in sheet neutralises spreadsheet formulas", () => {
  const csv = signInSheetCsv([{ displayName: "=HYPERLINK(\"x\")", username: "maya1234", temporaryPassword: "kp7m-x3qa-9t" }]);
  const [header, row] = csv.split("\n");
  assert.equal(header, '"Name","Username","Temporary password"');
  assert.equal(row, '"\'=HYPERLINK(""x"")","maya1234","kp7m-x3qa-9t"');
});

test("row errors and the sign-in sheet are bilingual", () => {
  const { errors } = parseStudentCsv("name,username\n,ok.name\nMaya,a b\nArif,ok.name\n");
  assert.deepEqual(errors.map((error) => error.line), [2, 3, 4]);
  for (const error of errors) assert.ok(error.messageBn && /[\u0980-\u09ff]/.test(error.messageBn), error.message);
  assert.equal(parseStudentCsv("name,username\nMaya,maya.r\nArif,maya.r\n").errors[0].messageBn, 'ব্যবহারকারীর নাম "maya.r" লাইন ২-এ আগেই ব্যবহার হয়েছে।', "line numbers in Bangla digits");
  assert.match(parseStudentCsv(["name", ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, index) => `S ${index}`)].join("\n")).errors[0].messageBn, /সর্বোচ্চ ২০০ জন/);
  assert.equal(signInSheetCsv([], "bn"), '"নাম","ব্যবহারকারীর নাম","অস্থায়ী পাসওয়ার্ড"');
});

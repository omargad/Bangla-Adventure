import assert from "node:assert/strict";
import test from "node:test";

const { parseFamilyCsv, groupFamilies, familySheetCsv, FAMILY_IMPORT_TEMPLATE } = await import("../lib/family-import.ts");
const { MAX_IMPORT_ROWS, MAX_IMPORT_BYTES } = await import("../lib/student-import.ts");

const bangla = /[ঀ-৿]/;

test("accepts the client's three columns and every documented header spelling", () => {
  for (const header of [
    "student name,parent name,parent email",
    " Student Name , Parent Name , Parent Email ",
    "Student,Parent,Email",
    "STUDENT_NAME,parent_name,E-mail",
    "child name,guardian,parent e-mail",
    "Student,Parent,Email Address",
  ]) {
    const { rows, errors } = parseFamilyCsv(`﻿${header}\r\n\r\nমায়া রহমান,Farida Rahman,Farida@Example.com\r\n`);
    assert.deepEqual(errors, [], header);
    assert.deepEqual(rows, [{ line: 3, studentName: "মায়া রহমান", parentName: "Farida Rahman", parentEmail: "farida@example.com" }], header);
  }
  const reordered = parseFamilyCsv('parent email,student username,student name,parent name\nkarim@example.com,Nadia.I,"Islam, Nadia",Karim Islam\n');
  assert.deepEqual(reordered.errors, []);
  assert.deepEqual(reordered.rows, [{ line: 2, studentName: "Islam, Nadia", parentName: "Karim Islam", parentEmail: "karim@example.com", username: "nadia.i" }]);
});

test("siblings share a parent e-mail; the same e-mail with another parent name is refused", () => {
  const { rows, errors } = parseFamilyCsv([
    "student name,parent name,parent email",
    "Maya Rahman,Farida Rahman,farida@example.com",
    "Arif Rahman,FARIDA  rahman,Farida@example.com",
    "Nadia Islam,Karim Islam,karim@example.com",
    "Rafi Rahman,Farhan Rahman,farida@example.com",
  ].join("\n"));
  assert.deepEqual(rows.map((row) => [row.line, row.parentEmail]), [[2, "farida@example.com"], [3, "farida@example.com"], [4, "karim@example.com"]]);
  assert.deepEqual(errors.map((error) => error.line), [5]);
  assert.equal(errors[0].message, 'Parent e-mail "farida@example.com" is used on line 2 for "Farida Rahman". Rows for the same parent need the same parent name.');
  assert.match(errors[0].messageBn, /লাইন ২-এ/);
});

test("reports missing, invalid and over-long e-mails and names on their lines", () => {
  const { rows, errors } = parseFamilyCsv([
    "student name,parent name,parent email",
    "Maya,Farida,",
    "Arif,Karim,karim.example.com",
    "Nadia,Salma,salma @example.com",
    `Rafi,Rina,${"r".repeat(110)}@example.com`,
    ",Lina,lina@example.com",
    "Tania,,tania@example.com",
    `${"x".repeat(61)},Joy,joy@example.com`,
    "Good Child,Good Parent,good@example.com",
  ].join("\n"));
  assert.deepEqual(rows.map((row) => row.line), [9]);
  assert.deepEqual(errors.map((error) => error.line), [2, 3, 4, 5, 6, 7, 8]);
  assert.equal(errors[0].message, "Enter the parent's e-mail address.");
  assert.equal(errors[1].message, 'Parent e-mail "karim.example.com" is not a valid e-mail address.');
  assert.match(errors[2].message, /not a valid e-mail/);
  assert.match(errors[3].message, /at most 120 characters/);
  assert.equal(errors[4].message, "Enter the student's name.");
  assert.equal(errors[5].message, "Enter the parent's name.");
  assert.match(errors[6].message, /at most 60 characters/);
  for (const error of errors) assert.ok(bangla.test(error.messageBn), error.message);
});

test("duplicate students and usernames are refused, naming the earlier line", () => {
  const { rows, errors } = parseFamilyCsv([
    "student name,parent name,parent email,student username",
    "Maya Rahman,Farida Rahman,farida@example.com,maya.r",
    "maya  rahman,Farida Rahman,farida@example.com,",
    "Arif Rahman,Karim Islam,karim@example.com,MAYA.R",
    "Arif,Farida Rahman,farida@example.com,a b",
    "Maya Rahman,Farida Rahman,farida@example.com,maya.r",
  ].join("\n"));
  assert.deepEqual(rows.map((row) => row.line), [2]);
  assert.deepEqual(errors.map((error) => error.line), [3, 4, 5, 6]);
  assert.equal(errors[0].message, '"maya  rahman" is already listed with this parent on line 2.');
  assert.equal(errors[1].message, 'Username "maya.r" is already used on line 2. Rows may share a username only for the same child with another parent.');
  assert.match(errors[1].messageBn, /লাইন ২-এ/);
  assert.match(errors[2].message, /3–40 letters/);
  assert.equal(errors[3].message, '"Maya Rahman" is already listed with this parent on line 2.', "one error for a repeated row");
});

test("one child with two parents shares a username; the same name under two e-mails needs usernames", () => {
  const shared = parseFamilyCsv([
    "student name,parent name,parent email,student username",
    "Maya Rahman,Farida Rahman,farida@example.com,maya.r",
    "MAYA RAHMAN,Karim Rahman,karim@example.com,maya.r",
    "Arif Hossain,Salma Hossain,salma@example.com,arif.h",
    "Arif Hossain,Rina Akter,rina@example.com,arif.a",
  ].join("\n"));
  assert.deepEqual(shared.errors, []);
  assert.deepEqual(shared.rows.map((row) => [row.line, row.username, row.parentEmail]), [
    [2, "maya.r", "farida@example.com"], [3, "maya.r", "karim@example.com"], [4, "arif.h", "salma@example.com"], [5, "arif.a", "rina@example.com"]]);

  const ambiguous = parseFamilyCsv([
    "student name,parent name,parent email,student username",
    "Maya Rahman,Farida Rahman,farida@example.com,",
    "Maya Rahman,Karim Rahman,karim@example.com,",
    "Nadia Islam,Salma Islam,salma@example.com,nadia.i",
    "nadia islam,Karim Islam,karim.islam@example.com,",
  ].join("\n"));
  assert.deepEqual(ambiguous.rows.map((row) => row.line), [2, 4]);
  assert.deepEqual(ambiguous.errors.map((error) => error.line), [3, 5]);
  assert.equal(ambiguous.errors[0].message, '"Maya Rahman" is also listed on line 2 with another parent\'s e-mail. If this is one child with two parents, write the same username in the "student username" column on both rows, so the child gets one account. If they are different children, give each row its own username.');
  assert.match(ambiguous.errors[1].message, /^"nadia islam" is also listed on line 4/);
  for (const error of ambiguous.errors) assert.ok(bangla.test(error.messageBn));
});

test("the header must name the three columns, once each, and nothing else", () => {
  const missing = parseFamilyCsv("name,email\nMaya,farida@example.com\n");
  assert.equal(missing.rows.length, 0);
  assert.equal(missing.errors.length, 1);
  assert.equal(missing.errors[0].line, 1);
  assert.match(missing.errors[0].message, /Missing: "student name", "parent name"\. Found: "name"\./);
  assert.match(missing.errors[0].messageBn, /নেই/);
  const unknown = parseFamilyCsv("student name,parent name,parent email,phone\nMaya,Farida,farida@example.com,0400\n");
  assert.deepEqual(unknown.errors.map((error) => error.message), ['Unknown column "phone". Use "student name", "parent name", "parent email" and, optionally, "student username".']);
  assert.match(parseFamilyCsv("student,student name,parent,email\nMaya,Maya,Farida,f@example.com\n").errors[0].message, /more than one "student name" column/);
  assert.match(parseFamilyCsv("student name,parent name,parent email\nMaya,Farida,f@example.com,extra\n").errors[0].message, /more values than the header/);
  assert.match(parseFamilyCsv("").errors[0].message, /empty/);
  assert.match(parseFamilyCsv("student name,parent name,parent email\n").errors[0].message, /at least one student/);
  assert.match(parseFamilyCsv('student name,parent name,parent email\n"Maya,Farida,f@example.com\n').errors[0].message, /never closed/);
});

test("uses the same row and size limits as the student import", () => {
  const rows = (count) => ["student name,parent name,parent email", ...Array.from({ length: count }, (_, index) => `Child ${index},Parent ${index},parent${index}@example.com`)].join("\n");
  assert.equal(parseFamilyCsv(rows(MAX_IMPORT_ROWS)).rows.length, MAX_IMPORT_ROWS);
  const over = parseFamilyCsv(rows(MAX_IMPORT_ROWS + 1));
  assert.equal(over.rows.length, 0);
  assert.equal(over.errors[0].line, MAX_IMPORT_ROWS + 2);
  assert.match(over.errors[0].message, /at most 200 students/);
  assert.match(parseFamilyCsv(`student name,parent name,parent email\n${"a".repeat(MAX_IMPORT_BYTES)}`).errors[0].message, /larger than 64 KB/);
});

test("the downloadable template parses cleanly and includes siblings", () => {
  const { rows, errors } = parseFamilyCsv(FAMILY_IMPORT_TEMPLATE);
  assert.deepEqual(errors, []);
  assert.ok(rows.length >= 2);
  assert.ok(new Set(rows.map((row) => row.parentEmail)).size < rows.length);
});

test("the sign-in sheet groups siblings by parent and marks existing parent and student accounts", () => {
  const sheet = [
    { studentName: "Maya", username: "maya1234", temporaryPassword: "aaaa-bbbb-cc", parentName: "Farida", parentEmail: "farida@example.com", parentTemporaryPassword: "pppp-qqqq-rr" },
    { studentName: "=Nadia", username: "nadia1234", temporaryPassword: "dddd-eeee-ff", parentName: "Karim", parentEmail: "karim@example.com", parentTemporaryPassword: null },
    { studentName: "Arif", username: "arif1234", temporaryPassword: "gggg-hhhh-ii", parentName: "Farida", parentEmail: "farida@example.com", parentTemporaryPassword: "pppp-qqqq-rr" },
    { studentName: "Rafi", username: "rafi.self", temporaryPassword: null, parentName: "Karim", parentEmail: "karim@example.com", parentTemporaryPassword: null },
  ];
  const groups = groupFamilies(sheet);
  assert.deepEqual(groups.map((group) => [group.parentEmail, group.children.map((child) => child.username)]), [["farida@example.com", ["maya1234", "arif1234"]], ["karim@example.com", ["nadia1234", "rafi.self"]]]);
  assert.equal(groups[1].parentTemporaryPassword, null);
  const lines = familySheetCsv(sheet).split("\n");
  assert.equal(lines[0], '"Student name","Student username","Student temporary password","Parent name","Parent email","Parent temporary password"');
  assert.equal(lines[1], '"Maya","maya1234","aaaa-bbbb-cc","Farida","farida@example.com","pppp-qqqq-rr"');
  assert.equal(lines[2], '"\'=Nadia","nadia1234","dddd-eeee-ff","Karim","karim@example.com","Existing account, password unchanged"');
  assert.equal(lines[4], '"Rafi","rafi.self","Existing account, password unchanged","Karim","karim@example.com","Existing account, password unchanged"');
  const bn = familySheetCsv(sheet, "bn").split("\n");
  assert.ok(bangla.test(bn[0]));
  assert.match(bn[2], /আগের অ্যাকাউন্ট, পাসওয়ার্ড বদলায়নি/);
});

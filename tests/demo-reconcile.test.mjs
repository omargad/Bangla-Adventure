import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { bootstrapSql } from "../db/bootstrap.ts";
import { migrateAccessControl } from "../db/access-migration.ts";
import { migrateContent } from "../db/content-migration.ts";
import { gradeAnswers } from "../lib/classroom.ts";
import { reconcileDemo, DEMO_CLASS_ID, DEMO_UNITS, DEMO_ROSTER } from "../scripts/reconcile-demo.ts";

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "bangla-reconcile-"));
  const file = path.join(dir, "demo.db");
  const db = new Database(file);
  db.pragma("foreign_keys = ON");
  db.exec(bootstrapSql); migrateAccessControl(db); migrateContent(db);
  for (const [key, email, name, role] of [["admin", "admin@admin.com", "Admin", "admin"], ["teacher", "timmarco@gmail.com", "Tim Marco", "teacher"], ["parent", "franksamo@gmail.com", "Frank Samo", "parent"]]) {
    db.prepare("INSERT INTO adults(id,email,display_name,password_hash,role,teacher_status,approval_status) VALUES(?,?,?,?,?,?,'approved')").run(key, email, name, `unchanged-${key}-password`, role, role === "teacher" ? "approved" : "none");
    db.prepare("INSERT INTO adult_sessions(token_hash,adult_id,expires_at) VALUES(?,?,?)").run(`session-${key}`, key, "2099-01-01");
  }
  db.prepare("INSERT INTO classes(id,teacher_id,name,join_code) VALUES(?,'teacher','Demo Class','ABC234')").run(DEMO_CLASS_ID);
  const students = [{ username: "camel", name: "Camel" }, ...DEMO_ROSTER];
  for (const student of students) {
    db.prepare("INSERT INTO students(id,username,display_name,password_hash,approval_status,must_change_password) VALUES(?,?,?,?,'approved',?)").run(student.username, student.username, student.name, `unchanged-${student.username}`, student.username === "camel" ? 0 : 1);
    db.prepare("INSERT INTO student_sessions(token_hash,student_id,expires_at) VALUES(?,?,?)").run(`session-${student.username}`, student.username, "2099-01-01");
    db.prepare("INSERT INTO class_students(id,class_id,display_name,token_hash) VALUES(?,?,?,?)").run(`roster-${student.username}`, DEMO_CLASS_ID, student.name, `token-${student.username}`);
    db.prepare("INSERT INTO student_class_enrollments(id,student_id,class_id,class_student_id) VALUES(?,?,?,?)").run(`enrol-${student.username}`, student.username, DEMO_CLASS_ID, `roster-${student.username}`);
    for (const date of ["2026-10-22", "2026-10-29", "2026-11-05"]) db.prepare("INSERT INTO class_attendance(id,class_id,student_id,session_date,present,recorded_by) VALUES(?,?,?,?,1,'admin')").run(`${student.username}-${date}`, DEMO_CLASS_ID, student.username, date);
  }
  db.prepare("INSERT INTO parent_student_links(id,parent_id,student_id) VALUES('family','parent','camel')").run();
  for (const [i, unit] of DEMO_UNITS.entries()) {
    db.prepare("INSERT INTO class_activities(id,class_id,title,topic_id,questions_json,instructions) VALUES(?,?,?,?,?,?)").run(`unit-${i}`, DEMO_CLASS_ID, unit.title, unit.topic, JSON.stringify(unit.questions), "Existing browser-created instructions");
    if (i < 3) {
      const answers = i === 0 ? [0, 1, 0] : [0, 0, 0];
      const grade = gradeAnswers(unit.questions, answers);
      db.prepare("INSERT INTO activity_submissions(id,activity_id,student_id,answers_json,score,total,submitted_at) VALUES(?,?,'roster-camel',?,?,?,'2026-11-04T22:00:00Z')").run(`camel-unit-${i}`, `unit-${i}`, JSON.stringify(answers), grade.score, grade.total);
      db.prepare("INSERT INTO student_topic_progress(student_id,topic_id,completed_at,quiz_best_score,quiz_total,quiz_key,quiz_completed_at) VALUES('camel',?,'2026-11-04T22:00:00Z',3,3,'existing-quiz','2026-11-04T22:00:00Z')").run(unit.topic);
    }
  }
  db.prepare("INSERT INTO class_announcements(id,class_id,body,audience,author_id) VALUES('existing-notice',?,'Existing announcement','all','teacher')").run(DEMO_CLASS_ID);
  return { db, file, close() { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}
function dump(db) {
  return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
}
function assertExistingRowsPreserved(db, before) {
  const after = dump(db);
  for (const [table, rows] of Object.entries(before)) {
    for (const row of rows) assert.ok(after[table].some(actual => JSON.stringify(actual) === JSON.stringify(row)), `An existing row changed in ${table}`);
  }
}

test("populated demo repair adds varied work and applicants, preserves all existing rows, and has a restorable backup", async () => {
  const f = fixture();
  try {
    // A signup already completed in the browser is kept, including its password.
    f.db.prepare("INSERT INTO adults(id,email,display_name,password_hash,role,teacher_status,approval_status) VALUES('existing-laila','demo.laila.rahman@example.com','Laila Rahman (Demo)','existing-laila-password','parent','pending','pending')").run();
    // Work submitted by a supporting learner before repair is authoritative.
    f.db.prepare("INSERT INTO activity_submissions(id,activity_id,student_id,answers_json,score,total) VALUES('real-maya-work','unit-0','roster-demo.maya','[1,1,1]',0,3)").run();
    const before = dump(f.db);
    const preview = await reconcileDemo(f.file);
    assert.equal(preview.status, "dry-run");
    assert.equal(preview.summary.submissionsToAdd, 12);
    assert.equal(preview.summary.applicantsToAdd.length, 2);
    assert.deepEqual(dump(f.db), before);
    const result = await reconcileDemo(f.file, { apply: true });
    assert.equal(result.status, "applied");
    assert.equal(statSync(result.backupPath).mode & 0o777, 0o600);
    const backup = new Database(result.backupPath, { readonly: true });
    try { assert.deepEqual(dump(backup), before); } finally { backup.close(); }
    assertExistingRowsPreserved(f.db, before);
    assert.deepEqual(f.db.pragma("foreign_key_check"), []);
    assert.equal(f.db.pragma("integrity_check", { simple: true }), "ok");
    assert.equal(f.db.prepare("SELECT count(*) n FROM activity_submissions").get().n, 16);
    assert.equal(f.db.prepare("SELECT count(*) n FROM activity_submissions WHERE activity_id='unit-3'").get().n, 0);
    assert.equal(f.db.prepare("SELECT count(*) n FROM adults WHERE approval_status='pending'").get().n, 2);
    assert.equal(f.db.prepare("SELECT count(*) n FROM students WHERE approval_status='pending'").get().n, 1);
    for (const row of f.db.prepare("SELECT s.*,a.questions_json FROM activity_submissions s JOIN class_activities a ON a.id=s.activity_id").all()) {
      const grade = gradeAnswers(JSON.parse(row.questions_json), JSON.parse(row.answers_json));
      assert.equal(row.score, grade.score); assert.equal(row.total, grade.total);
    }
    // Later approval, new Camel work, and a teacher reset survive any rerun.
    f.db.prepare("UPDATE adults SET role='teacher',teacher_status='approved',approval_status='approved' WHERE id='existing-laila'").run();
    f.db.prepare("INSERT INTO activity_submissions(id,activity_id,student_id,answers_json,score,total) VALUES('camel-showcase','unit-3','roster-camel','[0,0,0]',3,3)").run();
    f.db.prepare("DELETE FROM activity_submissions WHERE student_id='roster-demo.zara' AND activity_id='unit-0'").run();
    const afterActions = dump(f.db);
    assert.equal((await reconcileDemo(f.file, { apply: true })).status, "already-applied");
    assert.deepEqual(dump(f.db), afterActions);
  } finally { f.close(); }
});

test("repair refuses a changed question, applicant collision, or unrelated class without writes", async () => {
  for (const change of [
    db => db.prepare("UPDATE class_activities SET questions_json='[]' WHERE id='unit-0'").run(),
    db => db.prepare("INSERT INTO adults(id,email,display_name,password_hash) VALUES('collision','demo.laila.rahman@example.com','Someone Else','hash')").run(),
    db => db.prepare("UPDATE classes SET name='Real school class' WHERE id=?").run(DEMO_CLASS_ID),
    db => db.prepare("UPDATE students SET display_name='Someone Else' WHERE username='demo.maya'").run(),
    db => db.prepare("UPDATE class_activities SET status='closed' WHERE id='unit-0'").run(),
  ]) {
    const f = fixture();
    try {
      change(f.db);
      const before = dump(f.db);
      await assert.rejects(reconcileDemo(f.file, { apply: true }));
      assert.deepEqual(dump(f.db), before);
    } finally { f.close(); }
  }
});

test("new applicants remain pending with no family links, classes or sessions", async () => {
  const f = fixture();
  try {
    const result = await reconcileDemo(f.file, { apply: true });
    assert.equal(result.summary.applicantsToAdd.length, 3);
    const adults = f.db.prepare("SELECT * FROM adults WHERE approval_status='pending'").all();
    const students = f.db.prepare("SELECT * FROM students WHERE approval_status='pending'").all();
    assert.equal(adults.length, 2); assert.equal(students.length, 1);
    for (const adult of adults) {
      assert.equal(adult.role, "parent");
      assert.equal(adult.must_change_password, 1);
      assert.equal(f.db.prepare("SELECT count(*) n FROM adult_sessions WHERE adult_id=?").get(adult.id).n, 0);
      assert.equal(f.db.prepare("SELECT count(*) n FROM parent_student_links WHERE parent_id=?").get(adult.id).n, 0);
      assert.equal(f.db.prepare("SELECT count(*) n FROM classes WHERE teacher_id=?").get(adult.id).n, 0);
    }
    assert.equal(adults.find(a => a.email === "demo.laila.rahman@example.com").teacher_status, "pending");
    assert.equal(students[0].must_change_password, 1);
    assert.equal(f.db.prepare("SELECT count(*) n FROM student_class_enrollments WHERE student_id=?").get(students[0].id).n, 0);
    assert.equal(f.db.prepare("SELECT count(*) n FROM student_sessions WHERE student_id=?").get(students[0].id).n, 0);
  } finally { f.close(); }
});

test("a write failure rolls back all additions and the marker", async () => {
  const f = fixture();
  try {
    f.db.exec("CREATE TRIGGER fail_demo_read BEFORE INSERT ON student_topic_progress BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END;");
    const before = dump(f.db);
    await assert.rejects(reconcileDemo(f.file, { apply: true }), /simulated write failure/);
    assert.deepEqual(dump(f.db), before);
    assert.equal(f.db.prepare("SELECT name FROM sqlite_master WHERE name='demo_reconcile_runs'").get(), undefined);
  } finally { f.close(); }
});

test("repair will not create a database or accept a relative path", async () => {
  await assert.rejects(reconcileDemo(":memory:", { apply: true }), /existing database/);
  await assert.rejects(reconcileDemo("relative.db", { apply: true }), /existing database/);
  await assert.rejects(reconcileDemo(path.join(tmpdir(), `missing-${Date.now()}.db`)), /existing database/);
});

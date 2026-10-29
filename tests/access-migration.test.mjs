import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { bootstrapSql } from "../db/bootstrap.ts";
import { migrateAccessControl } from "../db/access-migration.ts";

test("RBAC migration preserves existing accounts and is repeatable", () => {
  const db = new Database(":memory:");
  db.exec(bootstrapSql);
  db.prepare("INSERT INTO adults(id,email,display_name,password_hash) VALUES(?,?,?,?)").run("legacy", "legacy@example.com", "Existing user", "unchanged-hash");
  db.prepare("INSERT INTO students(id,username,display_name,password_hash) VALUES(?,?,?,?)").run("child", "existing-child", "Learner", "unchanged-child-hash");
  migrateAccessControl(db);
  migrateAccessControl(db);
  const adult = db.prepare("SELECT * FROM adults WHERE id = ?").get("legacy");
  assert.equal(adult.password_hash, "unchanged-hash");
  assert.equal(adult.role, "parent");
  assert.equal(adult.status, "active");
  assert.equal(adult.teacher_status, "none");
  assert.equal(db.prepare("SELECT status FROM students WHERE id = ?").get("child").status, "active");
  assert.equal(db.prepare("SELECT count(*) AS n FROM user_audit_events").get().n, 0);
  db.close();
});

test("temporary-password flag is added to existing student tables with a safe default", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE students (id text PRIMARY KEY NOT NULL, username text NOT NULL, display_name text NOT NULL, password_hash text NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)");
  db.prepare("INSERT INTO students(id,username,display_name,password_hash) VALUES(?,?,?,?)").run("child", "existing-child", "Learner", "unchanged-child-hash");
  db.exec(bootstrapSql);
  migrateAccessControl(db);
  migrateAccessControl(db);
  const row = db.prepare("SELECT must_change_password, password_hash FROM students WHERE id = ?").get("child");
  assert.equal(row.must_change_password, 0);
  assert.equal(row.password_hash, "unchanged-child-hash");
  const fresh = new Database(":memory:");
  fresh.exec(bootstrapSql);
  migrateAccessControl(fresh);
  assert.ok(fresh.prepare("PRAGMA table_info(students)").all().some((column) => column.name === "must_change_password" && column.notnull === 1));
  db.close();
  fresh.close();
});

test("approval and administrator-issued password columns default to approved, unflagged accounts", () => {
  const db = new Database(":memory:");
  db.exec(bootstrapSql);
  db.prepare("INSERT INTO adults(id,email,display_name,password_hash) VALUES(?,?,?,?)").run("legacy", "legacy@example.com", "Existing user", "unchanged-hash");
  db.prepare("INSERT INTO students(id,username,display_name,password_hash) VALUES(?,?,?,?)").run("child", "existing-child", "Learner", "unchanged-child-hash");
  migrateAccessControl(db);
  migrateAccessControl(db);
  const adult = db.prepare("SELECT approval_status, must_change_password, password_hash FROM adults WHERE id = ?").get("legacy");
  assert.deepEqual({ ...adult }, { approval_status: "approved", must_change_password: 0, password_hash: "unchanged-hash" });
  assert.equal(db.prepare("SELECT approval_status FROM students WHERE id = ?").get("child").approval_status, "approved");
  assert.throws(() => db.prepare("UPDATE adults SET approval_status = 'maybe' WHERE id = ?").run("legacy"), /CHECK/);
  assert.throws(() => db.prepare("UPDATE students SET approval_status = 'maybe' WHERE id = ?").run("child"), /CHECK/);
  db.prepare("UPDATE students SET approval_status = 'pending' WHERE id = ?").run("child");
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((row) => row.name);
  assert.ok(indexes.includes("adults_approval_idx") && indexes.includes("students_approval_idx"));
  db.close();
});

test("class attendance is added to existing databases: one mark per student per class date", () => {
  const db = new Database(":memory:");
  db.exec(bootstrapSql);
  migrateAccessControl(db);
  migrateAccessControl(db);
  const columns = db.prepare("PRAGMA table_info(class_attendance)").all().map((column) => column.name);
  assert.deepEqual(columns, ["id", "class_id", "student_id", "session_date", "present", "recorded_by", "recorded_at"]);
  db.pragma("foreign_keys = ON");
  db.prepare("INSERT INTO adults(id,email,display_name,password_hash) VALUES(?,?,?,?)").run("teacher", "teacher@example.com", "Teacher", "hash");
  db.prepare("INSERT INTO students(id,username,display_name,password_hash) VALUES(?,?,?,?)").run("child", "child", "Learner", "hash");
  db.prepare("INSERT INTO classes(id,teacher_id,name,join_code) VALUES(?,?,?,?)").run("class", "teacher", "Class", "ABC234");
  const mark = db.prepare("INSERT INTO class_attendance(id,class_id,student_id,session_date,present,recorded_by) VALUES(?,?,?,?,?,?)");
  mark.run("one", "class", "child", "2026-10-28", 0, "teacher");
  assert.throws(() => mark.run("two", "class", "child", "2026-10-28", 1, "teacher"), /UNIQUE/);
  assert.throws(() => mark.run("three", "class", "child", "2026-10-21", 2, "teacher"), /CHECK/);
  assert.throws(() => mark.run("four", "class", "missing", "2026-10-21", 1, "teacher"), /FOREIGN KEY/);
  db.prepare("DELETE FROM adults WHERE id = ?").run("teacher");
  assert.equal(db.prepare("SELECT count(*) AS n FROM class_attendance").get().n, 0, "marks go with their class");
  db.close();
});

test("announcements gain an audience and an author: older posts stay students-only and credit the class teacher", () => {
  const db = new Database(":memory:");
  db.exec(bootstrapSql);
  db.pragma("foreign_keys = ON");
  db.prepare("INSERT INTO adults(id,email,display_name,password_hash) VALUES(?,?,?,?)").run("teacher", "teacher@example.com", "Teacher", "hash");
  db.prepare("INSERT INTO classes(id,teacher_id,name,join_code) VALUES(?,?,?,?)").run("class", "teacher", "Class", "ABC234");
  db.prepare("INSERT INTO class_announcements(id,class_id,body) VALUES(?,?,?)").run("old", "class", "Read the festival topic.");
  migrateAccessControl(db);
  migrateAccessControl(db);
  assert.deepEqual({ ...db.prepare("SELECT audience, author_id, body FROM class_announcements WHERE id = ?").get("old") }, { audience: "students", author_id: "teacher", body: "Read the festival topic." });
  db.prepare("INSERT INTO class_announcements(id,class_id,body) VALUES(?,?,?)").run("new", "class", "Parents' evening.");
  assert.deepEqual({ ...db.prepare("SELECT audience, author_id FROM class_announcements WHERE id = ?").get("new") }, { audience: "all", author_id: null }, "new posts default to everyone");
  migrateAccessControl(db);
  assert.equal(db.prepare("SELECT audience FROM class_announcements WHERE id = ?").get("new").audience, "all", "a later start does not backfill again");
  assert.throws(() => db.prepare("UPDATE class_announcements SET audience = 'teachers' WHERE id = ?").run("new"), /CHECK/);
  assert.throws(() => db.prepare("UPDATE class_announcements SET author_id = 'missing' WHERE id = ?").run("new"), /FOREIGN KEY/);
  db.prepare("INSERT INTO adults(id,email,display_name,password_hash) VALUES(?,?,?,?)").run("admin", "admin@example.com", "Admin", "hash");
  db.prepare("UPDATE class_announcements SET author_id = 'admin' WHERE id = ?").run("new");
  db.prepare("DELETE FROM adults WHERE id = ?").run("admin");
  assert.equal(db.prepare("SELECT author_id FROM class_announcements WHERE id = ?").get("new").author_id, null, "deleting the author keeps the post");
  db.close();
});

test("a class left pointing at a removed teacher does not stop the announcement migration", () => {
  const db = new Database(":memory:");
  db.exec(bootstrapSql);
  db.prepare("INSERT INTO adults(id,email,display_name,password_hash) VALUES(?,?,?,?)").run("teacher", "teacher@example.com", "Teacher", "hash");
  db.prepare("INSERT INTO adults(id,email,display_name,password_hash) VALUES(?,?,?,?)").run("gone", "gone@example.com", "Gone", "hash");
  db.prepare("INSERT INTO classes(id,teacher_id,name,join_code) VALUES(?,?,?,?)").run("class", "teacher", "Class", "ABC234");
  db.prepare("INSERT INTO classes(id,teacher_id,name,join_code) VALUES(?,?,?,?)").run("orphan", "gone", "Orphan", "DEF234");
  db.prepare("INSERT INTO class_announcements(id,class_id,body) VALUES(?,?,?)").run("kept", "class", "Festival day.");
  db.prepare("INSERT INTO class_announcements(id,class_id,body) VALUES(?,?,?)").run("orphaned", "orphan", "Bring a photo.");
  // Edited outside the app, where the sqlite3 shell leaves foreign keys off.
  db.pragma("foreign_keys = OFF");
  db.prepare("DELETE FROM adults WHERE id = ?").run("gone");
  db.pragma("foreign_keys = ON");
  migrateAccessControl(db);
  migrateAccessControl(db);
  const rows = db.prepare("SELECT id, audience, author_id FROM class_announcements ORDER BY id").all().map((row) => ({ ...row }));
  assert.deepEqual(rows, [{ id: "kept", audience: "students", author_id: "teacher" }, { id: "orphaned", audience: "students", author_id: null }]);
  db.close();
});

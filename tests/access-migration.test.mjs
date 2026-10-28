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

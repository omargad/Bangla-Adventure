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

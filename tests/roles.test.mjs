import assert from "node:assert/strict";
import test from "node:test";
import { canTeach, canManageUsers, accountHome, isRole, isStatus } from "../lib/roles.ts";

const parent = { role: "parent", status: "active", teacherStatus: "none" };

test("public and pending accounts cannot teach or manage users", () => {
  for (const account of [null, parent, { ...parent, teacherStatus: "pending" }, { ...parent, teacherStatus: "rejected" }]) {
    assert.equal(canTeach(account), false);
    assert.equal(canManageUsers(account), false);
  }
});

test("only approved teachers and active administrators can teach", () => {
  assert.equal(canTeach({ ...parent, role: "teacher", teacherStatus: "approved" }), true);
  assert.equal(canTeach({ ...parent, role: "teacher", teacherStatus: "pending" }), false);
  assert.equal(canTeach({ ...parent, role: "admin" }), true);
  assert.equal(canTeach({ ...parent, role: "admin", status: "suspended" }), false);
  assert.equal(canTeach({ ...parent, role: "teacher", teacherStatus: "approved", status: "suspended" }), false);
});

test("user administration does not follow from teacher status", () => {
  assert.equal(canManageUsers({ ...parent, role: "teacher", teacherStatus: "approved" }), false);
  assert.equal(canManageUsers({ ...parent, role: "admin" }), true);
  assert.equal(canManageUsers({ ...parent, role: "admin", status: "suspended" }), false);
});

test("account destinations respect roles and pending approval", () => {
  assert.equal(accountHome(parent), "/family");
  assert.equal(accountHome({ ...parent, teacherStatus: "pending" }), "/teach");
  assert.equal(accountHome({ ...parent, role: "teacher", teacherStatus: "approved" }), "/teach");
  assert.equal(accountHome({ ...parent, role: "admin" }), "/admin");
});

test("unknown roles and statuses are rejected", () => {
  assert.equal(isRole("superadmin"), false);
  assert.equal(isRole("admin"), true);
  assert.equal(isStatus("active"), true);
  assert.equal(isStatus("deleted"), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { homeLink } from "../lib/home-link.ts";

test("shared pages link each reader to their own home", () => {
  assert.deepEqual(homeLink(null, { mustChangePassword: false }), { href: "/student", label: ["My Learning", "আমার শেখা"] });
  assert.equal(homeLink(null, { mustChangePassword: true }), null);
  assert.equal(homeLink(null, null), null);
  assert.deepEqual(homeLink({ role: "parent", status: "active", teacherStatus: "none" }, null), { href: "/family", label: ["Grown-up dashboard", "বড়দের ড্যাশবোর্ড"] });
  assert.deepEqual(homeLink({ role: "teacher", status: "active", teacherStatus: "approved" }, { mustChangePassword: false }), { href: "/teach", label: ["Teacher workspace", "শিক্ষকের কর্মক্ষেত্র"] }, "a grown-up session wins");
  assert.deepEqual(homeLink({ role: "admin", status: "active", teacherStatus: "none" }, null), { href: "/admin", label: ["Administration", "প্রশাসন"] });
});

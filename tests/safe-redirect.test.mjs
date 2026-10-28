import assert from "node:assert/strict";
import test from "node:test";

const { safeReturnPath, isAdminReturnPath } = await import("../lib/safe-redirect.ts");

test("administrator login is limited to actual admin destinations", () => {
  for (const path of ["/admin", "/admin/classes", "/admin?tab=users"]) assert.equal(isAdminReturnPath(path), true);
  for (const path of ["/administrator", "/family", "//other.example/admin", "https://other.example/admin"]) assert.equal(isAdminReturnPath(path), false);
});

test("keeps genuine same-origin paths", () => {
  assert.equal(safeReturnPath("/family"), "/family");
  assert.equal(safeReturnPath("/worksheets/hello-me"), "/worksheets/hello-me");
  assert.equal(safeReturnPath("/account?tab=data#x"), "/account?tab=data#x");
});

test("rejects protocol-relative and absolute URLs", () => {
  assert.equal(safeReturnPath("//evil.com"), "/");
  assert.equal(safeReturnPath("https://evil.com"), "/");
  assert.equal(safeReturnPath("http://evil.com/path"), "/");
});

test("rejects the backslash open-redirect bypass", () => {
  // These all resolve cross-origin once the URL parser normalizes backslashes.
  assert.equal(safeReturnPath("/\\evil.com"), "/");
  assert.equal(safeReturnPath("/\\\\evil.com"), "/");
  assert.equal(safeReturnPath("\\/evil.com"), "/");
});

test("rejects control characters and empty input", () => {
  assert.equal(safeReturnPath("/\tevil"), "/");
  assert.equal(safeReturnPath("/\nevil"), "/");
  assert.equal(safeReturnPath(""), "/");
  assert.equal(safeReturnPath(null), "/");
  assert.equal(safeReturnPath(undefined), "/");
});

test("honours a custom fallback", () => {
  assert.equal(safeReturnPath("//evil.com", "/family"), "/family");
  assert.equal(safeReturnPath(undefined, "/family"), "/family");
});

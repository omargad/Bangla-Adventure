import assert from "node:assert/strict";
import test from "node:test";
import { validateMutation } from "../lib/request-security.ts";

const origin = "https://school.example";
const request = (headers = {}, method = "POST", pathname = "/api/admin/users") => new Request(`${origin}${pathname}`, { method, headers });

test("same-origin JSON mutations and nonbrowser JSON clients are accepted", () => {
  assert.equal(validateMutation(request({ origin, "content-type": "application/json" }), origin), null);
  assert.equal(validateMutation(request({ "content-type": "application/json" }), origin), null);
});

test("cross-origin forms, JSON requests and null origins fail closed", () => {
  assert.ok(validateMutation(request({ origin: "https://other.example", "content-type": "application/json" }), origin));
  assert.ok(validateMutation(request({ origin: "null", "content-type": "application/json" }), origin));
  assert.ok(validateMutation(request({ "content-type": "text/plain" }), origin));
  assert.ok(validateMutation(request({ "sec-fetch-site": "cross-site" }, "DELETE"), origin));
});

test("uploads require a verified same origin", () => {
  assert.equal(validateMutation(request({ origin, "content-type": "multipart/form-data; boundary=test" }), origin), null);
  assert.ok(validateMutation(request({ "content-type": "multipart/form-data; boundary=test" }), origin));
});

test("cross-site logout cannot mutate sessions", () => {
  assert.ok(validateMutation(request({ "sec-fetch-site": "cross-site" }, "GET", "/api/auth/sign-out"), origin));
  assert.equal(validateMutation(request({}, "GET", "/api/health"), origin), null);
});

import assert from "node:assert/strict";
import test from "node:test";
import { INSECURE_SIGN_IN, insecureSignIn, publicOrigin, validateMutation } from "../lib/request-security.ts";

const origin = "https://school.example";
const request = (headers = {}, method = "POST", pathname = "/api/admin/users") => new Request(`${origin}${pathname}`, { method, headers });
// Behind a proxy that rewrites Host and drops X-Forwarded-Proto, the address the app works out is not the browser's.
const derived = "http://app-svc:3000";
const json = (headers) => request({ "content-type": "application/json", ...headers });

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

test("without PUBLIC_ORIGIN the browser's same-origin answer is trusted when a proxy changed the address", () => {
  const sameOrigin = { origin, "sec-fetch-site": "same-origin" };
  assert.equal(validateMutation(json(sameOrigin), derived), null);
  assert.equal(validateMutation(json(sameOrigin), derived, { configured: false }), null);
  const upload = request({ ...sameOrigin, "content-type": "multipart/form-data; boundary=test" });
  assert.equal(validateMutation(upload, derived), null);
  assert.equal(validateMutation(request({ "sec-fetch-site": "same-origin" }, "GET", "/api/auth/sign-out"), derived), null);
});

test("with PUBLIC_ORIGIN the Origin header must still match it exactly", () => {
  const sameOrigin = { origin, "sec-fetch-site": "same-origin" };
  assert.equal(validateMutation(json(sameOrigin), origin, { configured: true }), null);
  // A browser sent to the server under another name (DNS rebinding) calls itself same-origin.
  assert.equal(validateMutation(json(sameOrigin), derived, { configured: true }), "The request origin could not be verified.");
  const upload = request({ ...sameOrigin, "content-type": "multipart/form-data; boundary=test" });
  assert.ok(validateMutation(upload, derived, { configured: true }));
});

test("same-site requests are rejected; typed and bookmarked ones are not", () => {
  for (const configured of [false, true]) {
    assert.equal(validateMutation(json({ origin: "https://other.school.example", "sec-fetch-site": "same-site" }), origin, { configured }), "Cross-site requests are not allowed.");
    assert.equal(validateMutation(json({ origin, "sec-fetch-site": "same-site" }), origin, { configured }), "Cross-site requests are not allowed.");
    assert.equal(validateMutation(request({ "sec-fetch-site": "same-site" }, "GET", "/api/auth/sign-out"), origin, { configured }), "Cross-site requests are not allowed.");
    assert.equal(validateMutation(json({ "sec-fetch-site": "none" }), origin, { configured }), null);
    assert.equal(validateMutation(request({ "sec-fetch-site": "none" }, "GET", "/api/auth/sign-out"), origin, { configured }), null);
  }
});

test("browsers without Sec-Fetch-Site are checked on the Origin header alone", () => {
  assert.equal(validateMutation(json({ origin: derived }), derived), null);
  assert.equal(validateMutation(json({ origin }), derived), "The request origin could not be verified.");
  assert.ok(validateMutation(request({ origin, "content-type": "multipart/form-data; boundary=test" }), derived));
});

test("PUBLIC_ORIGIN is read as scheme://host[:port]", (t) => {
  const errors = t.mock.method(console, "error", () => {});
  assert.equal(publicOrigin("https://learn.example.org/"), "https://learn.example.org");
  assert.equal(publicOrigin("  https://Learn.Example.ORG  "), "https://learn.example.org");
  assert.equal(publicOrigin("https://learn.example.org:443"), "https://learn.example.org");
  assert.equal(publicOrigin("http://learn.example.org:80/"), "http://learn.example.org");
  assert.equal(publicOrigin("https://learn.example.org:8443/school/"), "https://learn.example.org:8443");
  assert.equal(publicOrigin("http://192.168.1.20:3000"), "http://192.168.1.20:3000");
  assert.equal(errors.mock.callCount(), 0);

  assert.equal(publicOrigin(undefined), undefined);
  assert.equal(publicOrigin(""), undefined);
  assert.equal(publicOrigin("   "), undefined);
  assert.equal(errors.mock.callCount(), 0, "an empty value means none is set");

  for (const value of ["learn.example.org", "localhost:3000", "ftp://learn.example.org", "https://"]) {
    assert.equal(publicOrigin(value), undefined, value);
  }
  assert.equal(errors.mock.callCount(), 4, "each ignored value is reported once");
  assert.match(errors.mock.calls[1].arguments[0], /scheme:\/\/host\[:port\].*"localhost:3000"/);
});

test("a production sign-in from a plain http:// page on another computer is refused", () => {
  const signIn = (from) => new Request("http://app-svc:3000/api/auth/sign-in", { method: "POST", headers: from ? { origin: from } : {} });
  const environment = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    assert.equal(insecureSignIn(signIn("http://192.168.1.20:3000")), true);
    assert.equal(insecureSignIn(signIn("http://learn.example.org")), true);
    for (const from of ["https://learn.example.org", "http://localhost:3000", "http://127.0.0.1:3210", "http://[::1]:3000", "null", undefined]) {
      assert.equal(insecureSignIn(signIn(from)), false, String(from));
    }
    process.env.NODE_ENV = "development";
    assert.equal(insecureSignIn(signIn("http://192.168.1.20:3000")), false, "development servers are left alone");
  } finally {
    if (environment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = environment;
  }
  assert.match(INSECURE_SIGN_IN.error, /https:\/\//);
  assert.match(INSECURE_SIGN_IN.errorBn, /[ঀ-৿]/);
});

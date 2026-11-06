import assert from "node:assert/strict";
import test from "node:test";
import {
  INSECURE_SIGN_IN, insecureSignIn, INVALID_JSON, MAX_JSON_BODY_BYTES, mediaType, MUTATION_ERRORS_BN, publicOrigin, readBodyWithin, readFormData, readJsonObject,
  requestOrigins, serverError, validateMutation,
} from "../lib/request-security.ts";

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

test("a sent Origin that is not the expected one is refused, even when the request claims same-origin", () => {
  const sameOrigin = { origin, "sec-fetch-site": "same-origin" };
  // A non-browser client can claim same-origin; behind a proxy that rewrote Host the derived address differs too.
  assert.equal(validateMutation(json(sameOrigin), derived), "The request origin could not be verified.");
  assert.equal(validateMutation(json({ origin: "https://attacker.example", "sec-fetch-site": "same-origin" }), origin), "The request origin could not be verified.");
  const upload = request({ ...sameOrigin, "content-type": "multipart/form-data; boundary=test" });
  assert.ok(validateMutation(upload, derived));
  // With no Origin at all (a typed sign-out link), the browser's own answer is enough.
  assert.equal(validateMutation(request({ "sec-fetch-site": "same-origin" }, "GET", "/api/auth/sign-out"), derived), null);
  // Any of several expected addresses will do.
  assert.equal(validateMutation(json(sameOrigin), [derived, origin]), null);
  assert.equal(validateMutation(upload, [derived, origin]), null);
});

test("without PUBLIC_ORIGIN the expected addresses come from Host and, behind a proxy, X-Forwarded-Host", () => {
  const at = (headers) => new Request("http://app-svc:3000/api/auth/sign-in", { method: "POST", headers });
  assert.deepEqual(requestOrigins(at({ host: "app-svc:3000" })), ["http://app-svc:3000"]);
  const forwarded = { host: "app-svc:3000", "x-forwarded-host": "Learn.Example.org", "x-forwarded-proto": "https" };
  assert.deepEqual(requestOrigins(at(forwarded)), ["http://app-svc:3000", "https://app-svc:3000", "https://learn.example.org"]);
  assert.deepEqual(requestOrigins(at({ host: "learn.example.org", "x-forwarded-proto": "https, http" })), ["http://learn.example.org", "https://learn.example.org"]);
  // A browser on the public address gets through a proxy that rewrote Host only when the proxy says where it came from.
  const browser = { origin: "https://learn.example.org", "sec-fetch-site": "same-origin", "content-type": "application/json" };
  assert.equal(validateMutation(at({ ...browser, ...forwarded }), requestOrigins(at(forwarded))), null);
  assert.equal(validateMutation(at({ ...browser, host: "app-svc:3000" }), requestOrigins(at({ host: "app-svc:3000" }))), "The request origin could not be verified.");
});

test("every refusal has a Bangla message", () => {
  const refusals = [
    validateMutation(json({ "sec-fetch-site": "cross-site" }), origin),
    validateMutation(json({ origin: "https://other.example" }), origin),
    validateMutation(request({ "content-type": "text/plain" }), origin),
  ];
  for (const refusal of refusals) assert.match(MUTATION_ERRORS_BN[refusal], /[ঀ-৿]/, refusal);
});

test("with PUBLIC_ORIGIN the Origin header must still match it exactly", () => {
  assert.equal(validateMutation(json({ origin, "sec-fetch-site": "same-origin" }), origin), null);
  // A browser sent to the server under another name (DNS rebinding) calls itself same-origin.
  assert.equal(validateMutation(json({ origin: derived, "sec-fetch-site": "same-origin" }), origin), "The request origin could not be verified.");
  assert.ok(validateMutation(request({ origin: derived, "sec-fetch-site": "same-origin", "content-type": "multipart/form-data; boundary=test" }), origin));
});

test("same-site requests are rejected; typed and bookmarked ones are not", () => {
  assert.equal(validateMutation(json({ origin: "https://other.school.example", "sec-fetch-site": "same-site" }), origin), "Cross-site requests are not allowed.");
  assert.equal(validateMutation(json({ origin, "sec-fetch-site": "same-site" }), origin), "Cross-site requests are not allowed.");
  assert.equal(validateMutation(request({ "sec-fetch-site": "same-site" }, "GET", "/api/auth/sign-out"), origin), "Cross-site requests are not allowed.");
  assert.equal(validateMutation(json({ "sec-fetch-site": "none" }), origin), null);
  assert.equal(validateMutation(request({ "sec-fetch-site": "none" }, "GET", "/api/auth/sign-out"), origin), null);
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

const multipart = '--x\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--x--\r\n';

test("bodies are read only up to a byte limit, whatever Content-Length says", async () => {
  const post = (body, headers = {}) => new Request(`${origin}/api/topics`, { method: "POST", headers, body });
  assert.equal(await readBodyWithin(post('{"a":"ক"}'), 20), '{"a":"ক"}');
  assert.equal(await readBodyWithin(post("x".repeat(21)), 20), null);
  assert.equal(await readBodyWithin(post("{}", { "content-length": "999999999" }), 20), null, "a declared length over the limit is refused unread");
  assert.equal(await readBodyWithin(new Request(`${origin}/api/topics`, { method: "DELETE" }), 20), "");
  // A body streamed without a length is cut off at the limit.
  const stream = new ReadableStream({ start(controller) { for (let i = 0; i < 5; i++) controller.enqueue(new TextEncoder().encode("x".repeat(10))); controller.close(); } });
  assert.equal(await readBodyWithin(new Request(`${origin}/api/topics`, { method: "POST", body: stream, duplex: "half" }), 20), null);
  assert.equal(MAX_JSON_BODY_BYTES, 1_200_000, "a 400,000-character topic in Bangla fits");
});

test("routes answer a body that is not a JSON object, or not a form, with 400 in both languages", async () => {
  const post = (body, type) => new Request(`${origin}/api/progress`, { method: "POST", headers: { "content-type": type }, body });
  assert.deepEqual(await readJsonObject(post('{"skill":"reading"}', "application/json")), { skill: "reading" });
  for (const [body, type] of [[multipart, "multipart/form-data; boundary=x"], ["[1]", "application/json"], ["{", "application/json"], ["", "application/json"]]) {
    const response = await readJsonObject(post(body, type));
    assert.ok(response instanceof Response, type);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), INVALID_JSON);
  }
  assert.match(INVALID_JSON.errorBn, /[ঀ-৿]/);
  const notForm = await readFormData(post('{"lessonId":"hello-me"}', "application/json"));
  assert.ok(notForm instanceof Response);
  assert.equal(notForm.status, 400);
  assert.match((await notForm.json()).errorBn, /[ঀ-৿]/);
  assert.equal((await readFormData(post(multipart, "multipart/form-data; boundary=x"))).get("a"), "1");
  assert.equal(mediaType("Application/JSON; charset=utf-8"), "application/json");
  assert.equal(mediaType(null), "");
});

test("an unexpected failure is logged on the server and answered with a fixed message", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const response = serverError("GET /api/studio/reviews", new Error("SQLITE_CORRUPT: database disk image is malformed at /var/lib/secret.db"));
  assert.equal(response.status, 500);
  const text = await response.text();
  assert.doesNotMatch(text, /SQLITE|secret/);
  assert.deepEqual(JSON.parse(text), { error: "Something went wrong. Please try again.", errorBn: "কিছু একটা ভুল হয়েছে। আবার চেষ্টা করুন।" });
  assert.equal(logged.mock.callCount(), 1);
  assert.match(String(logged.mock.calls[0].arguments[1]), /SQLITE_CORRUPT/);
});

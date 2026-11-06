import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const dir = mkdtempSync(path.join(os.tmpdir(), "bangla-student-routes-test-"));
process.env.DATABASE_PATH = path.join(dir, "test.db");
const { studentServerError } = await import("../lib/student-errors.ts");
const { resetRateLimits } = await import("../lib/rate-limit.ts");
after(() => rmSync(dir, { recursive: true, force: true }));

test("student routes answer a database failure with a fixed message in the student voice and log the detail", async (t) => {
  const logged = [];
  t.mock.method(console, "error", (...args) => logged.push(args));
  // better-sqlite3 messages such as this one carry no SQLITE code, and used to reach the browser.
  const failure = studentServerError("GET /api/student/feed", new Error("no such column: activities.secret_answer"));
  assert.equal(failure.status, 500);
  const body = await failure.json();
  assert.deepEqual(body, { error: "Your class information is not available right now. Try again in a moment.", errorBn: "তোমার ক্লাসের তথ্য এখন পাওয়া যাচ্ছে না। একটু পরে আবার চেষ্টা করো।" });
  assert.ok(!JSON.stringify(body).includes("secret_answer"), "no database detail reaches the browser");
  assert.equal(logged[0][0], "GET /api/student/feed:");
  assert.match(String(logged[0][1].message), /no such column/, "but it is logged");

  assert.deepEqual(await studentServerError("POST /api/student/submit", new Error("SQLITE_BUSY: database is locked"), "submit").json(), { error: "Your answers could not be saved right now. Try again in a moment.", errorBn: "তোমার উত্তর এখন সংরক্ষণ করা যায়নি। একটু পরে আবার চেষ্টা করো।" });
  assert.deepEqual(await studentServerError("GET /api/student/results", new Error("no such table: class_students")).json(), { error: "The student service is still being set up. Please try again later.", errorBn: "শিক্ষার্থী সেবাটি এখনো চালু করা হচ্ছে। পরে আবার চেষ্টা করো।" });
  assert.equal((await studentServerError("GET /api/student/results", "not an error").json()).errorBn, "তোমার ক্লাসের তথ্য এখন পাওয়া যাচ্ছে না। একটু পরে আবার চেষ্টা করো।");
});

test("the student routes no longer build their 500 answer from the error message", async () => {
  const { readFileSync } = await import("node:fs");
  for (const route of ["feed", "results", "submit"]) {
    const source = readFileSync(new URL(`../app/api/student/${route}/route.ts`, import.meta.url), "utf8");
    assert.match(source, /studentServerError\(/, route);
    assert.doesNotMatch(source, /: message \}/, `${route} must not answer with the raw message`);
  }
});

test("both sign-out routes clear the cookies even when the session store fails", async (t) => {
  t.mock.method(console, "error", () => {});
  // Outside a request, reading the cookies throws, as a database fault in destroyBrowserSessions would.
  for (const [route, returnTo, expected] of [["../app/api/student/sign-out/route.ts", "/student", "/student"], ["../app/api/auth/sign-out/route.ts", "/grown-ups", "/grown-ups"]]) {
    const { GET } = await import(route);
    const response = await GET(new Request(`http://localhost/api/sign-out?returnTo=${encodeURIComponent(returnTo)}`));
    assert.equal(response.status, 303, route);
    assert.equal(response.headers.get("location"), expected, route);
    const cleared = response.headers.getSetCookie();
    for (const name of ["ba_adult_session", "ba_student_session"]) assert.ok(cleared.some((cookie) => cookie.startsWith(`${name}=;`) && /Max-Age=0/i.test(cookie)), `${route} clears ${name}`);
  }
});

test("wrong recovery codes for one account are limited across addresses", async () => {
  const { POST } = await import("../app/api/auth/recover/route.ts");
  resetRateLimits();
  const attempt = (address, email = "pa@example.com") => POST(new Request("http://localhost/api/auth/recover", {
    method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": address },
    body: JSON.stringify({ email, recoveryCode: "WRONG-CODE", newPassword: "a-new-password-1" }),
  }));
  // One try from each of ten addresses: none reaches the per-address limit of 5.
  for (let i = 0; i < 10; i++) assert.equal((await attempt(`192.0.2.${i}`)).status, 401, `attempt ${i + 1}`);
  const refused = await attempt("192.0.2.99");
  assert.equal(refused.status, 429, "the eleventh wrong code for the account is refused from a new address");
  const body = await refused.json();
  assert.match(body.error, /^Too many attempts\. Please wait \d+ minutes? and try again\.$/);
  assert.match(body.errorBn, /চেষ্টা করুন।$/, "adults are asked politely");
  // The email is compared without letter case, and another account is not affected.
  assert.equal((await attempt("192.0.2.100", "PA@Example.com")).status, 429);
  assert.equal((await attempt("192.0.2.101", "other@example.com")).status, 401);
});

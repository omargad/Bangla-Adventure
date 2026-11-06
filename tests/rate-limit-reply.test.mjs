import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const dir = mkdtempSync(path.join(os.tmpdir(), "bangla-rate-reply-test-"));
process.env.DATABASE_PATH = path.join(dir, "test.db");
const { SIGN_UPS_PER_HOUR, tooManyAttempts, waitDuration, waitMessage } = await import("../lib/rate-limit-reply.ts");
const { resetRateLimits } = await import("../lib/rate-limit.ts");
after(() => rmSync(dir, { recursive: true, force: true }));

test("the wait is rounded up to whole seconds, minutes or hours, in both languages", () => {
  assert.deepEqual(waitDuration(1), { en: "1 second", bn: "১ সেকেন্ড" });
  assert.deepEqual(waitDuration(44.2), { en: "45 seconds", bn: "৪৫ সেকেন্ড" });
  assert.deepEqual(waitDuration(60), { en: "1 minute", bn: "১ মিনিট" });
  assert.deepEqual(waitDuration(14 * 60 + 1), { en: "15 minutes", bn: "১৫ মিনিট" });
  assert.deepEqual(waitDuration(3600), { en: "1 hour", bn: "১ ঘণ্টা" });
  assert.deepEqual(waitDuration(23 * 3600 + 5), { en: "24 hours", bn: "২৪ ঘণ্টা" });
  assert.deepEqual(waitDuration(0), { en: "1 second", bn: "১ সেকেন্ড" });
});

test("adults are asked politely and students informally, and both are told how long to wait", () => {
  assert.deepEqual(waitMessage(900), { error: "Too many attempts. Please wait 15 minutes and try again.", errorBn: "অনেকবার চেষ্টা করা হয়েছে। ১৫ মিনিট অপেক্ষা করে আবার চেষ্টা করুন।" });
  assert.equal(waitMessage(900, "student").errorBn, "অনেকবার চেষ্টা করা হয়েছে। ১৫ মিনিট অপেক্ষা করে আবার চেষ্টা করো।");
});

test("the 429 carries the wait in the message, the body and the Retry-After header", async () => {
  const response = tooManyAttempts(125.4);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "126");
  const body = await response.json();
  assert.equal(body.retryAfterSeconds, 126);
  assert.match(body.error, /wait 3 minutes/);
  assert.match(body.errorBn, /৩ মিনিট/);
});

const signUp = (route, address) => route.POST(new Request("http://localhost/api/sign-up", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": address }, body: "{}" }));

test("a school sign-up session on one connection can make 30 accounts an hour, adults and students alike", async () => {
  assert.equal(SIGN_UPS_PER_HOUR, 30);
  for (const route of [await import("../app/api/auth/sign-up/route.ts"), await import("../app/api/student/sign-up/route.ts")]) {
    resetRateLimits();
    // Attempts are counted before the details are checked, so empty forms use the allowance too.
    for (let i = 0; i < 30; i++) assert.equal((await signUp(route, "school-wifi")).status, 400, `attempt ${i + 1}`);
    const refused = await signUp(route, "school-wifi");
    assert.equal(refused.status, 429);
    const body = await refused.json();
    assert.match(body.error, /^Too many attempts\. Please wait (60 minutes|1 hour) and try again\.$/);
    assert.ok(body.errorBn.includes("অপেক্ষা করে"));
    assert.equal((await signUp(route, "another-connection")).status, 400, "another connection is not affected");
  }
});

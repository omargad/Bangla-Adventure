import assert from "node:assert/strict";
import test from "node:test";

const { checkRateLimit, clearRateLimit, peekRateLimit, recordRateLimit, resetRateLimits, clientKey, tooManyRequests } = await import("../lib/rate-limit.ts");

test("allows up to the limit inside a window, then blocks", () => {
  resetRateLimits();
  const start = 1_000_000;
  for (let i = 0; i < 5; i += 1) {
    assert.equal(checkRateLimit("k", 5, 60_000, start + i).allowed, true, `attempt ${i + 1}`);
  }
  const blocked = checkRateLimit("k", 5, 60_000, start + 10);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1);
});

test("window expiry resets the counter", () => {
  resetRateLimits();
  const start = 2_000_000;
  for (let i = 0; i < 5; i += 1) checkRateLimit("k2", 5, 60_000, start);
  assert.equal(checkRateLimit("k2", 5, 60_000, start).allowed, false);
  assert.equal(checkRateLimit("k2", 5, 60_000, start + 60_001).allowed, true);
});

test("keys are independent", () => {
  resetRateLimits();
  const start = 3_000_000;
  for (let i = 0; i < 5; i += 1) checkRateLimit("a", 5, 60_000, start);
  assert.equal(checkRateLimit("a", 5, 60_000, start).allowed, false);
  assert.equal(checkRateLimit("b", 5, 60_000, start).allowed, true);
});

test("peeking counts nothing; only recorded attempts use up the limit", () => {
  resetRateLimits();
  const start = 4_000_000;
  for (let i = 0; i < 50; i += 1) assert.equal(peekRateLimit("guess", 3, start + i).allowed, true, "successful sign-ins only peek");
  for (let i = 0; i < 3; i += 1) {
    assert.equal(peekRateLimit("guess", 3, start + 100).allowed, true, `failure ${i + 1}`);
    recordRateLimit("guess", 60_000, start + 100);
  }
  const blocked = peekRateLimit("guess", 3, start + 200);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 60);
  assert.equal(peekRateLimit("guess", 3, start + 60_100).allowed, true, "the window starts at the first failure");
  recordRateLimit("guess", 60_000, start + 60_100);
  assert.equal(peekRateLimit("guess", 3, start + 60_100).allowed, true, "and a new one starts after it ends");
});

test("checkRateLimit shares counts with recorded attempts", () => {
  resetRateLimits();
  const start = 5_000_000;
  recordRateLimit("shared", 60_000, start);
  recordRateLimit("shared", 60_000, start);
  assert.equal(checkRateLimit("shared", 3, 60_000, start).allowed, true);
  assert.equal(checkRateLimit("shared", 3, 60_000, start).allowed, false);
  assert.equal(peekRateLimit("shared", 3, start).allowed, false);
});

test("clearing a window forgets its attempts and leaves other keys alone", () => {
  resetRateLimits();
  const start = 4_000_000;
  for (let i = 0; i < 3; i += 1) {
    recordRateLimit("here", 60_000, start);
    recordRateLimit("overall", 60_000, start);
  }
  clearRateLimit("here");
  assert.equal(peekRateLimit("here", 3, start).allowed, true);
  assert.equal(peekRateLimit("overall", 3, start).allowed, false);
});

test("clientKey prefers first x-forwarded-for hop", () => {
  const withHeader = new Request("http://localhost/", {
    headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
  });
  assert.equal(clientKey(withHeader), "203.0.113.9");
  assert.equal(clientKey(new Request("http://localhost/")), "local");
});

test("the 429 answer says when to retry, in English and Bangla", async () => {
  const response = tooManyRequests(42);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "42");
  const body = await response.json();
  assert.equal(body.error, "Too many attempts. Please wait a moment and try again.");
  assert.match(body.errorBn, /[ঀ-৿]/);
});

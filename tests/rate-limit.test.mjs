import assert from "node:assert/strict";
import test from "node:test";

const { checkRateLimit, clearRateLimit, peekRateLimit, recordRateLimit, resetRateLimits, clientKey, tooManyRequests, trustedProxyHops } = await import("../lib/rate-limit.ts");

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

test("clientKey uses the address the nearest proxy added, not one the client sent", () => {
  const forwarded = (value) => new Request("http://localhost/", { headers: { "x-forwarded-for": value } });
  // A client sends its own X-Forwarded-For; a proxy that appends adds the real address on the right.
  assert.equal(clientKey(forwarded("203.0.113.9, 10.0.0.1")), "10.0.0.1");
  assert.equal(clientKey(forwarded("spoofed-1, 198.51.100.4")), "198.51.100.4");
  assert.equal(clientKey(forwarded("spoofed-2, 198.51.100.4")), "198.51.100.4", "changing the sent value does not give a new key");
  // The shipped Nginx file replaces the header with one address.
  assert.equal(clientKey(forwarded("198.51.100.4")), "198.51.100.4");
  assert.equal(clientKey(new Request("http://localhost/")), "local");
  // Behind two proxies (a CDN, then Nginx), the CDN's entry is the client.
  assert.equal(clientKey(forwarded("spoofed, 198.51.100.4, 192.0.2.7"), 2), "198.51.100.4");
  assert.equal(clientKey(forwarded("198.51.100.4"), 2), "198.51.100.4");
});

test("TRUSTED_PROXY_HOPS is a small whole number, 1 when unset or invalid", () => {
  assert.equal(trustedProxyHops(undefined), 1);
  assert.equal(trustedProxyHops(""), 1);
  assert.equal(trustedProxyHops("2"), 2);
  for (const bad of ["0", "-1", "1.5", "eleven", "99"]) assert.equal(trustedProxyHops(bad), 1, bad);
});

test("checkRateLimit also says when the window ends", () => {
  resetRateLimits();
  const start = 6_000_000;
  assert.deepEqual(checkRateLimit("reset", 2, 60_000, start), { allowed: true, retryAfterSeconds: 0, resetAt: start + 60_000 });
  assert.equal(checkRateLimit("reset", 2, 60_000, start + 5).resetAt, start + 60_000, "the window starts at the first attempt");
  assert.deepEqual(checkRateLimit("reset", 2, 60_000, start + 1_000), { allowed: false, retryAfterSeconds: 59, resetAt: start + 60_000 });
  assert.equal(peekRateLimit("untouched", 2, start).resetAt, start);
});

test("the 429 answer says when to retry, in English and Bangla", async () => {
  const response = tooManyRequests(42);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "42");
  const body = await response.json();
  assert.equal(body.error, "Too many attempts. Please wait a moment and try again.");
  assert.match(body.errorBn, /[ঀ-৿]/);
});

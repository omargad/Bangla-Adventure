import assert from "node:assert/strict";
import test from "node:test";

const {
  hashPassword,
  verifyPassword,
  createSessionToken,
  hashSessionToken,
  generateRecoveryCode,
  normalizeRecoveryCode,
  generateTemporaryPassword,
  hashPasswordAsync,
} = await import("../lib/password.ts");

test("hashed passwords verify and reject wrong input", () => {
  const hash = hashPassword("correct horse battery staple");
  assert.notEqual(hash, "correct horse battery staple");
  assert.ok(hash.startsWith("scrypt:"));
  assert.ok(verifyPassword("correct horse battery staple", hash));
  assert.ok(!verifyPassword("wrong password", hash));
});

test("same password hashes differently per salt", () => {
  const first = hashPassword("shared-password-123");
  const second = hashPassword("shared-password-123");
  assert.notEqual(first, second);
  assert.ok(verifyPassword("shared-password-123", first));
  assert.ok(verifyPassword("shared-password-123", second));
});

test("malformed stored hashes are rejected, not thrown", () => {
  assert.ok(!verifyPassword("anything", "not-a-hash"));
  assert.ok(!verifyPassword("anything", "scrypt:bad:parts"));
  assert.ok(!verifyPassword("anything", ""));
});

test("recovery codes use the safe alphabet and normalize consistently", () => {
  const codes = new Set();
  for (let i = 0; i < 50; i += 1) {
    const code = generateRecoveryCode();
    assert.match(code, /^[A-HJ-KM-NP-Z2-9]{5}-[A-HJ-KM-NP-Z2-9]{5}$/, code);
    codes.add(code);
  }
  assert.equal(codes.size, 50, "codes are unique");
  assert.equal(normalizeRecoveryCode(" abcde-23456 "), "ABCDE23456");
  assert.equal(normalizeRecoveryCode("ABCDE23456"), normalizeRecoveryCode("abcde-234-56"));
});

test("session tokens are unique and hash deterministically", () => {
  const a = createSessionToken();
  const b = createSessionToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 40);
  assert.equal(hashSessionToken(a), hashSessionToken(a));
  assert.notEqual(hashSessionToken(a), hashSessionToken(b));
});

test("temporary passwords are readable aloud, unambiguous and meet the student policy", () => {
  const seen = new Set();
  const counts = new Map();
  for (let i = 0; i < 2000; i += 1) {
    const password = generateTemporaryPassword();
    assert.match(password, /^[a-hj-kmnp-z2-9]{4}-[a-hj-kmnp-z2-9]{4}-[a-hj-kmnp-z2-9]{2}$/, password);
    assert.doesNotMatch(password, /[ilo01]/, "no look-alike characters");
    assert.ok(password.length >= 8 && password.replaceAll("-", "").length >= 10, "at least 10 random characters");
    seen.add(password);
    for (const char of password.replaceAll("-", "")) counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  assert.equal(seen.size, 2000, "no repeats");
  // 20,000 draws over 31 symbols: every symbol appears, none wildly over- or under-represented.
  assert.equal(counts.size, 31);
  for (const [char, count] of counts) assert.ok(count > 400 && count < 900, `${char} appeared ${count} times`);
});

test("async hashing matches the synchronous format and verifies", async () => {
  const hash = await hashPasswordAsync("kp7m-x3qa-9t");
  assert.match(hash, /^scrypt:16384:[0-9a-f]{32}:[0-9a-f]{128}$/);
  assert.ok(verifyPassword("kp7m-x3qa-9t", hash));
  assert.ok(!verifyPassword("kp7m-x3qa-9u", hash));
});

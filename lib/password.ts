import { createHash, randomBytes, randomInt, scrypt, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Password hashing and session-token helpers with no framework dependencies,
 * so they can be unit-tested directly under `node --test`.
 */

const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 };

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS).toString("hex");
  return `scrypt:${SCRYPT_OPTIONS.N}:${salt}:${derived}`;
}

/** Same format as hashPassword, computed on the libuv thread pool so bulk hashing does not block requests. */
export function hashPasswordAsync(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS, (error, derived) => {
      if (error) reject(error);
      else resolve(`scrypt:${SCRYPT_OPTIONS.N}:${salt}:${derived.toString("hex")}`);
    });
  });
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;
  const cost = Number(parts[1]);
  if (!Number.isInteger(cost) || cost < 2) return false;
  const [, , salt, expectedHex] = parts;
  const expected = Buffer.from(expectedHex, "hex");
  const derived = scryptSync(password, salt, expected.length, { ...SCRYPT_OPTIONS, N: cost });
  return expected.length > 0 && timingSafeEqual(derived, expected);
}

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

// No I, L, O, 0 or 1 — codes get read out loud and typed by hand.
const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateRecoveryCode(): string {
  const bytes = randomBytes(10);
  let code = "";
  for (let i = 0; i < 10; i += 1) {
    if (i === 5) code += "-";
    code += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
  }
  return code;
}

// Lowercase letters and digits without look-alikes (no i, l, o, 0 or 1): teachers
// read temporary passwords aloud and children type them.
const TEMPORARY_PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const TEMPORARY_PASSWORD_GROUPS = [4, 4, 2];

/** A one-time student password such as `kp7m-x3qa-9t`: 10 random characters (about 49 bits). */
export function generateTemporaryPassword(): string {
  return TEMPORARY_PASSWORD_GROUPS
    .map((size) => Array.from({ length: size }, () => TEMPORARY_PASSWORD_ALPHABET[randomInt(TEMPORARY_PASSWORD_ALPHABET.length)]).join(""))
    .join("-");
}

/** Uppercase and strip separators so hand-typed codes match regardless of format. */
export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z2-9]/g, "");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

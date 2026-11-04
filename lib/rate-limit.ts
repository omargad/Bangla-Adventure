/**
 * Fixed-window in-memory rate limiter for auth and account endpoints.
 * Suitable for the single-instance deployment this platform targets; when the
 * app scales to multiple instances, enforce limits at the reverse proxy or a
 * shared store instead.
 */

type Bucket = { count: number; resetAt: number };

const store = new Map<string, Bucket>();
const MAX_TRACKED_KEYS = 10_000;

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

/** Count this attempt against the key, unless the key has already used up its limit. */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  const result = peekRateLimit(key, limit, now);
  if (result.allowed) recordRateLimit(key, windowMs, now);
  return result;
}

/** Whether the key has used up its limit, without counting anything. Pair with recordRateLimit to count only failures. */
export function peekRateLimit(key: string, limit: number, now: number = Date.now()): RateLimitResult {
  const bucket = store.get(key);
  if (!bucket || now >= bucket.resetAt || bucket.count < limit) return { allowed: true, retryAfterSeconds: 0 };
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
}

/** Count one attempt against the key; the window starts with its first attempt. */
export function recordRateLimit(key: string, windowMs: number, now: number = Date.now()): void {
  if (store.size > MAX_TRACKED_KEYS) {
    for (const [existingKey, bucket] of store) {
      if (now >= bucket.resetAt) store.delete(existingKey);
    }
  }

  const bucket = store.get(key);
  if (!bucket || now >= bucket.resetAt) store.set(key, { count: 1, resetAt: now + windowMs });
  else bucket.count += 1;
}

/** Best-effort client identifier: first hop of x-forwarded-for, else a shared key. */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || "local";
}

export function tooManyRequests(retryAfterSeconds: number): Response {
  return Response.json(
    { error: "Too many attempts. Please wait a moment and try again.", errorBn: "অনেকবার চেষ্টা করা হয়েছে। একটু অপেক্ষা করে আবার চেষ্টা করুন।" },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

/** Test hook: clear all tracked windows. */
export function resetRateLimits(): void {
  store.clear();
}

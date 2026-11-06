/**
 * Fixed-window in-memory rate limiter for auth and account endpoints.
 * Suitable for the single-instance deployment this platform targets; when the
 * app scales to multiple instances, enforce limits at the reverse proxy or a
 * shared store instead.
 */

import { tooManyAttempts, type Voice } from "./rate-limit-reply";

type Bucket = { count: number; resetAt: number };

const store = new Map<string, Bucket>();
const MAX_TRACKED_KEYS = 10_000;

/** resetAt is when the key's current window ends (ms since the epoch), or `now` when it has none. */
export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number; resetAt: number };

/** Count this attempt against the key, unless the key has already used up its limit. */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  const result = peekRateLimit(key, limit, now);
  if (!result.allowed) return result;
  recordRateLimit(key, windowMs, now);
  return { ...result, resetAt: store.get(key)?.resetAt ?? now + windowMs };
}

/** Whether the key has used up its limit, without counting anything. Pair with recordRateLimit to count only failures. */
export function peekRateLimit(key: string, limit: number, now: number = Date.now()): RateLimitResult {
  const bucket = store.get(key);
  if (!bucket || now >= bucket.resetAt) return { allowed: true, retryAfterSeconds: 0, resetAt: now };
  if (bucket.count < limit) return { allowed: true, retryAfterSeconds: 0, resetAt: bucket.resetAt };
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)), resetAt: bucket.resetAt };
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

/** Forgets a window, for example an address's wrong passwords once the right one is given. */
export function clearRateLimit(key: string): void {
  store.delete(key);
}

/**
 * How many proxies in front of the app append to X-Forwarded-For (TRUSTED_PROXY_HOPS). Each proxy appends
 * the address it received the request from, so only the right-most values can be trusted: everything to
 * their left was sent by the client and can be anything. 1 by default (the shipped Nginx site); 2 on
 * Render, whose proxy appends its own address after the client's (the RENDER variable it sets).
 */
export function trustedProxyHops(value: string | undefined = process.env.TRUSTED_PROXY_HOPS, platformDefault: number = process.env.RENDER ? 2 : 1): number {
  const hops = Number(value?.trim() || String(platformDefault));
  return Number.isSafeInteger(hops) && hops >= 1 && hops <= 10 ? hops : 1;
}

/**
 * A header that carries the client's address, set by the platform's own edge proxy (which replaces any
 * value the client sent): CLIENT_IP_HEADER when set ("none" turns it off), else the platform's own header
 * where the platform says so in its environment: X-Real-IP on Railway, Fly-Client-IP on Fly.io.
 * Elsewhere (Nginx, Caddy, Compose, Render) there is none and X-Forwarded-For is read instead.
 */
export function clientIpHeader(env: Record<string, string | undefined> = process.env): string | null {
  const named = env.CLIENT_IP_HEADER?.trim().toLowerCase();
  if (named) return named === "none" || !/^[a-z0-9-]+$/.test(named) ? null : named;
  if (env.RAILWAY_ENVIRONMENT || env.RAILWAY_PROJECT_ID) return "x-real-ip";
  if (env.FLY_APP_NAME) return "fly-client-ip";
  return null;
}

/**
 * Best-effort client identifier: the platform's client-address header when it has one (clientIpHeader),
 * else the X-Forwarded-For value the outermost trusted proxy added (with one proxy, the right-most value),
 * else a shared key. A value the client sent itself cannot change it, provided the app port is reachable
 * only through that proxy.
 */
export function clientKey(request: Request, hops: number = trustedProxyHops(), header: string | null = clientIpHeader()): string {
  const fromPlatform = header ? request.headers.get(header)?.split(",").map((value) => value.trim()).filter(Boolean).at(-1) : undefined;
  if (fromPlatform) return fromPlatform;
  const values = (request.headers.get("x-forwarded-for") ?? "").split(",").map((value) => value.trim());
  const chosen = values.length >= hops ? values[values.length - hops] : values[0];
  return chosen || "local";
}

/**
 * 429 for a limited route, saying how long to wait (lib/rate-limit-reply): adults are addressed politely,
 * students (voice "student") informally.
 */
export function tooManyRequests(retryAfterSeconds: number, voice: Voice = "adult"): Response {
  return tooManyAttempts(retryAfterSeconds, voice);
}

/** Test hook: clear all tracked windows. */
export function resetRateLimits(): void {
  store.clear();
}

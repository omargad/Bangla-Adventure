/**
 * The site's public address from PUBLIC_ORIGIN, reduced to scheme://host[:port] (so a trailing slash, a path,
 * capitals or a default port do not matter). An empty value means none is set; anything else that is not an
 * http:// or https:// address is ignored with one error in the log.
 */
export function publicOrigin(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  try {
    const { protocol, origin } = new URL(trimmed);
    if (protocol === "https:" || protocol === "http:") return origin;
  } catch {
    // Not an address at all: reported below.
  }
  console.error(`PUBLIC_ORIGIN is ignored: expected scheme://host[:port], such as https://learn.example.org, but got "${trimmed}".`);
  return undefined;
}

/** scheme://host[:port] of an http(s) address, or null. */
function originOf(protocol: string, host: string): string | null {
  try {
    const url = new URL(`${protocol}//${host}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch { return null; }
}

/**
 * The addresses a request may have come from when PUBLIC_ORIGIN is not set: the one in its Host header and,
 * behind a proxy that rewrote Host, the one in X-Forwarded-Host (with X-Forwarded-Proto when given).
 */
export function requestOrigins(request: Request, url: URL = new URL(request.url)): string[] {
  const first = (name: string) => request.headers.get(name)?.split(",")[0]?.trim() || "";
  const forwardedProto = first("x-forwarded-proto").toLowerCase();
  const protocol = forwardedProto === "https" || forwardedProto === "http" ? `${forwardedProto}:` : url.protocol;
  const origins = [originOf(url.protocol, request.headers.get("host") ?? url.host), originOf(protocol, request.headers.get("host") ?? url.host)];
  const forwardedHost = first("x-forwarded-host");
  if (forwardedHost) origins.push(originOf(protocol, forwardedHost));
  return [...new Set(origins.filter((origin): origin is string => origin !== null))];
}

/** The Bangla for each refusal validateMutation gives. */
export const MUTATION_ERRORS_BN: Readonly<Record<string, string>> = {
  "Cross-site requests are not allowed.": "অন্য সাইট থেকে এই অনুরোধ করা যায় না।",
  "The request origin could not be verified.": "অনুরোধটি কোথা থেকে এসেছে তা যাচাই করা যায়নি।",
  "Send JSON or a same-origin upload.": "JSON বা এই সাইট থেকেই আপলোড পাঠান।",
};

/**
 * Rejects cross-site mutations and sign-outs. Browsers send Sec-Fetch-Site themselves (pages cannot set it),
 * so only "same-origin" and "none" (typed or bookmarked) pass. A sent Origin must also be one of the expected
 * origins (PUBLIC_ORIGIN when it is set, otherwise requestOrigins): a client that claims same-origin but names
 * another Origin is refused. Browsers without Sec-Fetch-Site are checked on Origin alone.
 */
export function validateMutation(request: Request, expectedOrigin: string | readonly string[]): string | null {
  const mutation = !["GET", "HEAD", "OPTIONS"].includes(request.method);
  const logout = new URL(request.url).pathname.endsWith("/sign-out");
  if (!mutation && !logout) return null;
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return "Cross-site requests are not allowed.";
  const origin = request.headers.get("origin");
  const expected: readonly string[] = typeof expectedOrigin === "string" ? [expectedOrigin] : expectedOrigin;
  const sameOrigin = origin !== null && expected.includes(origin);
  if (origin && !sameOrigin) return "The request origin could not be verified.";
  if (["POST", "PUT", "PATCH"].includes(request.method)) {
    const type = mediaType(request.headers.get("content-type"));
    if (type !== "application/json" && !(type === "multipart/form-data" && origin && sameOrigin)) {
      return "Send JSON or a same-origin upload.";
    }
  }
  return null;
}

/** The media type of a Content-Type header, lower case and without parameters. */
export function mediaType(contentType: string | null | undefined): string {
  return contentType?.split(";")[0].trim().toLowerCase() ?? "";
}

/**
 * The largest JSON body any route reads: a topic (readTopicBody in lib/curriculum-catalog.ts) may be
 * 400,000 characters, at most 3 bytes each in UTF-8. proxy.ts refuses anything larger unread.
 */
export const MAX_JSON_BODY_BYTES = 400_000 * 3;

export const INVALID_JSON = { error: "Send a valid JSON object with the required fields.", errorBn: "প্রয়োজনীয় তথ্যসহ একটি সঠিক JSON অবজেক্ট পাঠান।" };
export const BODY_TOO_LARGE = { error: "This request is too large.", errorBn: "অনুরোধটি খুব বড়।" };

/**
 * The body as text, or null once it passes `limit` bytes (the rest is not read). Content-Length is
 * checked first, and the count is kept while reading, so a missing or wrong length does not matter.
 */
export async function readBodyWithin(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (!Number.isFinite(declared) || declared > limit) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        void reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

/** A route's JSON object body, or a 400 answer in both languages for anything else (another body type included). */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | Response> {
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch { /* answered below */ }
  return Response.json(INVALID_JSON, { status: 400 });
}

/** A route's multipart form, or a 400 answer in both languages when the body is not one. */
export async function readFormData(request: Request): Promise<FormData | Response> {
  try { return await request.formData(); }
  catch { return Response.json({ error: "Send the upload as a form with the file attached.", errorBn: "ফাইলটি সংযুক্ত করে ফর্ম হিসেবে আপলোড পাঠান।" }, { status: 400 }); }
}

/**
 * The answer to an unexpected server failure: the detail goes to the server log only, and the caller gets a
 * fixed message in both languages (raw database or parser messages never reach the browser).
 */
export function serverError(context: string, error: unknown, message = { error: "Something went wrong. Please try again.", errorBn: "কিছু একটা ভুল হয়েছে। আবার চেষ্টা করুন।" }): Response {
  console.error(`${context}:`, error);
  return Response.json(message, { status: 500 });
}

/**
 * True when a production sign-in comes from a plain http:// page on another computer. Session cookies are Secure,
 * so that browser would drop them and the sign-in would silently fail; answer with INSECURE_SIGN_IN instead.
 */
export function insecureSignIn(request: Request): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  const origin = request.headers.get("origin");
  if (!origin?.startsWith("http:")) return false;
  try {
    return !["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export const INSECURE_SIGN_IN = { error: "Signing in needs a secure https:// address.", errorBn: "সাইন ইন করতে নিরাপদ https:// ঠিকানা প্রয়োজন।" };

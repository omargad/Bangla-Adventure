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

/**
 * Rejects cross-site mutations and sign-outs. Browsers send Sec-Fetch-Site themselves (pages cannot set it),
 * so only "same-origin" and "none" (typed or bookmarked) pass. With PUBLIC_ORIGIN configured, Origin must equal it.
 * Without it, expectedOrigin comes from the request's Host and X-Forwarded-Proto, which a proxy may change, so the
 * browser's own same-origin answer also counts; browsers without Sec-Fetch-Site are checked on Origin alone.
 */
export function validateMutation(request: Request, expectedOrigin: string, { configured = false } = {}): string | null {
  const mutation = !["GET", "HEAD", "OPTIONS"].includes(request.method);
  const logout = new URL(request.url).pathname.endsWith("/sign-out");
  if (!mutation && !logout) return null;
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return "Cross-site requests are not allowed.";
  const origin = request.headers.get("origin");
  const sameOrigin = origin === expectedOrigin || (!configured && site === "same-origin");
  if (origin && !sameOrigin) return "The request origin could not be verified.";
  if (["POST", "PUT", "PATCH"].includes(request.method)) {
    const type = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (type !== "application/json" && !(type === "multipart/form-data" && origin && sameOrigin)) {
      return "Send JSON or a same-origin upload.";
    }
  }
  return null;
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

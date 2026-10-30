import { safeReturnPath } from "./safe-redirect";

const PUBLIC_PATHS = new Set([
  "/welcome", "/grown-ups", "/student", "/safety", "/sw.js", "/manifest.webmanifest", "/robots.txt", "/hero-quest-map.webp",
  "/favicon.svg", "/favicon.ico", "/apple-touch-icon.png", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png",
  "/api/health", "/api/lms-retired", "/api/auth/sign-in", "/api/auth/sign-up", "/api/auth/recover", "/api/auth/sign-out",
  "/api/student/sign-in", "/api/student/sign-up", "/api/student/sign-out", "/api/student/session", "/api/auth/session",
]);

export function isPublicPath(url: URL): boolean {
  const pathname = url.pathname.replace(/\/$/, "") || "/";
  return PUBLIC_PATHS.has(pathname)
    || /^\/_next\/static\/css\/[^/]+\.css$/.test(pathname)
    || /^\/_next\/static\/media\/[^/]+\.(woff2?|ttf|otf)$/.test(pathname);
}

/**
 * Cache-Control for a response the proxy lets through. Hashed build files keep for a year, in shared caches
 * only when anyone may load them; public files in public/ keep for a day; the service worker is checked on
 * every load; pages, API data and gated files are never stored.
 */
export function cacheControl(pathname: string, access: "public" | "signed-in"): string {
  if (pathname.startsWith("/_next/")) {
    // Development builds reuse the same file names, so only production build files are kept.
    if (!pathname.startsWith("/_next/static/") || process.env.NODE_ENV !== "production") return "private, no-store";
    return `${access === "public" ? "public" : "private"}, max-age=31536000, immutable`;
  }
  if (access === "public" && pathname === "/sw.js") return "no-cache";
  if (access === "public" && /\.[a-z0-9]+$/i.test(pathname)) return "public, max-age=86400";
  return "private, no-store";
}

export function learningReturnPath(value?: string | null): string {
  const path = safeReturnPath(value);
  const pathname = new URL(path, "https://learning.internal").pathname;
  if (["/welcome", "/grown-ups", "/student"].includes(pathname) || pathname.startsWith("/api/") || pathname.startsWith("/_next/")) return "/";
  return path;
}

export function loginDestination(path: string): string {
  const pathname = new URL(safeReturnPath(path), "https://learning.internal").pathname;
  const adult = ["/teach", "/admin", "/family", "/studio", "/account"].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return `${adult ? "/grown-ups" : "/welcome"}?returnTo=${encodeURIComponent(learningReturnPath(path))}`;
}

/** Where an adult chooses their own password while an administrator-issued one is still in use. */
export const ADULT_PASSWORD_PATH = "/account/password";
export const PASSWORD_CHANGE_ERROR = "Choose your own password before you continue.";
export const PASSWORD_CHANGE_ERROR_BN = "চালিয়ে যাওয়ার আগে নিজের পাসওয়ার্ড বেছে নিন।";

/**
 * While an administrator-issued password is in use, only the change form and its API stay open to
 * that adult. Sign-out, recovery and the session check are public paths and stay open as well.
 */
export function allowedDuringPasswordChange(pathname: string): boolean {
  const path = pathname.replace(/\/$/, "") || "/";
  return path === ADULT_PASSWORD_PATH || path === "/api/account/password";
}

/** Where the change form returns to: a safe page, never the form itself, an API or a sign-in page. */
export function passwordChangeReturnPath(value?: string | null): string {
  const path = learningReturnPath(value);
  return new URL(path, "https://learning.internal").pathname.replace(/\/$/, "") === ADULT_PASSWORD_PATH ? "/" : path;
}

export function passwordChangeDestination(returnTo: string): string {
  return `${ADULT_PASSWORD_PATH}?returnTo=${encodeURIComponent(passwordChangeReturnPath(returnTo))}`;
}

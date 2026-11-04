import { NextRequest, NextResponse } from "next/server";
import { publicOrigin, validateMutation } from "./lib/request-security";
import { allowedDuringPasswordChange, cacheControl, isPublicPath, loginDestination, PASSWORD_CHANGE_ERROR, passwordChangeDestination } from "./lib/learning-policy";
import { learningSession } from "./lib/learning-session";
import { isPublicScript } from "./lib/public-assets";
import { chosenLanguage, LANGUAGE_COOKIE, LANGUAGE_COOKIE_MAX_AGE } from "./lib/language-choice";

function headed(response: NextResponse, cache = "private, no-store") {
  response.headers.set("Cache-Control", cache);
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

/**
 * Each page load renews the reader's English/Bangla choice from the server. The page writes the cookie when the choice changes,
 * and Safari keeps a cookie written that way for 7 days at most; one the server sets lasts its full year.
 */
function renewLanguage(request: NextRequest, response: NextResponse, origin: string) {
  const language = chosenLanguage(request.cookies.get(LANGUAGE_COOKIE)?.value);
  const page = request.method === "GET"
    && (request.headers.get("sec-fetch-dest") === "document" || (request.headers.get("accept") ?? "").includes("text/html"));
  // Never on a response a shared cache may keep (public files), only on private pages.
  if (language && page && response.headers.get("Cache-Control")?.startsWith("private")) response.cookies.set(LANGUAGE_COOKIE, language, { path: "/", maxAge: LANGUAGE_COOKIE_MAX_AGE, sameSite: "lax", secure: origin.startsWith("https:") });
  return response;
}

// Optional. Without it each request's own address (Host and X-Forwarded-Proto) is used for the origin check.
const configuredOrigin = publicOrigin(process.env.PUBLIC_ORIGIN);

// Built from the request so Next answers with a root-relative Location, whatever Host or protocol a proxy passed on.
const redirect = (request: NextRequest, path: string) => NextResponse.redirect(new URL(path, request.nextUrl), 307);

export async function proxy(request: NextRequest) {
  const origin = configuredOrigin ?? `${request.nextUrl.protocol}//${request.headers.get("host") ?? request.nextUrl.host}`;
  const withHeaders = (response: NextResponse, cache?: string) => renewLanguage(request, headed(response, cache), origin);
  const error = validateMutation(request, origin, { configured: configuredOrigin !== undefined });
  if (error) return withHeaders(NextResponse.json({ error }, { status: 403 }));
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method) && request.headers.get("content-type")?.startsWith("application/json")) {
    try {
      const body = await request.clone().json();
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid body");
    } catch { return withHeaders(NextResponse.json({ error: "Send a valid JSON object with the required fields." }, { status: 400 })); }
  }
  const pathname = request.nextUrl.pathname;
  if (pathname === "/api/student/join" || pathname.startsWith("/api/classroom/")) return withHeaders(NextResponse.json({ error: "Staff allocate classes. Use your student account; class-code access is retired." }, { status: 410 }));
  if (pathname === "/classroom") return withHeaders(redirect(request, "/student"));
  if (isPublicPath(request.nextUrl) || isPublicScript(pathname)) return withHeaders(NextResponse.next(), cacheControl(pathname, "public"));
  const session = await learningSession(request.cookies.get("ba_adult_session")?.value, request.cookies.get("ba_student_session")?.value);
  const asset = pathname.startsWith("/_next/") || /\.[a-z0-9]+$/i.test(pathname);
  // An adult with an administrator-issued password reaches only the change form (and its scripts) until it is replaced.
  if (session.adultMustChangePassword && !asset && !allowedDuringPasswordChange(pathname)) {
    if (pathname.startsWith("/api/")) return withHeaders(NextResponse.json({ error: PASSWORD_CHANGE_ERROR, mustChangePassword: true }, { status: 403 }));
    return withHeaders(redirect(request, passwordChangeDestination(pathname + request.nextUrl.search)));
  }
  if (session.signedIn) return withHeaders(NextResponse.next(), cacheControl(pathname, "signed-in"));
  if (pathname.startsWith("/api/") || asset) {
    return withHeaders(NextResponse.json({ error: "Sign in to access learning content." }, { status: 401 }));
  }
  if (pathname === "/") {
    return withHeaders(redirect(request, "/welcome"));
  }
  return withHeaders(redirect(request, loginDestination(pathname + request.nextUrl.search)));
}

export const config = { matcher: "/:path*" };

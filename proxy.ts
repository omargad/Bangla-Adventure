import { NextRequest, NextResponse } from "next/server";
import {
  BODY_TOO_LARGE, INVALID_JSON, MAX_JSON_BODY_BYTES, mediaType, MUTATION_ERRORS_BN, publicOrigin, readBodyWithin, requestOrigins, validateMutation,
} from "./lib/request-security";
import {
  allowedDuringPasswordChange, cacheControl, isPublicPath, loginDestination, PASSWORD_CHANGE_ERROR, PASSWORD_CHANGE_ERROR_BN, passwordChangeDestination,
} from "./lib/learning-policy";
import { learningSession } from "./lib/learning-session";
import { isPublicFile, isPublicScript } from "./lib/public-assets";
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

// Optional. Without it each request's own address (Host, or X-Forwarded-Host behind a proxy) is used for the origin check.
const configuredOrigin = publicOrigin(process.env.PUBLIC_ORIGIN);

// Built from the request so Next answers with a root-relative Location, whatever Host or protocol a proxy passed on.
const redirect = (request: NextRequest, path: string) => NextResponse.redirect(new URL(path, request.nextUrl), 307);

const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Why a JSON body is refused before any route reads it, or null when it is a JSON object within the size limit. */
async function jsonBodyProblem(request: NextRequest): Promise<"too-large" | "invalid" | null> {
  // The body is buffered once here and once more by the route, so it is never read past the largest route limit.
  const text = await readBodyWithin(request.clone(), MAX_JSON_BODY_BYTES);
  if (text === null) return "too-large";
  try {
    const body: unknown = JSON.parse(text);
    return body && typeof body === "object" && !Array.isArray(body) ? null : "invalid";
  } catch { return "invalid"; }
}

export async function proxy(request: NextRequest) {
  const origin = configuredOrigin ?? `${request.nextUrl.protocol}//${request.headers.get("host") ?? request.nextUrl.host}`;
  const withHeaders = (response: NextResponse, cache?: string) => renewLanguage(request, headed(response, cache), origin);
  const error = validateMutation(request, configuredOrigin ?? requestOrigins(request, request.nextUrl));
  if (error) return withHeaders(NextResponse.json({ error, errorBn: MUTATION_ERRORS_BN[error] }, { status: 403 }));
  const pathname = request.nextUrl.pathname;
  // Narration reads its small request with a byte limit in the route. Do not buffer it here first.
  const boundedNarration = pathname.replace(/\/$/, "") === "/api/narration";
  if (!boundedNarration && BODY_METHODS.has(request.method) && mediaType(request.headers.get("content-type")) === "application/json") {
    const problem = await jsonBodyProblem(request);
    if (problem === "too-large") return withHeaders(NextResponse.json(BODY_TOO_LARGE, { status: 413 }));
    if (problem) return withHeaders(NextResponse.json(INVALID_JSON, { status: 400 }));
  }
  if (pathname === "/api/student/join" || pathname.startsWith("/api/classroom/")) {
    return withHeaders(NextResponse.json({
      error: "Staff allocate classes. Use your student account; class-code access is retired.",
      errorBn: "শিক্ষকেরাই ক্লাসে যোগ করেন। তোমার শিক্ষার্থী অ্যাকাউন্ট ব্যবহার করো; ক্লাস কোড দিয়ে যোগ দেওয়া আর চালু নেই।",
    }, { status: 410 }));
  }
  if (pathname === "/classroom") return withHeaders(redirect(request, "/student"));
  if (isPublicPath(request.nextUrl) || isPublicScript(pathname)) return withHeaders(NextResponse.next(), cacheControl(pathname, "public"));
  const session = await learningSession(request.cookies.get("ba_adult_session")?.value, request.cookies.get("ba_student_session")?.value);
  // Only build files and the files in public/ are files: a page or API path with a dot in it gets their checks.
  const asset = pathname.startsWith("/_next/") || isPublicFile(pathname);
  // An adult with an administrator-issued password reaches only the change form (and its scripts) until it is replaced.
  if (session.adultMustChangePassword && !asset && !allowedDuringPasswordChange(pathname)) {
    if (pathname.startsWith("/api/")) return withHeaders(NextResponse.json({ error: PASSWORD_CHANGE_ERROR, errorBn: PASSWORD_CHANGE_ERROR_BN, mustChangePassword: true }, { status: 403 }));
    return withHeaders(redirect(request, passwordChangeDestination(pathname + request.nextUrl.search)));
  }
  if (session.signedIn) return withHeaders(NextResponse.next(), cacheControl(pathname, "signed-in"));
  if (pathname.startsWith("/api/") || asset) {
    return withHeaders(NextResponse.json({ error: "Sign in to access learning content.", errorBn: "শেখার বিষয়বস্তু দেখতে সাইন ইন করুন।" }, { status: 401 }));
  }
  if (pathname === "/") {
    return withHeaders(redirect(request, "/welcome"));
  }
  return withHeaders(redirect(request, loginDestination(pathname + request.nextUrl.search)));
}

export const config = { matcher: "/:path*" };

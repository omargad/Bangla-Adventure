import { NextRequest, NextResponse } from "next/server";
import { validateMutation } from "./lib/request-security";
import { allowedDuringPasswordChange, isPublicPath, loginDestination, PASSWORD_CHANGE_ERROR, passwordChangeDestination } from "./lib/learning-policy";
import { learningSession } from "./lib/learning-session";
import { isPublicScript } from "./lib/public-assets";

function privateResponse(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export async function proxy(request: NextRequest) {
  const origin = process.env.PUBLIC_ORIGIN ?? `${request.nextUrl.protocol}//${request.headers.get("host") ?? request.nextUrl.host}`;
  const error = validateMutation(request, origin);
  if (error) return privateResponse(NextResponse.json({ error }, { status: 403 }));
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method) && request.headers.get("content-type")?.startsWith("application/json")) {
    try {
      const body = await request.clone().json();
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid body");
    } catch { return privateResponse(NextResponse.json({ error: "Send a valid JSON object with the required fields." }, { status: 400 })); }
  }
  const pathname = request.nextUrl.pathname;
  if (pathname === "/api/student/join" || pathname.startsWith("/api/classroom/")) return privateResponse(NextResponse.json({ error: "Staff allocate classes. Use your student account; class-code access is retired." }, { status: 410 }));
  if (pathname === "/classroom") return privateResponse(NextResponse.redirect(new URL("/student", origin), 307));
  if (isPublicPath(request.nextUrl) || isPublicScript(pathname)) return privateResponse(NextResponse.next());
  const session = await learningSession(request.cookies.get("ba_adult_session")?.value, request.cookies.get("ba_student_session")?.value);
  const asset = pathname.startsWith("/_next/") || /\.[a-z0-9]+$/i.test(pathname);
  // An adult with an administrator-issued password reaches only the change form (and its scripts) until it is replaced.
  if (session.adultMustChangePassword && !asset && !allowedDuringPasswordChange(pathname)) {
    if (pathname.startsWith("/api/")) return privateResponse(NextResponse.json({ error: PASSWORD_CHANGE_ERROR, mustChangePassword: true }, { status: 403 }));
    return privateResponse(NextResponse.redirect(new URL(passwordChangeDestination(pathname + request.nextUrl.search), origin), 307));
  }
  if (session.signedIn) return privateResponse(NextResponse.next());
  if (pathname.startsWith("/api/") || asset) {
    return privateResponse(NextResponse.json({ error: "Sign in to access learning content." }, { status: 401 }));
  }
  if (pathname === "/") {
    return privateResponse(NextResponse.redirect(new URL("/welcome", origin), 307));
  }
  return privateResponse(NextResponse.redirect(new URL(loginDestination(pathname + request.nextUrl.search), origin), 307));
}

export const config = { matcher: "/:path*" };

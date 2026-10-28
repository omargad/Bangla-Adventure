import { NextResponse } from "next/server";
import {
  STUDENT_SESSION_COOKIE,
  createStudentSession,
  registerStudent,
  studentCookieOptions,
} from "@/lib/student-auth";
import { checkRateLimit, clientKey, tooManyRequests } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const limit = checkRateLimit(`student-sign-up:${clientKey(request)}`, 8, 60 * 60 * 1000);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const username = typeof body.username === "string" ? body.username : "";
  const displayName = typeof body.displayName === "string" ? body.displayName : "";
  const password = typeof body.password === "string" ? body.password : "";
  const result = await registerStudent(username, displayName, password);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });

  const { token, expiresAt } = await createStudentSession(result.id);
  const response = NextResponse.json({ student: result }, { status: 201 });
  response.cookies.set(STUDENT_SESSION_COOKIE, token, studentCookieOptions(expiresAt));
  response.cookies.set("ba_adult_session", "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}

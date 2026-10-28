import { NextResponse } from "next/server";
import {
  STUDENT_SESSION_COOKIE,
  createStudentSession,
  studentCookieOptions,
  verifyStudentCredentials,
} from "@/lib/student-auth";
import { checkRateLimit, clientKey, tooManyRequests } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const limit = checkRateLimit(`student-sign-in:${clientKey(request)}`, 12, 15 * 60 * 1000);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const username = typeof body.username === "string" ? body.username : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password) return NextResponse.json({ error: "Enter your username and password." }, { status: 400 });

  const student = await verifyStudentCredentials(username, password);
  if (!student) return NextResponse.json({ error: "That username and password do not match." }, { status: 401 });

  const { token, expiresAt } = await createStudentSession(student.id);
  const response = NextResponse.json({ student });
  response.cookies.set(STUDENT_SESSION_COOKIE, token, studentCookieOptions(expiresAt));
  response.cookies.set("ba_adult_session", "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}

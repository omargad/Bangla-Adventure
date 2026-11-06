import { NextResponse } from "next/server";
import {
  STUDENT_SESSION_COOKIE,
  createStudentSession,
  normalizeStudentUsername,
  studentCookieOptions,
  verifyStudentCredentials,
} from "@/lib/student-auth";
import { checkRateLimit, clearRateLimit, clientKey, peekRateLimit, recordRateLimit } from "@/lib/rate-limit";
import { tooManyAttempts } from "@/lib/rate-limit-reply";
import { INSECURE_SIGN_IN, insecureSignIn } from "@/lib/request-security";
import { approvalNotice } from "@/lib/roles";

export const dynamic = "force-dynamic";

const WINDOW_MS = 15 * 60 * 1000;

export async function POST(request: Request) {
  if (insecureSignIn(request)) return NextResponse.json(INSECURE_SIGN_IN, { status: 400 });

  // A whole class signs in from one school network after a CSV import, so the per-address cap
  // only stops password spraying.
  const address = checkRateLimit(`student-sign-in-ip:${clientKey(request)}`, 200, WINDOW_MS);
  if (!address.allowed) return tooManyAttempts(address.retryAfterSeconds, "student");

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const username = typeof body.username === "string" ? body.username : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password) return NextResponse.json({ error: "Enter your username and password.", errorBn: "ইউজারনেম ও পাসওয়ার্ড লেখো।" }, { status: 400 });

  // Wrong passwords only: 10 for one account from one address, so another network cannot lock its owner out,
  // and 50 for the account from all addresses, so changing address does not give unlimited guesses.
  const normalized = normalizeStudentUsername(username);
  const fromHere = `student-sign-in-here:${clientKey(request)}:${normalized}`;
  const overall = `student-sign-in:${normalized}`;
  for (const limit of [peekRateLimit(fromHere, 10), peekRateLimit(overall, 50)]) {
    if (!limit.allowed) return tooManyAttempts(limit.retryAfterSeconds, "student");
  }

  const student = await verifyStudentCredentials(username, password);
  if (!student) {
    recordRateLimit(fromHere, WINDOW_MS);
    recordRateLimit(overall, WINDOW_MS);
    return NextResponse.json({ error: "That username and password do not match.", errorBn: "এই ইউজারনেম ও পাসওয়ার্ড মেলেনি।" }, { status: 401 });
  }
  clearRateLimit(fromHere);
  if (student.approvalStatus !== "approved") {
    return NextResponse.json({ error: approvalNotice(student.approvalStatus, "student")[0], errorBn: approvalNotice(student.approvalStatus, "student")[1], approvalStatus: student.approvalStatus }, { status: 403 });
  }

  const { token, expiresAt } = await createStudentSession(student.id);
  // A teacher-issued temporary password must be replaced before anything else.
  const response = NextResponse.json({ student, mustChangePassword: student.mustChangePassword });
  response.cookies.set(STUDENT_SESSION_COOKIE, token, studentCookieOptions(expiresAt));
  response.cookies.set("ba_adult_session", "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}

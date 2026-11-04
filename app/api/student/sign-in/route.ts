import { NextResponse } from "next/server";
import {
  STUDENT_SESSION_COOKIE,
  createStudentSession,
  normalizeStudentUsername,
  studentCookieOptions,
  verifyStudentCredentials,
} from "@/lib/student-auth";
import { checkRateLimit, clientKey, peekRateLimit, recordRateLimit, tooManyRequests } from "@/lib/rate-limit";
import { INSECURE_SIGN_IN, insecureSignIn } from "@/lib/request-security";
import { approvalNotice } from "@/lib/roles";

export const dynamic = "force-dynamic";

const WINDOW_MS = 15 * 60 * 1000;

export async function POST(request: Request) {
  if (insecureSignIn(request)) return NextResponse.json(INSECURE_SIGN_IN, { status: 400 });

  // A whole class signs in from one school network after a CSV import, so the per-address cap
  // only stops password spraying; guessing one account's password is limited per username,
  // whatever the address, on wrong passwords only.
  const address = checkRateLimit(`student-sign-in-ip:${clientKey(request)}`, 200, WINDOW_MS);
  if (!address.allowed) return tooManyRequests(address.retryAfterSeconds);

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const username = typeof body.username === "string" ? body.username : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password) return NextResponse.json({ error: "Enter your username and password.", errorBn: "ইউজারনেম ও পাসওয়ার্ড লেখো।" }, { status: 400 });

  const accountKey = `student-sign-in:${normalizeStudentUsername(username)}`;
  const account = peekRateLimit(accountKey, 10);
  if (!account.allowed) return tooManyRequests(account.retryAfterSeconds);

  const student = await verifyStudentCredentials(username, password);
  if (!student) {
    recordRateLimit(accountKey, WINDOW_MS);
    return NextResponse.json({ error: "That username and password do not match.", errorBn: "এই ইউজারনেম ও পাসওয়ার্ড মেলেনি।" }, { status: 401 });
  }
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

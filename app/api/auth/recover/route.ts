import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  consumeRecoveryCode,
  createAdultSession,
  recoverAdultPassword,
  sessionCookieOptions,
} from "../../../../lib/auth";
import { checkRateLimit, clientKey, tooManyRequests } from "../../../../lib/rate-limit";
import { approvalNotice } from "../../../../lib/roles";

export const dynamic = "force-dynamic";

/** Reset a forgotten password with a one-time recovery code. */
export async function POST(request: Request) {
  const limit = checkRateLimit(`recover:${clientKey(request)}`, 5, 15 * 60 * 1000);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email.trim().slice(0, 120) : "";
  const recoveryCode = typeof body.recoveryCode === "string" ? body.recoveryCode.trim().slice(0, 40) : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  if (!email || !recoveryCode) {
    return NextResponse.json({ error: "Enter your email and one recovery code.", errorBn: "ইমেইল ও একটি পুনরুদ্ধার কোড লিখুন।" }, { status: 400 });
  }
  if (newPassword.length < 10 || newPassword.length > 200) {
    return NextResponse.json(
      { error: "Choose a new password of at least 10 characters.", errorBn: "কমপক্ষে ১০ অক্ষরের একটি নতুন পাসওয়ার্ড বেছে নিন।" },
      { status: 400 },
    );
  }

  const adult = await consumeRecoveryCode(email, recoveryCode);
  if (!adult) {
    return NextResponse.json(
      { error: "That email and recovery code do not match, or the code was already used.", errorBn: "এই ইমেইল ও পুনরুদ্ধার কোড মেলেনি, অথবা কোডটি আগেই ব্যবহার করা হয়েছে।" },
      { status: 401 },
    );
  }
  if (adult.approvalStatus !== "approved") {
    return NextResponse.json({ error: approvalNotice(adult.approvalStatus, "adult")[0], errorBn: approvalNotice(adult.approvalStatus, "adult")[1], approvalStatus: adult.approvalStatus }, { status: 403 });
  }

  // The new password is the owner's own, which also ends an administrator-issued one. The administrator
  // who issued that password saw these codes, so they are replaced and the new set shown once.
  const recoveryCodes = await recoverAdultPassword(adult, newPassword);
  const { token, expiresAt } = await createAdultSession(adult.id);
  const response = NextResponse.json({ adult: { ...adult, mustChangePassword: false }, ...(recoveryCodes ? { recoveryCodes } : {}) }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
  response.cookies.set("ba_student_session", "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}

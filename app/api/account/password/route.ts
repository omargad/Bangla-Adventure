import { NextResponse } from "next/server";
import {
  changeAdultPassword,
  getSessionToken,
  getSignedInAdult,
  verifyAdultCredentials,
} from "../../../../lib/auth";
import { checkRateLimit, clientKey, tooManyRequests } from "../../../../lib/rate-limit";

export const dynamic = "force-dynamic";

// Uses getSignedInAdult, not getSessionAdult: this is how an adult replaces an administrator-issued password.
export async function POST(request: Request) {
  const limit = checkRateLimit(`account:${clientKey(request)}`, 10, 15 * 60 * 1000);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

  const adult = await getSignedInAdult();
  const token = await getSessionToken();
  if (!adult || !token) return NextResponse.json({ error: "Sign in required.", errorBn: "আবার সাইন ইন করুন।" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  if (newPassword.length < 10 || newPassword.length > 200) {
    return NextResponse.json(
      { error: "Choose a new password of at least 10 characters.", errorBn: "কমপক্ষে ১০ অক্ষরের একটি নতুন পাসওয়ার্ড বেছে নিন।" },
      { status: 400 },
    );
  }
  if (newPassword === currentPassword) {
    return NextResponse.json({ error: "Your new password must be different from your current one.", errorBn: "নতুন পাসওয়ার্ডটি বর্তমান পাসওয়ার্ড থেকে আলাদা হতে হবে।" }, { status: 400 });
  }
  const verified = await verifyAdultCredentials(adult.email, currentPassword);
  if (!verified) {
    return NextResponse.json({ error: "Your current password is incorrect.", errorBn: "আপনার বর্তমান পাসওয়ার্ডটি সঠিক নয়।" }, { status: 403 });
  }

  // Keep this session signed in; end every other one. Replacing an administrator-issued password also renews the recovery codes.
  const recoveryCodes = await changeAdultPassword(adult, newPassword, token);
  return NextResponse.json({ ok: true, ...(recoveryCodes ? { recoveryCodes } : {}) }, { headers: { "Cache-Control": "no-store" } });
}

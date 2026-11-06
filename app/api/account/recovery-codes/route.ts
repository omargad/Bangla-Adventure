import { NextResponse } from "next/server";
import { getSessionAdult, renewRecoveryCodes, verifyAdultCredentials } from "../../../../lib/auth";
import { checkRateLimit } from "../../../../lib/rate-limit";
import { tooManyAttempts } from "../../../../lib/rate-limit-reply";

export const dynamic = "force-dynamic";

/** Replace all recovery codes with a fresh set. Requires the current password. */
export async function POST(request: Request) {
  const adult = await getSessionAdult();
  if (!adult) return NextResponse.json({ error: "Sign in required.", errorBn: "সাইন ইন করা প্রয়োজন।" }, { status: 401 });

  // Per account, not per address, shared with the other account changes.
  const limit = checkRateLimit(`account:${adult.id}`, 10, 15 * 60 * 1000);
  if (!limit.allowed) return tooManyAttempts(limit.retryAfterSeconds);

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const password = typeof body.password === "string" ? body.password : "";
  const verified = await verifyAdultCredentials(adult.email, password);
  if (!verified) {
    return NextResponse.json({ error: "Your current password is incorrect.", errorBn: "আপনার বর্তমান পাসওয়ার্ডটি সঠিক নয়।" }, { status: 403 });
  }

  const recoveryCodes = await renewRecoveryCodes(adult);
  return NextResponse.json({ recoveryCodes }, { headers: { "Cache-Control": "no-store" } });
}

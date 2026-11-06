import { NextResponse } from "next/server";
import { getSessionAdult, issueRecoveryCodes, verifyAdultCredentials } from "../../../../lib/auth";
import { checkRateLimit } from "../../../../lib/rate-limit";
import { tooManyAttempts } from "../../../../lib/rate-limit-reply";

export const dynamic = "force-dynamic";

/** Replace all recovery codes with a fresh set. Requires the current password. */
export async function POST(request: Request) {
  const adult = await getSessionAdult();
  if (!adult) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  // Per account, not per address, shared with the other account changes.
  const limit = checkRateLimit(`account:${adult.id}`, 10, 15 * 60 * 1000);
  if (!limit.allowed) return tooManyAttempts(limit.retryAfterSeconds);

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const password = typeof body.password === "string" ? body.password : "";
  const verified = await verifyAdultCredentials(adult.email, password);
  if (!verified) {
    return NextResponse.json({ error: "Your current password is incorrect." }, { status: 403 });
  }

  const recoveryCodes = await issueRecoveryCodes(adult.id);
  return NextResponse.json({ recoveryCodes });
}

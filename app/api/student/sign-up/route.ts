import { NextResponse } from "next/server";
import { registerStudent } from "@/lib/student-auth";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";
import { SIGN_UPS_PER_HOUR, tooManyAttempts } from "@/lib/rate-limit-reply";
import { approvalNotice } from "@/lib/roles";

export const dynamic = "force-dynamic";

/** Student self sign-up. The account waits for an administrator, so no session starts here. */
export async function POST(request: Request) {
  const limit = checkRateLimit(`student-sign-up:${clientKey(request)}`, SIGN_UPS_PER_HOUR, 60 * 60 * 1000);
  if (!limit.allowed) return tooManyAttempts(limit.retryAfterSeconds, "student");

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const username = typeof body.username === "string" ? body.username : "";
  const displayName = typeof body.displayName === "string" ? body.displayName : "";
  const password = typeof body.password === "string" ? body.password : "";
  const result = await registerStudent(username, displayName, password);
  if ("error" in result) return NextResponse.json({ error: result.error, errorBn: result.errorBn }, { status: 400 });

  return NextResponse.json({ student: result, pendingApproval: true, message: approvalNotice("pending", "student")[0] }, { status: 201 });
}

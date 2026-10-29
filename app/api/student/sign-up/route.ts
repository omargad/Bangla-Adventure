import { NextResponse } from "next/server";
import { registerStudent } from "@/lib/student-auth";
import { checkRateLimit, clientKey, tooManyRequests } from "@/lib/rate-limit";
import { approvalNotice } from "@/lib/roles";

export const dynamic = "force-dynamic";

/** Student self sign-up. The account waits for an administrator, so no session starts here. */
export async function POST(request: Request) {
  const limit = checkRateLimit(`student-sign-up:${clientKey(request)}`, 8, 60 * 60 * 1000);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const username = typeof body.username === "string" ? body.username : "";
  const displayName = typeof body.displayName === "string" ? body.displayName : "";
  const password = typeof body.password === "string" ? body.password : "";
  const result = await registerStudent(username, displayName, password);
  if ("error" in result) return NextResponse.json({ error: result.error, errorBn: result.errorBn }, { status: 400 });

  return NextResponse.json({ student: result, pendingApproval: true, message: approvalNotice("pending", "student")[0] }, { status: 201 });
}

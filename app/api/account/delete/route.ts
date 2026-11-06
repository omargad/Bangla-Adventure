import { NextResponse } from "next/server";
import { SESSION_COOKIE, getSessionAdult, verifyAdultCredentials } from "../../../../lib/auth";
import { checkRateLimit } from "../../../../lib/rate-limit";
import { tooManyAttempts } from "../../../../lib/rate-limit-reply";
import { UserManagementError, accountDeletionBlocker, deleteOwnAccount } from "../../../../lib/user-management";

export const dynamic = "force-dynamic";

const refusal = (error: UserManagementError) => NextResponse.json({ error: error.message, errorBn: error.messageBn }, { status: error.status });

/**
 * Permanently delete the grown-up account and every record it owns (see deleteOwnAccount). An administrator
 * must first be given another role, and a teacher must first have their classes moved to another teacher:
 * both are told so before the password is checked.
 */
export async function POST(request: Request) {
  const adult = await getSessionAdult();
  if (!adult) return NextResponse.json({ error: "Sign in required.", errorBn: "সাইন ইন করা প্রয়োজন।" }, { status: 401 });

  // Per account, not per address, shared with the other account changes.
  const limit = checkRateLimit(`account:${adult.id}`, 10, 15 * 60 * 1000);
  if (!limit.allowed) return tooManyAttempts(limit.retryAfterSeconds);

  const blocked = await accountDeletionBlocker(adult.id);
  if (blocked) return refusal(blocked);

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const password = typeof body.password === "string" ? body.password : "";
  if (!(await verifyAdultCredentials(adult.email, password))) {
    return NextResponse.json({ error: "Enter your current password to confirm deletion.", errorBn: "মোছা নিশ্চিত করতে আপনার বর্তমান পাসওয়ার্ড লিখুন।" }, { status: 403 });
  }

  try {
    await deleteOwnAccount(adult.id);
  } catch (error) {
    if (error instanceof UserManagementError) return refusal(error);
    return NextResponse.json({ error: "The account could not be deleted. Nothing was removed; please try again.", errorBn: "অ্যাকাউন্টটি মোছা যায়নি। কিছুই সরানো হয়নি; আবার চেষ্টা করুন।" }, { status: 503 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}

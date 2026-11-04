import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  createAdultSession,
  sessionCookieOptions,
  verifyAdultCredentials,
} from "../../../../lib/auth";
import { checkRateLimit, clearRateLimit, clientKey, peekRateLimit, recordRateLimit, tooManyRequests } from "../../../../lib/rate-limit";
import { INSECURE_SIGN_IN, insecureSignIn } from "../../../../lib/request-security";
import { approvalNotice, canManageUsers } from "@/lib/roles";

export const dynamic = "force-dynamic";

const WINDOW_MS = 15 * 60 * 1000;

export async function POST(request: Request) {
  if (insecureSignIn(request)) return NextResponse.json(INSECURE_SIGN_IN, { status: 400 });

  // A staff room shares one address and this counts every sign-in, so the per-address cap is coarse.
  const address = checkRateLimit(`sign-in:${clientKey(request)}`, 100, WINDOW_MS);
  if (!address.allowed) return tooManyRequests(address.retryAfterSeconds);

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email.trim().slice(0, 120) : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) {
    return NextResponse.json({ error: "Enter your email and password.", errorBn: "ইমেইল ও পাসওয়ার্ড লিখুন।" }, { status: 400 });
  }

  // Wrong passwords only: 10 for one account from one address, so another network cannot lock its owner out,
  // and 50 for the account from all addresses, so changing address does not give unlimited guesses.
  const normalized = email.trim().toLowerCase();
  const fromHere = `sign-in-account-here:${clientKey(request)}:${normalized}`;
  const overall = `sign-in-account:${normalized}`;
  for (const limit of [peekRateLimit(fromHere, 10), peekRateLimit(overall, 50)]) {
    if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);
  }

  const adult = await verifyAdultCredentials(email, password);
  if (!adult) {
    recordRateLimit(fromHere, WINDOW_MS);
    recordRateLimit(overall, WINDOW_MS);
    return NextResponse.json({ error: "That email and password do not match.", errorBn: "এই ইমেইল ও পাসওয়ার্ড মেলেনি।" }, { status: 401 });
  }
  clearRateLimit(fromHere);
  // Only someone who knows the password learns that the account is still waiting for approval.
  if (adult.approvalStatus !== "approved") {
    return NextResponse.json({ error: approvalNotice(adult.approvalStatus, "adult")[0], errorBn: approvalNotice(adult.approvalStatus, "adult")[1], approvalStatus: adult.approvalStatus }, { status: 403 });
  }
  if (body.requireAdmin === true && !canManageUsers(adult)) {
    return NextResponse.json({ error: "This account does not have administrator access. Sign in with your administrator account.", errorBn: "এই অ্যাকাউন্টে প্রশাসকের অনুমতি নেই। আপনার প্রশাসক অ্যাকাউন্ট দিয়ে সাইন ইন করুন।" }, { status: 403 });
  }

  const { token, expiresAt } = await createAdultSession(adult.id);
  // An administrator-issued password must be replaced before anything else.
  const response = NextResponse.json({ adult, mustChangePassword: adult.mustChangePassword });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
  response.cookies.set("ba_student_session", "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}

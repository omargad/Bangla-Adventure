import { NextResponse } from "next/server";
import { SESSION_COOKIE, getSessionAdult, signOutEverywhere } from "../../../../lib/auth";

export const dynamic = "force-dynamic";

/** Sign out of every device, including this one. */
export async function DELETE() {
  const adult = await getSessionAdult();
  if (!adult) return NextResponse.json({ error: "Sign in required.", errorBn: "সাইন ইন করা প্রয়োজন।" }, { status: 401 });

  await signOutEverywhere(adult);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}

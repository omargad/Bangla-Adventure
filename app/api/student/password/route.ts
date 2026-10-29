import { NextResponse } from "next/server";
import { changeStudentPassword, getSessionStudent, getStudentSessionToken, verifyStudentCredentials } from "@/lib/student-auth";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Uses getSessionStudent, not getStudentAccess: this is how a student clears the temporary-password block.
export async function POST(request: Request) {
  const student = await getSessionStudent();
  const token = await getStudentSessionToken();
  if (!student || !token) return NextResponse.json({ error: "Student sign in required.", errorBn: "শিক্ষার্থী হিসেবে সাইন ইন করো।" }, { status: 401 });
  // Per student rather than per address: a whole class may change passwords from one school network.
  const limit = checkRateLimit(`student-password:${student.id}`, 10, 15 * 60 * 1000);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  if (newPassword.length < 8 || newPassword.length > 200) {
    return NextResponse.json({ error: "Choose a new password with at least 8 characters. A grown-up can help you choose one.", errorBn: "কমপক্ষে ৮ অক্ষরের একটি নতুন পাসওয়ার্ড বেছে নাও। দরকার হলে বড়দের সাহায্য নাও।" }, { status: 400 });
  }
  if (newPassword === currentPassword) {
    return NextResponse.json({ error: "Your new password must be different from your current one.", errorBn: "নতুন পাসওয়ার্ডটি বর্তমানটি থেকে আলাদা হতে হবে।" }, { status: 400 });
  }
  if (!(await verifyStudentCredentials(student.username, currentPassword))) {
    return NextResponse.json({ error: "Your current password is incorrect.", errorBn: "তোমার বর্তমান পাসওয়ার্ডটি সঠিক নয়।" }, { status: 403 });
  }

  // Keep this session signed in; end every other one.
  await changeStudentPassword(student, newPassword, token);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

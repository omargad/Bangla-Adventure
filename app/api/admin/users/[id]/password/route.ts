import { getStaffAccess } from "@/lib/auth";
import { resetPassword, UserManagementError } from "@/lib/user-management";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** An administrator gives a student or adult a new temporary password, shown once. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getStaffAccess("admin");
  if (actor instanceof Response) return actor;
  const limit = checkRateLimit(`admin-reset:${actor.id}`, 30, 60 * 60 * 1000);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);
  const { id } = await context.params;
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Choose an account type.", errorBn: "অ্যাকাউন্টের ধরন বেছে নিন।" }, { status: 400 });
    return Response.json(await resetPassword(actor.id, id, body), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return error instanceof UserManagementError
      ? Response.json({ error: error.message, errorBn: error.messageBn }, { status: error.status })
      : Response.json({ error: "The password could not be reset.", errorBn: "পাসওয়ার্ড রিসেট করা যায়নি।" }, { status: 503 });
  }
}

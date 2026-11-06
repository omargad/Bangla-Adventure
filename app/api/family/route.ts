import { getSessionAdult } from "@/lib/auth";
import { getParentOverview } from "@/lib/parent-access";
import { UserManagementError } from "@/lib/user-management";

export const dynamic = "force-dynamic";

/** The linked children whose accounts are in use, with their classes, results, attendance and announcements. */
export async function GET() {
  const parent = await getSessionAdult();
  if (!parent) return Response.json({ error: "Parent sign in required.", errorBn: "অভিভাবক হিসেবে সাইন ইন করুন।" }, { status: 401 });
  try {
    return Response.json(await getParentOverview(parent.id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return error instanceof UserManagementError
      ? Response.json({ error: error.message, errorBn: error.messageBn }, { status: error.status })
      : Response.json({ error: "Learning records could not be loaded.", errorBn: "শেখার তথ্য লোড করা যায়নি।" }, { status: 503 });
  }
}

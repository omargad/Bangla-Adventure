import { getStaffAccess } from "@/lib/auth";
import { listClassResults } from "@/lib/grades";
import { UserManagementError } from "@/lib/user-management";

export const dynamic = "force-dynamic";

/** Every class with its teacher and result totals. Per-class rows come from /api/classes/[id]/grades. */
export async function GET() {
  const actor = await getStaffAccess("admin");
  if (actor instanceof Response) return actor;
  try { return Response.json({ classes: await listClassResults(actor.id) }); }
  catch (error) {
    return error instanceof UserManagementError
      ? Response.json({ error: error.message, errorBn: error.messageBn }, { status: error.status })
      : Response.json({ error: "Class results could not be loaded. Please try again.", errorBn: "ক্লাসের ফলাফল লোড করা যায়নি। আবার চেষ্টা করুন।" }, { status: 503 });
  }
}

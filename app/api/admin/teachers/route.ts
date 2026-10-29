import { getStaffAccess } from "@/lib/auth";
import { listTeachers } from "@/lib/class-management";
import { UserManagementError } from "@/lib/user-management";

export const dynamic = "force-dynamic";

/** Approved teachers an administrator can create a class for or give a class to. */
export async function GET() {
  const actor = await getStaffAccess("admin");
  if (actor instanceof Response) return actor;
  try {
    return Response.json({ teachers: await listTeachers(actor.id) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return error instanceof UserManagementError
      ? Response.json({ error: error.message, errorBn: error.messageBn }, { status: error.status })
      : Response.json({ error: "Teachers could not be loaded. Please try again.", errorBn: "শিক্ষকদের তালিকা লোড করা যায়নি। আবার চেষ্টা করুন।" }, { status: 503 });
  }
}

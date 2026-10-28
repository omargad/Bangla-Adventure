import { getStaffAccess } from "@/lib/auth";
import { listClassResults } from "@/lib/grades";

export const dynamic = "force-dynamic";

/** Every class with its teacher and result totals. Per-class rows come from /api/classes/[id]/grades. */
export async function GET() {
  const actor = await getStaffAccess("admin");
  if (actor instanceof Response) return actor;
  try { return Response.json({ classes: await listClassResults() }); }
  catch { return Response.json({ error: "Class results could not be loaded. Please try again." }, { status: 503 }); }
}

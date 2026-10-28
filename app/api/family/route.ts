import { getSessionAdult } from "@/lib/auth";
import { getParentOverview } from "@/lib/parent-access";
import { UserManagementError } from "@/lib/user-management";

export const dynamic = "force-dynamic";

export async function GET() {
  const parent = await getSessionAdult();
  if (!parent) return Response.json({ error: "Parent sign in required." }, { status: 401 });
  try {
    return Response.json(await getParentOverview(parent.id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof UserManagementError ? error.message : "Learning records could not be loaded." }, { status: error instanceof UserManagementError ? error.status : 503 });
  }
}

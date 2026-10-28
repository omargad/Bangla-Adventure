import { getStaffAccess } from "@/lib/auth";
import { updateUser, UserManagementError } from "@/lib/user-management";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getStaffAccess("admin");
  if (actor instanceof Response) return actor;
  const { id } = await context.params;
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Provide the user changes." }, { status: 400 });
    return Response.json({ user: await updateUser(actor.id, id, body) });
  } catch (error) {
    return Response.json({ error: error instanceof UserManagementError ? error.message : "The account could not be updated." }, { status: error instanceof UserManagementError ? error.status : 503 });
  }
}

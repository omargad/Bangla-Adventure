import { getStaffAccess } from "@/lib/auth";
import { saveTopic } from "@/lib/curriculum-catalog";
import { UserManagementError } from "@/lib/user-management";
export async function PUT(request: Request) {
  const actor = await getStaffAccess("admin");
  if (actor instanceof Response) return actor;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Provide the topic fields." }, { status: 400 });
  try { return Response.json({ topic: await saveTopic(actor.id, body) }); }
  catch (error) { return Response.json({ error: error instanceof UserManagementError ? error.message : "Could not save the topic." }, { status: error instanceof UserManagementError ? error.status : 503 }); }
}

import { getStaffAccess } from "@/lib/auth";
import { linkParent, listParents, unlinkParent } from "@/lib/parent-access";
import { UserManagementError } from "@/lib/user-management";

export const dynamic = "force-dynamic";

function failure(error: unknown) {
  return Response.json({ error: error instanceof UserManagementError ? error.message : "Family access could not be updated." }, { status: error instanceof UserManagementError ? error.status : 503 });
}

export async function GET(request: Request) {
  const actor = await getStaffAccess("admin");
  if (actor instanceof Response) return actor;
  const studentId = new URL(request.url).searchParams.get("studentId");
  if (!studentId || studentId.length > 80) return Response.json({ error: "Choose a student account." }, { status: 400 });
  try { return Response.json({ parents: await listParents(actor.id, studentId) }); }
  catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  const actor = await getStaffAccess("admin");
  if (actor instanceof Response) return actor;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.studentId !== "string" || body.studentId.length > 80 || typeof body.parentEmail !== "string" || body.parentEmail.length > 120 || body.confirmed !== true) {
    return Response.json({ error: "Choose the student, enter the parent email and confirm their authorization." }, { status: 400 });
  }
  try { return Response.json(await linkParent(actor.id, body.studentId, body.parentEmail)); }
  catch (error) { return failure(error); }
}

export async function DELETE(request: Request) {
  const actor = await getStaffAccess("admin");
  if (actor instanceof Response) return actor;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.studentId !== "string" || body.studentId.length > 80 || typeof body.parentId !== "string" || body.parentId.length > 80) {
    return Response.json({ error: "Choose the family link to remove." }, { status: 400 });
  }
  try { return Response.json(await unlinkParent(actor.id, body.studentId, body.parentId)); }
  catch (error) { return failure(error); }
}

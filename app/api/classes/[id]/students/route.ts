import { getStaffAccess } from "@/lib/auth";
import { allocateStudent, removeAllocation, roster } from "@/lib/enrollments";
import { UserManagementError } from "@/lib/user-management";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
const failure = (error: unknown) => Response.json({ error: error instanceof UserManagementError ? error.message : "Could not update the class allocation." }, { status: error instanceof UserManagementError ? error.status : 503 });
export async function GET(_request: Request, context: Context) {
  const actor = await getStaffAccess();
  if (actor instanceof Response) return actor;
  try { return Response.json({ students: await roster(actor.id, (await context.params).id) }); } catch (error) { return failure(error); }
}
export async function POST(request: Request, context: Context) {
  const actor = await getStaffAccess();
  if (actor instanceof Response) return actor;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.username !== "string") return Response.json({ error: "Enter a student username." }, { status: 400 });
  try { return Response.json(await allocateStudent(actor.id, (await context.params).id, body.username)); } catch (error) { return failure(error); }
}
export async function DELETE(request: Request, context: Context) {
  const actor = await getStaffAccess();
  if (actor instanceof Response) return actor;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.studentId !== "string") return Response.json({ error: "Choose a student allocation." }, { status: 400 });
  try { return Response.json(await removeAllocation(actor.id, (await context.params).id, body.studentId)); } catch (error) { return failure(error); }
}

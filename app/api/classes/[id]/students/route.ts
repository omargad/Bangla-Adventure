import { getStaffAccess } from "@/lib/auth";
import { allocateStudent, allocateStudents, availableStudents, MAX_BULK_ALLOCATION, removeAllocation, roster } from "@/lib/enrollments";
import { UserManagementError } from "@/lib/user-management";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
const failure = (error: unknown) => error instanceof UserManagementError
  ? Response.json({ error: error.message, errorBn: error.messageBn }, { status: error.status })
  : Response.json({ error: "Could not update the class allocation.", errorBn: "ক্লাস বরাদ্দ হালনাগাদ করা যায়নি।" }, { status: 503 });
/** The class roster, or with ?available=1&q=… the active, approved students who could be added (names and usernames only). */
export async function GET(request: Request, context: Context) {
  const actor = await getStaffAccess();
  if (actor instanceof Response) return actor;
  const params = new URL(request.url).searchParams;
  try {
    const classId = (await context.params).id;
    if (params.get("available") === "1") return Response.json(await availableStudents(actor.id, classId, params.get("q") ?? ""), { headers: { "Cache-Control": "private, no-store" } });
    return Response.json({ students: await roster(actor.id, classId) });
  } catch (error) { return failure(error); }
}
/** Allocate one student by username, or the ticked students with { studentIds }. */
export async function POST(request: Request, context: Context) {
  const actor = await getStaffAccess();
  if (actor instanceof Response) return actor;
  const body = await request.json().catch(() => null);
  if (body && Array.isArray(body.studentIds)) {
    if (!body.studentIds.length || body.studentIds.length > MAX_BULK_ALLOCATION || !body.studentIds.every((id: unknown) => typeof id === "string" && id.length > 0 && id.length <= 80)) {
      return Response.json({ error: "Choose the students to add.", errorBn: "যোগ করার জন্য শিক্ষার্থী বেছে নিন।" }, { status: 400 });
    }
    try { return Response.json(await allocateStudents(actor.id, (await context.params).id, body.studentIds)); } catch (error) { return failure(error); }
  }
  if (!body || typeof body.username !== "string") return Response.json({ error: "Enter a student username.", errorBn: "শিক্ষার্থীর ব্যবহারকারীর নাম লিখুন।" }, { status: 400 });
  try { return Response.json(await allocateStudent(actor.id, (await context.params).id, body.username)); } catch (error) { return failure(error); }
}
export async function DELETE(request: Request, context: Context) {
  const actor = await getStaffAccess();
  if (actor instanceof Response) return actor;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.studentId !== "string") return Response.json({ error: "Choose a student allocation.", errorBn: "একটি শিক্ষার্থী বরাদ্দ বেছে নিন।" }, { status: 400 });
  try { return Response.json(await removeAllocation(actor.id, (await context.params).id, body.studentId)); } catch (error) { return failure(error); }
}

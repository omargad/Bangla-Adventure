import { getStaffAccess } from "@/lib/auth";
import { checkSessionDate, MAX_ATTENDANCE_MARKS, parseAttendanceMarks } from "@/lib/attendance";
import { attendanceSheet, saveAttendance } from "@/lib/class-attendance";
import { UserManagementError } from "@/lib/user-management";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
const failure = (error: unknown) => error instanceof UserManagementError
  ? Response.json({ error: error.message, errorBn: error.messageBn }, { status: error.status })
  : Response.json({ error: "Attendance could not be saved or loaded. Please try again.", errorBn: "উপস্থিতি সংরক্ষণ বা লোড করা যায়নি। আবার চেষ্টা করুন।" }, { status: 503 });

/** ?date=YYYY-MM-DD: the attendance sheet for that class session, in a class the teacher (or any administrator) manages. */
export async function GET(request: Request, context: Context) {
  const actor = await getStaffAccess();
  if (actor instanceof Response) return actor;
  const checked = checkSessionDate(new URL(request.url).searchParams.get("date"));
  if ("error" in checked) return Response.json(checked, { status: 400 });
  try {
    return Response.json(await attendanceSheet(actor, (await context.params).id, checked.date), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return failure(error); }
}

/** Save one session: { date, marks: [{ studentId, present }] } with a mark for every student now in the class. */
export async function PUT(request: Request, context: Context) {
  const actor = await getStaffAccess();
  if (actor instanceof Response) return actor;
  const body = await request.json().catch(() => null) as { date?: unknown; marks?: unknown } | null;
  const checked = checkSessionDate(body?.date);
  if ("error" in checked) return Response.json(checked, { status: 400 });
  const marks = parseAttendanceMarks(body?.marks);
  if (!marks) return Response.json({ error: `Mark each student present or absent (up to ${MAX_ATTENDANCE_MARKS} students).`, errorBn: "প্রত্যেক শিক্ষার্থীকে উপস্থিত বা অনুপস্থিত চিহ্নিত করুন।" }, { status: 400 });
  try {
    return Response.json(await saveAttendance(actor, (await context.params).id, checked.date, marks));
  } catch (error) { return failure(error); }
}

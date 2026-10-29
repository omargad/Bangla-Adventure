import { getStaffAccess } from "@/lib/auth";
import { importStudents } from "@/lib/enrollments";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";
import { fileTooLargeIssue, importTooLarge, MAX_IMPORT_BYTES } from "@/lib/student-import";
import { UserManagementError } from "@/lib/user-management";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
const tooLarge = () => { const { message, messageBn } = fileTooLargeIssue(); return Response.json({ error: message, errorBn: messageBn }, { status: 413 }); };
export async function POST(request: Request, context: Context) {
  const actor = await getStaffAccess();
  if (actor instanceof Response) return actor;
  const limit = checkRateLimit(`student-import:${actor.id}`, 20, 60 * 60 * 1000);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);
  // JSON escaping can at most double the CSV text; anything far beyond that is refused unread.
  if (Number(request.headers.get("content-length") ?? 0) > MAX_IMPORT_BYTES * 4) return tooLarge();
  const body = await request.json().catch(() => null);
  if (!body || typeof body.csv !== "string") return Response.json({ error: "Choose a CSV file to upload.", errorBn: "আপলোড করতে একটি CSV ফাইল বেছে নিন।" }, { status: 400 });
  if (importTooLarge(body.csv)) return tooLarge();
  try {
    const result = await importStudents(actor.id, (await context.params).id, body.csv, { createSameNames: body.createSameNames === true });
    if ("errors" in result) return Response.json({ error: "Nothing was created. Fix the rows listed and upload the file again.", errorBn: "কিছুই তৈরি হয়নি। তালিকার সারিগুলো ঠিক করে ফাইলটি আবার আপলোড করুন।", errors: result.errors, sameNames: result.sameNames }, { status: 400 });
    // The only copy of each temporary password: never cache it.
    return Response.json({ created: result.created, existing: result.existing }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof UserManagementError ? error.message : "The students could not be imported.", errorBn: error instanceof UserManagementError ? error.messageBn : "শিক্ষার্থীদের যোগ করা যায়নি।" }, { status: error instanceof UserManagementError ? error.status : 503 });
  }
}

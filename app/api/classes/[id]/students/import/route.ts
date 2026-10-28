import { getStaffAccess } from "@/lib/auth";
import { importStudents } from "@/lib/enrollments";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";
import { importTooLarge, MAX_IMPORT_BYTES } from "@/lib/student-import";
import { UserManagementError } from "@/lib/user-management";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
const tooLarge = () => Response.json({ error: `The file is larger than ${MAX_IMPORT_BYTES / 1024} KB. Split it into smaller files.` }, { status: 413 });
export async function POST(request: Request, context: Context) {
  const actor = await getStaffAccess();
  if (actor instanceof Response) return actor;
  const limit = checkRateLimit(`student-import:${actor.id}`, 20, 60 * 60 * 1000);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);
  // JSON escaping can at most double the CSV text; anything far beyond that is refused unread.
  if (Number(request.headers.get("content-length") ?? 0) > MAX_IMPORT_BYTES * 4) return tooLarge();
  const body = await request.json().catch(() => null);
  if (!body || typeof body.csv !== "string") return Response.json({ error: "Choose a CSV file to upload." }, { status: 400 });
  if (importTooLarge(body.csv)) return tooLarge();
  try {
    const result = await importStudents(actor.id, (await context.params).id, body.csv);
    if ("errors" in result) return Response.json({ error: "Nothing was created. Fix the rows listed and upload the file again.", errors: result.errors }, { status: 400 });
    // The only copy of each temporary password: never cache it.
    return Response.json({ created: result.created }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof UserManagementError ? error.message : "The students could not be imported." }, { status: error instanceof UserManagementError ? error.status : 503 });
  }
}

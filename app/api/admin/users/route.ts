import { getStaffAccess } from "@/lib/auth";
import { createUser, listUsers, UserManagementError } from "@/lib/user-management";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await getStaffAccess("admin");
  if (actor instanceof Response) return actor;
  try {
    return Response.json(await listUsers(new URL(request.url).searchParams));
  } catch (error) {
    return error instanceof UserManagementError
      ? Response.json({ error: error.message, errorBn: error.messageBn }, { status: error.status })
      : Response.json({ error: "Users could not be loaded.", errorBn: "ব্যবহারকারীদের লোড করা যায়নি।" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const actor = await getStaffAccess("admin");
  if (actor instanceof Response) return actor;
  const limit = checkRateLimit(`admin-create:${actor.id}`, 30, 60 * 60 * 1000);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Provide account details.", errorBn: "অ্যাকাউন্টের তথ্য দিন।" }, { status: 400 });
    return Response.json(await createUser(actor.id, body), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return error instanceof UserManagementError
      ? Response.json({ error: error.message, errorBn: error.messageBn }, { status: error.status })
      : Response.json({ error: "The account could not be created.", errorBn: "অ্যাকাউন্টটি তৈরি করা যায়নি।" }, { status: 503 });
  }
}

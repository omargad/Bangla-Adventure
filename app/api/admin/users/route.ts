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
    return Response.json({ error: error instanceof UserManagementError ? error.message : "Users could not be loaded." }, { status: error instanceof UserManagementError ? error.status : 503 });
  }
}

export async function POST(request: Request) {
  const actor = await getStaffAccess("admin");
  if (actor instanceof Response) return actor;
  const limit = checkRateLimit(`admin-create:${actor.id}`, 30, 60 * 60 * 1000);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Provide account details." }, { status: 400 });
    return Response.json(await createUser(actor.id, body), { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof UserManagementError ? error.message : "The account could not be created." }, { status: error instanceof UserManagementError ? error.status : 503 });
  }
}

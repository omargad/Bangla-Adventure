import { getStaffAccess } from "@/lib/auth";
import { getApprovalSettings, setTeacherTopicApproval, settingErrorResponse } from "@/lib/approval-settings";

export const dynamic = "force-dynamic";

/** The approval settings, for an administrator. Teachers read what applies to them from GET /api/topics. */
export async function GET() {
  const actor = await getStaffAccess("admin");
  if (actor instanceof Response) return actor;
  try { return Response.json({ settings: await getApprovalSettings() }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return settingErrorResponse(error); }
}

/**
 * { teacherTopicsNeedApproval: boolean } turns "Teachers' topics need an administrator's approval" on or off.
 * Administrators only; the account is checked again inside the change, and the change is audited.
 */
export async function PUT(request: Request) {
  const actor = await getStaffAccess("admin");
  if (actor instanceof Response) return actor;
  const body = await request.json().catch(() => null);
  try { return Response.json({ settings: await setTeacherTopicApproval(actor.id, body) }); }
  catch (error) { return settingErrorResponse(error); }
}

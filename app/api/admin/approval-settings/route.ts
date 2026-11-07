import { getStaffAccess } from "@/lib/auth";
import { getApprovalSettings, setApprovalSettings, settingErrorResponse, waitingClassContent } from "@/lib/approval-settings";
import { listStaffTopics } from "@/lib/curriculum-catalog";

export const dynamic = "force-dynamic";

/** What is still waiting for an administrator, so the panel can say that turning approval off does not publish it. */
async function waiting() {
  const [topics, classContent] = await Promise.all([listStaffTopics(), waitingClassContent()]);
  return { topics: topics.filter((topic) => topic.pendingVersions.length > 0).length, ...classContent };
}

/**
 * The approval settings ("Who needs approval"), for an administrator, with what is still waiting for approval.
 * Teachers read what applies to them from GET /api/topics, GET /api/classes/[id] and GET /api/classes/[id]/sources.
 */
export async function GET() {
  const actor = await getStaffAccess("admin");
  if (actor instanceof Response) return actor;
  try { return Response.json({ settings: await getApprovalSettings(), waiting: await waiting() }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return settingErrorResponse(error); }
}

/**
 * Any of { teacherTopicsNeedApproval, teacherActivitiesNeedApproval, teacherSourcesNeedApproval } (booleans) turns
 * that setting on or off. Administrators only; the account is checked again inside the change, and each change is audited.
 */
export async function PUT(request: Request) {
  const actor = await getStaffAccess("admin");
  if (actor instanceof Response) return actor;
  const body = await request.json().catch(() => null);
  try { return Response.json({ settings: await setApprovalSettings(actor.id, body), waiting: await waiting() }); }
  catch (error) { return settingErrorResponse(error); }
}

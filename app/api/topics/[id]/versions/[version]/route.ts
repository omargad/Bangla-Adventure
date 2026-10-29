import { getStaffAccess } from "@/lib/auth";
import { getTopicVersion, readTopicBody, reviewTopicVersion, topicErrorResponse } from "@/lib/curriculum-catalog";
import { TOPIC_ID_PATTERN } from "@/lib/topic-model";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string; version: string }> };

async function target(context: RouteContext) {
  const { id, version } = await context.params;
  return TOPIC_ID_PATTERN.test(id) && /^\d{1,6}$/.test(version) ? { id, version: Number(version) } : null;
}
const notFound = () => Response.json({ error: "That version of the topic was not found.", errorBn: "বিষয়ের ওই সংস্করণটি পাওয়া যায়নি।" }, { status: 404 });

/** One version in full for the preview, with the approved version and a change summary. */
export async function GET(_request: Request, context: RouteContext) {
  const actor = await getStaffAccess("teach");
  if (actor instanceof Response) return actor;
  const found = await target(context);
  if (!found) return notFound();
  try { return Response.json(await getTopicVersion(found.id, found.version)); }
  catch (error) { return topicErrorResponse(error); }
}

/** Approve (publish to students) or send back a pending version. */
export async function POST(request: Request, context: RouteContext) {
  const actor = await getStaffAccess("teach");
  if (actor instanceof Response) return actor;
  const found = await target(context);
  if (!found) return notFound();
  const body = await readTopicBody(request);
  if (body instanceof Response) return body;
  try { return Response.json(await reviewTopicVersion(actor.id, found.id, found.version, body)); }
  catch (error) { return topicErrorResponse(error); }
}

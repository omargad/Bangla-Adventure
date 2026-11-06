import { getStaffAccess } from "@/lib/auth";
import { decideTopic, getStaffTopic, readTopicBody, submitTopicEdit, topicErrorResponse, topicSaveFor } from "@/lib/curriculum-catalog";
import { TOPIC_ID_PATTERN } from "@/lib/topic-model";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };
const notFound = () => Response.json({ error: "Topic not found.", errorBn: "বিষয়টি পাওয়া যায়নি।" }, { status: 404 });

/** The newest version (for editing), the full version history, and whether this account's save publishes at once (onSave). */
export async function GET(_request: Request, context: RouteContext) {
  const actor = await getStaffAccess("teach");
  if (actor instanceof Response) return actor;
  const { id } = await context.params;
  if (!TOPIC_ID_PATTERN.test(id)) return notFound();
  try { return Response.json({ topic: await getStaffTopic(id), onSave: await topicSaveFor(actor.id, id) }); }
  catch (error) { return topicErrorResponse(error); }
}

/** Saves an edit as a new version: it waits for approval (students keep the approved one) or is published at once (an administrator's own edit, or a teacher's while their topics need no approval). */
export async function PUT(request: Request, context: RouteContext) {
  const actor = await getStaffAccess("teach");
  if (actor instanceof Response) return actor;
  const { id } = await context.params;
  if (!TOPIC_ID_PATTERN.test(id)) return notFound();
  const body = await readTopicBody(request);
  if (body instanceof Response) return body;
  try { return Response.json(await submitTopicEdit(actor.id, id, body)); }
  catch (error) { return topicErrorResponse(error); }
}

/**
 * A decision on the topic students read: withdraw it (with a reason), approve a withdrawn topic
 * again, or confirm a review of a baseline topic. Approving and confirming need the read tick.
 */
export async function POST(request: Request, context: RouteContext) {
  const actor = await getStaffAccess("admin");
  if (actor instanceof Response) return actor;
  const { id } = await context.params;
  if (!TOPIC_ID_PATTERN.test(id)) return notFound();
  const body = await readTopicBody(request);
  if (body instanceof Response) return body;
  try { return Response.json(await decideTopic(actor.id, id, body)); }
  catch (error) { return topicErrorResponse(error); }
}

import { getStaffAccess } from "@/lib/auth";
import { getStaffTopic, readTopicBody, submitTopicEdit, topicErrorResponse } from "@/lib/curriculum-catalog";
import { TOPIC_ID_PATTERN } from "@/lib/topic-model";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };
const notFound = () => Response.json({ error: "Topic not found.", errorBn: "বিষয়টি পাওয়া যায়নি।" }, { status: 404 });

/** The newest version (for editing) and the full version history. */
export async function GET(_request: Request, context: RouteContext) {
  const actor = await getStaffAccess("teach");
  if (actor instanceof Response) return actor;
  const { id } = await context.params;
  if (!TOPIC_ID_PATTERN.test(id)) return notFound();
  try { return Response.json({ topic: await getStaffTopic(id) }); }
  catch (error) { return topicErrorResponse(error); }
}

/** Saves an edit as a new pending version; students keep the approved one. */
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

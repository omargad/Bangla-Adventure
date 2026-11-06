import { getStaffAccess } from "@/lib/auth";
import { createTopic, listStaffTopics, readTopicBody, topicErrorResponse, topicPublishing } from "@/lib/curriculum-catalog";

export const dynamic = "force-dynamic";

/** Staff topics area: every topic with its approval state, and whether this account's saves publish at once or wait. */
export async function GET() {
  const actor = await getStaffAccess("teach");
  if (actor instanceof Response) return actor;
  try {
    const topics = await listStaffTopics();
    return Response.json({ topics, pendingCount: topics.filter((topic) => topic.pendingVersions.length > 0).length, publishing: await topicPublishing(actor.id) });
  } catch (error) { return topicErrorResponse(error); }
}

/**
 * A teacher or administrator writes a new topic. An administrator's is published at once, and so is a
 * teacher's while their topics do not need approval; otherwise it waits for an administrator.
 */
export async function POST(request: Request) {
  const actor = await getStaffAccess("teach");
  if (actor instanceof Response) return actor;
  const body = await readTopicBody(request);
  if (body instanceof Response) return body;
  try { return Response.json(await createTopic(actor.id, body), { status: 201 }); }
  catch (error) { return topicErrorResponse(error); }
}

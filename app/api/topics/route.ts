import { getStaffAccess } from "@/lib/auth";
import { createTopic, listStaffTopics, readTopicBody, topicErrorResponse } from "@/lib/curriculum-catalog";

export const dynamic = "force-dynamic";

/** Staff topics area: every topic with its approval state. */
export async function GET() {
  const actor = await getStaffAccess("teach");
  if (actor instanceof Response) return actor;
  try {
    const topics = await listStaffTopics();
    return Response.json({ topics, pendingCount: topics.filter((topic) => topic.pendingVersions.length > 0).length });
  } catch (error) { return topicErrorResponse(error); }
}

/** A teacher or administrator writes a new topic; it waits for approval before students see it. */
export async function POST(request: Request) {
  const actor = await getStaffAccess("teach");
  if (actor instanceof Response) return actor;
  const body = await readTopicBody(request);
  if (body instanceof Response) return body;
  try { return Response.json(await createTopic(actor.id, body), { status: 201 }); }
  catch (error) { return topicErrorResponse(error); }
}

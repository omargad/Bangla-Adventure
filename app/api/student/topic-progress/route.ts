import { getSessionStudent } from "@/lib/student-auth";
import { getDb } from "@/db";
import { studentTopicProgress } from "@/db/schema";
import { topics } from "@/app/topics-content";
export async function POST(request: Request) {
  const student = await getSessionStudent();
  if (!student) return Response.json({ error: "Student sign in required." }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || !topics.some((topic) => topic.id === body.topicId)) return Response.json({ error: "Choose a valid learning topic." }, { status: 400 });
  const db = await getDb();
  await db.insert(studentTopicProgress).values({ studentId: student.id, topicId: body.topicId }).onConflictDoNothing();
  return Response.json({ read: true });
}

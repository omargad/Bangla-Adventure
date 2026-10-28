import { getSessionAdult } from "@/lib/auth";
import { getSessionStudent } from "@/lib/student-auth";
import { getCatalog, topicReferences } from "@/lib/curriculum-catalog";
import { getDb } from "@/db";
import { studentTopicProgress } from "@/db/schema";
import { eq } from "drizzle-orm";
export const dynamic = "force-dynamic";
export async function GET() {
  const student = await getSessionStudent();
  const adult = await getSessionAdult();
  if (!student && !adult) return Response.json({ error: "Sign in to view learning topics." }, { status: 401 });
  try {
    const catalog = await getCatalog();
    const db = await getDb();
    const read = student ? db.select({ topicId: studentTopicProgress.topicId }).from(studentTopicProgress).where(eq(studentTopicProgress.studentId, student.id)).all().map((row) => row.topicId) : [];
    return Response.json({ topics: catalog.map((topic) => ({ ...topic, references: topicReferences(topic) })), readTopicIds: read, learnerId: student?.id ?? null, canRecordProgress: Boolean(student), reviewStatus: "draft-for-educator-review" });
  } catch { return Response.json({ error: "Learning topics are temporarily unavailable. Please retry." }, { status: 503 }); }
}

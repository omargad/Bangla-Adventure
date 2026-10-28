import { getSessionAdult } from "@/lib/auth";
import { getSessionStudent, passwordChangeRequired } from "@/lib/student-auth";
import { getCatalog, topicReferences } from "@/lib/curriculum-catalog";
import { getDb } from "@/db";
import { studentTopicProgress } from "@/db/schema";
import { eq } from "drizzle-orm";
export const dynamic = "force-dynamic";
export async function GET() {
  const session = await getSessionStudent();
  const adult = await getSessionAdult();
  if (!session && !adult) return Response.json({ error: "Sign in to view learning topics." }, { status: 401 });
  if (session?.mustChangePassword && !adult) return passwordChangeRequired();
  // A student still on a temporary password never has their progress read or recorded here.
  const student = session?.mustChangePassword ? null : session;
  try {
    const catalog = await getCatalog();
    const db = await getDb();
    const read = student ? db.select({ topicId: studentTopicProgress.topicId }).from(studentTopicProgress).where(eq(studentTopicProgress.studentId, student.id)).all().map((row) => row.topicId) : [];
    return Response.json({ topics: catalog.map((topic) => ({ ...topic, references: topicReferences(topic) })), readTopicIds: read, learnerId: student?.id ?? null, canRecordProgress: Boolean(student), reviewStatus: "draft-for-educator-review" });
  } catch { return Response.json({ error: "Learning topics are temporarily unavailable. Please retry." }, { status: 503 }); }
}

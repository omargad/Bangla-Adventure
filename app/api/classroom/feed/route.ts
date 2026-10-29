import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { activitySubmissions, classActivities } from "../../../../db/schema";
import { listAnnouncements } from "@/lib/class-announcements";
import type { QuizQuestion } from "@/lib/classroom";
import { getStudentFromRequest } from "@/lib/classroom-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const student = await getStudentFromRequest(request);
  if (!student) return Response.json({ error: "Join a class first." }, { status: 401 });

  try {
    const db = await getDb();
    // Posts for everyone in the class and for students; parents-only posts stay out.
    const announcements = listAnnouncements(db, [student.classId], "student");
    const activities = await db
      .select()
      .from(classActivities)
      .where(eq(classActivities.classId, student.classId))
      .orderBy(desc(classActivities.createdAt));
    const submissions = await db
      .select()
      .from(activitySubmissions)
      .where(eq(activitySubmissions.studentId, student.id));

    return Response.json({
      student: { id: student.id, displayName: student.displayName },
      class: { id: student.classId, name: student.className, teacherName: student.teacherName },
      announcements,
      activities: activities.map((activity) => {
        const submission = submissions.find((item) => item.activityId === activity.id);
        return {
          id: activity.id,
          title: activity.title,
          instructions: activity.instructions,
          topicId: activity.topicId,
          status: activity.status,
          createdAt: activity.createdAt,
          // Students receive prompts and options only — never the answer key.
          questions: parseQuestions(activity.questionsJson).map((question) => ({
            prompt: question.prompt,
            options: question.options,
          })),
          submission: submission
            ? { score: submission.score, total: submission.total, submittedAt: submission.submittedAt }
            : null,
        };
      }),
    });
  } catch (error) {
    return databaseError(error);
  }
}

function parseQuestions(json: string): QuizQuestion[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as QuizQuestion[]) : [];
  } catch {
    return [];
  }
}

function databaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected database error";
  const unavailable = message.includes("no such table") || message.includes("SQLITE");
  return Response.json({ error: unavailable ? "The classroom service is still being set up." : message }, { status: 500 });
}

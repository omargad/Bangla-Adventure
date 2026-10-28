import { desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import {
  activitySubmissions,
  classActivities,
  classAnnouncements,
  classStudents,
} from "../../../../db/schema";
import { getSessionAdult } from "@/lib/auth";
import { canTeach } from "@/lib/roles";
import { deleteClass, findManagedClass } from "@/lib/class-access";
import type { QuizQuestion } from "@/lib/classroom";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const user = await getSessionAdult();
  if (user && !canTeach(user)) return Response.json({ error: "An approved teacher account is required." }, { status: 403 });
  if (!user) return Response.json({ error: "Sign in to view this class." }, { status: 401 });

  try {
    const { id } = await context.params;
    // Administrators manage every class; teachers only their own.
    const classroom = await findManagedClass(user, id);
    if (!classroom) return Response.json({ error: "Class not found." }, { status: 404 });

    const db = await getDb();
    const students = await db.select({ id: classStudents.id, displayName: classStudents.displayName, createdAt: classStudents.createdAt }).from(classStudents).where(eq(classStudents.classId, id)).orderBy(desc(classStudents.createdAt));
    const activities = await db.select().from(classActivities).where(eq(classActivities.classId, id)).orderBy(desc(classActivities.createdAt));
    const announcements = await db.select().from(classAnnouncements).where(eq(classAnnouncements.classId, id)).orderBy(desc(classAnnouncements.createdAt));
    const activityIds = activities.map((activity) => activity.id);
    const submissions = activityIds.length
      ? await db.select().from(activitySubmissions).where(inArray(activitySubmissions.activityId, activityIds)).orderBy(desc(activitySubmissions.submittedAt))
      : [];

    return Response.json({
      class: classroom,
      students,
      announcements,
      activities: activities.map((activity) => ({
        ...activity,
        questions: parseQuestions(activity.questionsJson),
        questionsJson: undefined,
        submissions: submissions
          .filter((submission) => submission.activityId === activity.id)
          .map((submission) => ({
            ...submission,
            answers: parseAnswers(submission.answersJson),
            answersJson: undefined,
            studentName: students.find((student) => student.id === submission.studentId)?.displayName ?? "(left the class)",
          })),
      })),
    });
  } catch (error) {
    return databaseError(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const user = await getSessionAdult();
  if (user && !canTeach(user)) return Response.json({ error: "An approved teacher account is required." }, { status: 403 });
  if (!user) return Response.json({ error: "Sign in to manage this class." }, { status: 401 });

  try {
    const { id } = await context.params;
    if (!(await deleteClass(user, id))) return Response.json({ error: "Class not found." }, { status: 404 });
    return Response.json({ ok: true });
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

function parseAnswers(json: string): number[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((item): item is number => typeof item === "number") : [];
  } catch {
    return [];
  }
}

function databaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected database error";
  const unavailable = message.includes("no such table") || message.includes("SQLITE");
  return Response.json({ error: unavailable ? "The classroom service is still being set up." : message }, { status: 500 });
}

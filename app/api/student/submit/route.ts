import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { activitySubmissions, classActivities, studentClassEnrollments } from "@/db/schema";
import type { QuizQuestion } from "@/lib/classroom";
import { gradeAnswers } from "@/lib/classroom";
import { checkRateLimit, clientKey, tooManyRequests } from "@/lib/rate-limit";
import { getStudentAccess } from "@/lib/student-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const limit = checkRateLimit(`student-submit:${clientKey(request)}`, 60, 10 * 60 * 1000);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

  const student = await getStudentAccess();
  if (student instanceof Response) return student;

  try {
    const body = (await request.json().catch(() => ({}))) as { activityId?: unknown; answers?: unknown };
    const activityId = typeof body.activityId === "string" ? body.activityId : "";
    if (!activityId) return Response.json({ error: "Choose an activity." }, { status: 400 });

    const db = await getDb();
    const [activity] = await db.select().from(classActivities).where(eq(classActivities.id, activityId)).limit(1);
    if (!activity) return Response.json({ error: "Activity not found." }, { status: 404 });
    if (activity.status !== "open") return Response.json({ error: "This activity is closed." }, { status: 409 });

    const [enrollment] = await db
      .select({ classStudentId: studentClassEnrollments.classStudentId })
      .from(studentClassEnrollments)
      .where(and(eq(studentClassEnrollments.studentId, student.id), eq(studentClassEnrollments.classId, activity.classId), eq(studentClassEnrollments.active, true)))
      .limit(1);
    if (!enrollment) return Response.json({ error: "Your teacher must allocate you to this class before you can submit." }, { status: 403 });

    const questions = parseQuestions(activity.questionsJson);
    if (!questions.length || !Array.isArray(body.answers) || body.answers.length !== questions.length ||
      !body.answers.every((answer, index) => Number.isInteger(answer) && answer >= 0 && answer < questions[index].options.length)) {
      return Response.json({ error: "Answer every question with one of the available options." }, { status: 400 });
    }
    const { score, total, picked } = gradeAnswers(questions, body.answers);
    await db.insert(activitySubmissions).values({
      id: crypto.randomUUID(),
      activityId,
      studentId: enrollment.classStudentId,
      answersJson: JSON.stringify(picked),
      score,
      total,
      submittedAt: new Date().toISOString(),
    }).onConflictDoUpdate({ target: [activitySubmissions.activityId, activitySubmissions.studentId],
      set: { answersJson: JSON.stringify(picked), score, total, submittedAt: new Date().toISOString() } });

    return Response.json({
      score,
      total,
      review: questions.map((question, index) => ({
        prompt: question.prompt,
        picked: picked[index],
        answer: question.answer,
        correct: picked[index] === question.answer,
      })),
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
  return Response.json({ error: unavailable ? "The student service is still being set up." : message }, { status: 500 });
}

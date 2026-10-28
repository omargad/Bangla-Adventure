import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { activitySubmissions, adults, classActivities, classes, studentClassEnrollments } from "@/db/schema";
import { getSessionStudent } from "@/lib/student-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const student = await getSessionStudent();
  if (!student) return Response.json({ error: "Student sign in required." }, { status: 401 });

  try {
    const db = await getDb();
    const enrollments = await db
      .select({ classStudentId: studentClassEnrollments.classStudentId, classId: classes.id, className: classes.name, teacherName: adults.displayName })
      .from(studentClassEnrollments)
      .innerJoin(classes, eq(studentClassEnrollments.classId, classes.id))
      .innerJoin(adults, eq(classes.teacherId, adults.id))
      .where(and(eq(studentClassEnrollments.studentId, student.id), eq(studentClassEnrollments.active, true)));
    const classStudentIds = enrollments.map((item) => item.classStudentId);
    const submissions = classStudentIds.length
      ? await db.select().from(activitySubmissions).where(inArray(activitySubmissions.studentId, classStudentIds)).orderBy(desc(activitySubmissions.submittedAt))
      : [];
    const activityIds = submissions.map((submission) => submission.activityId);
    const activities = activityIds.length ? await db.select().from(classActivities).where(inArray(classActivities.id, activityIds)) : [];

    const results = submissions.map((submission) => {
      const activity = activities.find((item) => item.id === submission.activityId);
      const enrollment = enrollments.find((item) => item.classStudentId === submission.studentId);
      return {
        id: submission.id,
        activityId: submission.activityId,
        activityTitle: activity?.title ?? "Activity",
        className: enrollment?.className ?? "Class",
        teacherName: enrollment?.teacherName ?? "Teacher",
        score: submission.score,
        total: submission.total,
        percent: submission.total ? Math.round((submission.score / submission.total) * 100) : 0,
        submittedAt: submission.submittedAt,
      };
    });
    const totalQuestions = results.reduce((sum, item) => sum + item.total, 0);
    const totalScore = results.reduce((sum, item) => sum + item.score, 0);

    return Response.json({
      student,
      summary: {
        attempts: results.length,
        averagePercent: totalQuestions ? Math.round((totalScore / totalQuestions) * 100) : 0,
        bestPercent: results.reduce((best, item) => Math.max(best, item.percent), 0),
      },
      results,
    });
  } catch (error) {
    return databaseError(error);
  }
}

function databaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected database error";
  const unavailable = message.includes("no such table") || message.includes("SQLITE");
  return Response.json({ error: unavailable ? "The student service is still being set up." : message }, { status: 500 });
}

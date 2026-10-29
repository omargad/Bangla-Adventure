import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import {
  activitySubmissions,
  adults,
  classActivities,
  classStudents,
  classes,
  studentClassEnrollments,
} from "@/db/schema";
import type { QuizQuestion } from "@/lib/classroom";
import { listAnnouncements } from "@/lib/class-announcements";
import { attendanceKey, studentAttendance } from "@/lib/class-attendance";
import { getStudentAccess } from "@/lib/student-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const student = await getStudentAccess();
  if (student instanceof Response) return student;

  try {
    const db = await getDb();
    const enrollments = await db
      .select({
        id: studentClassEnrollments.id,
        classStudentId: studentClassEnrollments.classStudentId,
        classId: classes.id,
        className: classes.name,
        teacherName: adults.displayName,
        joinedAt: studentClassEnrollments.createdAt,
      })
      .from(studentClassEnrollments)
      .innerJoin(classes, eq(studentClassEnrollments.classId, classes.id))
      .innerJoin(adults, eq(classes.teacherId, adults.id))
      .innerJoin(classStudents, eq(studentClassEnrollments.classStudentId, classStudents.id))
      .where(and(eq(studentClassEnrollments.studentId, student.id), eq(studentClassEnrollments.active, true)))
      .orderBy(desc(studentClassEnrollments.createdAt));

    const classIds = enrollments.map((item) => item.classId);
    const classStudentIds = enrollments.map((item) => item.classStudentId);
    // Posts for everyone in the class and for students; parents-only posts stay out.
    const announcements = listAnnouncements(db, classIds, "student");
    const activities = classIds.length
      ? await db.select().from(classActivities).where(inArray(classActivities.classId, classIds)).orderBy(desc(classActivities.createdAt))
      : [];
    const submissions = classStudentIds.length
      ? await db.select().from(activitySubmissions).where(inArray(activitySubmissions.studentId, classStudentIds))
      : [];

    const attendance = studentAttendance(db, [student.id]);
    const classAttendance = (classId: string) => attendance.get(attendanceKey(student.id, classId)) ?? { attended: 0, recorded: 0 };
    const scored = submissions.filter((submission) => submission.total > 0);
    const totalScore = scored.reduce((sum, submission) => sum + submission.score, 0);
    const totalQuestions = scored.reduce((sum, submission) => sum + submission.total, 0);
    const bestPercent = scored.reduce((best, submission) => Math.max(best, Math.round((submission.score / submission.total) * 100)), 0);

    return Response.json({
      student,
      metrics: {
        enrolledClasses: enrollments.length,
        assignedActivities: activities.length,
        completedActivities: submissions.length,
        averagePercent: totalQuestions ? Math.round((totalScore / totalQuestions) * 100) : 0,
        bestPercent,
        attendedSessions: enrollments.reduce((sum, enrollment) => sum + classAttendance(enrollment.classId).attended, 0),
        recordedSessions: enrollments.reduce((sum, enrollment) => sum + classAttendance(enrollment.classId).recorded, 0),
      },
      classes: enrollments.map((enrollment) => ({
        id: enrollment.classId,
        name: enrollment.className,
        teacherName: enrollment.teacherName,
        joinedAt: enrollment.joinedAt,
        attendance: classAttendance(enrollment.classId),
        announcements: announcements.filter((item) => item.classId === enrollment.classId),
        activities: activities.filter((activity) => activity.classId === enrollment.classId).map((activity) => {
          const submission = submissions.find((item) => item.activityId === activity.id && item.studentId === enrollment.classStudentId);
          return {
            id: activity.id,
            title: activity.title,
            instructions: activity.instructions,
            topicId: activity.topicId,
            status: activity.status,
            createdAt: activity.createdAt,
            questions: parseQuestions(activity.questionsJson).map((question) => ({ prompt: question.prompt, options: question.options })),
            submission: submission ? { score: submission.score, total: submission.total, submittedAt: submission.submittedAt } : null,
          };
        }),
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

import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { activitySubmissions, classActivities, classes } from "@/db/schema";
import { getSessionAdult } from "@/lib/auth";
import { canTeach } from "@/lib/roles";
import { managedClass } from "@/lib/class-access";
import { classAttendanceSummaries } from "@/lib/class-attendance";
import { currentMembers } from "@/lib/class-roster";
import { scorePercent } from "@/lib/classroom";
import { attachmentDisposition, csvRows } from "@/lib/csv";
import { buildGradebook, gradebookCsvRows } from "@/lib/gradebook";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const user = await getSessionAdult();
  if (user && !canTeach(user)) return Response.json({ error: "An approved teacher account is required." }, { status: 403 });
  if (!user) return Response.json({ error: "Sign in to export grades." }, { status: 401 });

  try {
    const { id } = await context.params;
    const db = await getDb();
    // Administrators manage results in every class; teachers only in their own.
    const [classroom] = await db.select().from(classes).where(managedClass(user, id)).limit(1);
    if (!classroom) return Response.json({ error: "Class not found." }, { status: 404 });

    const activities = await db.select().from(classActivities).where(eq(classActivities.classId, id));
    const activityIds = activities.map((activity) => activity.id);
    // Only students now in the class: a removed student's work is kept but not reported.
    const attendance = classAttendanceSummaries(db, id);
    const students = currentMembers(db, [id]).map((student) => ({ ...student, attendance: student.studentId ? attendance.get(student.studentId) ?? { attended: 0, recorded: 0 } : null }));
    const members = new Set(students.map((student) => student.id));
    const submissions = activityIds.length ? (await db.select().from(activitySubmissions).where(inArray(activitySubmissions.activityId, activityIds))).filter((submission) => members.has(submission.studentId)) : [];
    const rows = submissions.map((submission) => {
      const activity = activities.find((item) => item.id === submission.activityId);
      const student = students.find((item) => item.id === submission.studentId);
      return {
        submissionId: submission.id,
        activityId: submission.activityId,
        studentId: submission.studentId,
        className: classroom.name,
        activityTitle: activity?.title ?? "Activity",
        studentName: student?.displayName ?? "Unknown student",
        score: submission.score,
        total: submission.total,
        percent: scorePercent(submission.score, submission.total),
        submittedAt: submission.submittedAt,
      };
    });
    const gradebook = buildGradebook(students, activities.map((activity) => ({ ...activity, submissions: submissions.filter((submission) => submission.activityId === activity.id) })));

    const url = new URL(request.url);
    if (url.searchParams.get("format") === "csv") {
      return new Response(csvRows(gradebookCsvRows(classroom.name, gradebook)), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": attachmentDisposition(classroom.name, "-grades.csv", "class"),
        },
      });
    }

    return Response.json({ class: classroom, rows, gradebook });
  } catch (error) {
    return databaseError(error);
  }
}

function databaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected database error";
  const unavailable = message.includes("no such table") || message.includes("SQLITE");
  return Response.json({ error: unavailable ? "The grades service is still being set up." : message }, { status: 500 });
}

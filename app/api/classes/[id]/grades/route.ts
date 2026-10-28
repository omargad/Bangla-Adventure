import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { activitySubmissions, classActivities, classStudents, classes } from "@/db/schema";
import { getSessionAdult } from "@/lib/auth";
import { canTeach } from "@/lib/roles";
import { managedClass } from "@/lib/class-access";
import { csvCell, scorePercent } from "@/lib/classroom";
import { attachmentDisposition } from "@/lib/csv";

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
    const submissions = activityIds.length ? await db.select().from(activitySubmissions).where(inArray(activitySubmissions.activityId, activityIds)) : [];
    const students = await db.select().from(classStudents).where(eq(classStudents.classId, id));
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

    const url = new URL(request.url);
    if (url.searchParams.get("format") === "csv") {
      const header = ["Class", "Activity", "Student", "Score", "Total", "Percent", "Submitted At"];
      const csv = [header, ...rows.map((row) => [row.className, row.activityTitle, row.studentName, row.score, row.total, row.percent, row.submittedAt])]
        .map((row) => row.map(csvCell).join(","))
        .join("\n");
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": attachmentDisposition(classroom.name, "-grades.csv", "class"),
        },
      });
    }

    return Response.json({ class: classroom, rows });
  } catch (error) {
    return databaseError(error);
  }
}

function databaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected database error";
  const unavailable = message.includes("no such table") || message.includes("SQLITE");
  return Response.json({ error: unavailable ? "The grades service is still being set up." : message }, { status: 500 });
}

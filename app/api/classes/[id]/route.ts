import { desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import {
  activitySubmissions,
  classActivities,
} from "../../../../db/schema";
import { getSessionAdult, getStaffAccess } from "@/lib/auth";
import { canTeach } from "@/lib/roles";
import { deleteClass, findManagedClass } from "@/lib/class-access";
import { classAttendanceSummaries } from "@/lib/class-attendance";
import { listAnnouncements } from "@/lib/class-announcements";
import { changeClassTeacher } from "@/lib/class-management";
import { currentMembers } from "@/lib/class-roster";
import type { QuizQuestion } from "@/lib/classroom";
import { UserManagementError } from "@/lib/user-management";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const user = await getSessionAdult();
  if (user && !canTeach(user)) return Response.json({ error: "An approved teacher account is required.", errorBn: "অনুমোদিত শিক্ষকের অ্যাকাউন্ট প্রয়োজন।" }, { status: 403 });
  if (!user) return Response.json({ error: "Sign in to view this class.", errorBn: "ক্লাসটি দেখতে সাইন ইন করুন।" }, { status: 401 });

  try {
    const { id } = await context.params;
    // Administrators manage every class; teachers only their own.
    const classroom = await findManagedClass(user, id);
    if (!classroom) return Response.json({ error: "Class not found.", errorBn: "ক্লাসটি পাওয়া যায়নি।" }, { status: 404 });

    const db = await getDb();
    // The students now in the class, A–Z, with their attendance; removed students and their work are left out.
    const attendance = classAttendanceSummaries(db, id);
    const students = currentMembers(db, [id]).map(({ id: rosterId, studentId, username, displayName, createdAt }) => ({
      id: rosterId, studentId, username, displayName, createdAt,
      attendance: studentId ? attendance.get(studentId) ?? { attended: 0, recorded: 0 } : null,
    }));
    const members = new Set(students.map((student) => student.id));
    const activities = await db.select().from(classActivities).where(eq(classActivities.classId, id)).orderBy(desc(classActivities.createdAt));
    // Every audience, with who posted each one.
    const announcements = listAnnouncements(db, [id]);
    const activityIds = activities.map((activity) => activity.id);
    const submissions = activityIds.length
      ? (await db.select().from(activitySubmissions).where(inArray(activitySubmissions.activityId, activityIds)).orderBy(desc(activitySubmissions.submittedAt))).filter((submission) => members.has(submission.studentId))
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
            studentName: students.find((student) => student.id === submission.studentId)?.displayName ?? "",
          })),
      })),
    });
  } catch (error) {
    return databaseError(error);
  }
}

/** An administrator gives the class to another approved teacher: { teacherId }. */
export async function PATCH(request: Request, context: RouteContext) {
  const actor = await getStaffAccess("admin");
  if (actor instanceof Response) return actor;
  const body = (await request.json().catch(() => null)) as { teacherId?: unknown } | null;
  if (!body || typeof body.teacherId !== "string" || !body.teacherId || body.teacherId.length > 80) {
    return Response.json({ error: "Choose an approved teacher.", errorBn: "একজন অনুমোদিত শিক্ষক বেছে নিন।" }, { status: 400 });
  }
  try {
    return Response.json(await changeClassTeacher(actor.id, (await context.params).id, body.teacherId));
  } catch (error) {
    return databaseError(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const user = await getSessionAdult();
  if (user && !canTeach(user)) return Response.json({ error: "An approved teacher account is required.", errorBn: "অনুমোদিত শিক্ষকের অ্যাকাউন্ট প্রয়োজন।" }, { status: 403 });
  if (!user) return Response.json({ error: "Sign in to manage this class.", errorBn: "ক্লাসটি পরিচালনা করতে সাইন ইন করুন।" }, { status: 401 });

  try {
    const { id } = await context.params;
    if (!(await deleteClass(user, id))) return Response.json({ error: "Class not found.", errorBn: "ক্লাসটি পাওয়া যায়নি।" }, { status: 404 });
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
  if (error instanceof UserManagementError) return Response.json({ error: error.message, errorBn: error.messageBn }, { status: error.status });
  const message = error instanceof Error ? error.message : "Unexpected database error";
  const unavailable = message.includes("no such table") || message.includes("SQLITE");
  return Response.json(unavailable
    ? { error: "The classroom service is still being set up.", errorBn: "ক্লাসরুম সেবাটি এখনো চালু করা হচ্ছে।" }
    : { error: message, errorBn: "ক্লাসের তথ্য এখন পাওয়া যাচ্ছে না। একটু পরে আবার চেষ্টা করুন।" }, { status: 500 });
}

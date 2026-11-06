import { desc, eq, getTableColumns, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { activitySubmissions, adults, classActivities, classes } from "../../../db/schema";
import { getSessionAdult } from "@/lib/auth";
import { canManageUsers, canTeach } from "@/lib/roles";
import { canStillTeach, createClassForTeacher, createOwnClass } from "@/lib/class-management";
import { classServerError } from "@/lib/class-errors";
import { currentMembers } from "@/lib/class-roster";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionAdult();
  if (user && !canTeach(user)) return Response.json({ error: "An approved teacher account is required.", errorBn: "অনুমোদিত শিক্ষকের অ্যাকাউন্ট প্রয়োজন।" }, { status: 403 });
  if (!user) return Response.json({ error: "Sign in to manage your classes.", errorBn: "আপনার ক্লাসগুলো দেখতে সাইন ইন করুন।" }, { status: 401 });

  try {
    const db = await getDb();
    const all = new URL(request.url).searchParams.get("scope") === "all";
    if (all && user.role !== "admin") return Response.json({ error: "Administrator access required.", errorBn: "প্রশাসকের অ্যাকাউন্ট প্রয়োজন।" }, { status: 403 });
    // Administrators see every class with the owning teacher's name, and whether that teacher can still
    // teach it (an approved, active teacher or administrator): a class whose teacher was suspended,
    // demoted or declined needs a new teacher. Teachers see their own.
    const teacherClasses: Array<typeof classes.$inferSelect & { teacherName?: string; teacherActive?: boolean }> = all
      ? (await db.select({ ...getTableColumns(classes), teacherName: adults.displayName, teacherRole: adults.role, teacherAccountStatus: adults.status, teacherStatus: adults.teacherStatus, teacherApproval: adults.approvalStatus })
        .from(classes).innerJoin(adults, eq(classes.teacherId, adults.id)).orderBy(desc(classes.createdAt)))
        .map(({ teacherRole, teacherAccountStatus, teacherStatus, teacherApproval, ...item }) => ({
          ...item, teacherActive: canStillTeach({ role: teacherRole, status: teacherAccountStatus, teacherStatus, approvalStatus: teacherApproval }),
        }))
      : await db.select().from(classes).where(eq(classes.teacherId, user.id)).orderBy(desc(classes.createdAt));
    const classIds = teacherClasses.map((item) => item.id);
    // Counts cover the students now in each class, not those whose allocation was removed.
    const students = currentMembers(db, classIds);
    const members = new Set(students.map((student) => student.id));
    const activities = classIds.length ? await db.select().from(classActivities).where(inArray(classActivities.classId, classIds)) : [];
    const activityIds = activities.map((item) => item.id);
    const submissions = activityIds.length
      ? (await db.select().from(activitySubmissions).where(inArray(activitySubmissions.activityId, activityIds))).filter((submission) => members.has(submission.studentId))
      : [];

    return Response.json({
      classes: teacherClasses.map((item) => ({
        ...item,
        studentCount: students.filter((student) => student.classId === item.id).length,
        activityCount: activities.filter((activity) => activity.classId === item.id).length,
        submissionCount: submissions.filter((submission) =>
          activities.some((activity) => activity.id === submission.activityId && activity.classId === item.id),
        ).length,
      })),
    });
  } catch (error) {
    return classServerError(error);
  }
}

export async function POST(request: Request) {
  const user = await getSessionAdult();
  if (user && !canTeach(user)) return Response.json({ error: "An approved teacher account is required.", errorBn: "অনুমোদিত শিক্ষকের অ্যাকাউন্ট প্রয়োজন।" }, { status: 403 });
  if (!user) return Response.json({ error: "Sign in to create a class.", errorBn: "ক্লাস তৈরি করতে সাইন ইন করুন।" }, { status: 401 });

  try {
    const body = (await request.json().catch(() => ({}))) as { name?: unknown; teacherId?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 60) return Response.json({ error: "Give the class a name of 1–60 characters.", errorBn: "ক্লাসের নাম ১–৬০ অক্ষরের মধ্যে দিন।" }, { status: 400 });
    // Administrators may create a class for an approved teacher; teachers create their own.
    if (body.teacherId !== undefined && body.teacherId !== user.id) {
      if (!canManageUsers(user)) return Response.json({ error: "Only an administrator can create a class for another teacher.", errorBn: "শুধু প্রশাসক অন্য শিক্ষকের জন্য ক্লাস তৈরি করতে পারেন।" }, { status: 403 });
      if (typeof body.teacherId !== "string" || !body.teacherId || body.teacherId.length > 80) return Response.json({ error: "Choose an approved teacher.", errorBn: "একজন অনুমোদিত শিক্ষক বেছে নিন।" }, { status: 400 });
      const created = await createClassForTeacher(user.id, name, body.teacherId);
      return Response.json({ class: { ...created, studentCount: 0, activityCount: 0, submissionCount: 0 } }, { status: 201 });
    }

    // A teacher's own class, audited as class-created.
    const created = await createOwnClass(user.id, name);
    return Response.json({ class: { ...created, studentCount: 0, activityCount: 0, submissionCount: 0 } }, { status: 201 });
  } catch (error) {
    return classServerError(error);
  }
}

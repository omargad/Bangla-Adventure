import { desc, eq, getTableColumns, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { activitySubmissions, adults, classActivities, classStudents, classes } from "../../../db/schema";
import { getSessionAdult } from "@/lib/auth";
import { canTeach } from "@/lib/roles";
import { generateJoinCode } from "@/lib/classroom";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionAdult();
  if (user && !canTeach(user)) return Response.json({ error: "An approved teacher account is required.", errorBn: "অনুমোদিত শিক্ষকের অ্যাকাউন্ট প্রয়োজন।" }, { status: 403 });
  if (!user) return Response.json({ error: "Sign in to manage your classes.", errorBn: "আপনার ক্লাসগুলো দেখতে সাইন ইন করুন।" }, { status: 401 });

  try {
    const db = await getDb();
    const all = new URL(request.url).searchParams.get("scope") === "all";
    if (all && user.role !== "admin") return Response.json({ error: "Administrator access required.", errorBn: "প্রশাসকের অ্যাকাউন্ট প্রয়োজন।" }, { status: 403 });
    // Administrators see every class with the owning teacher's name; teachers see their own.
    const teacherClasses: Array<typeof classes.$inferSelect & { teacherName?: string }> = all
      ? await db.select({ ...getTableColumns(classes), teacherName: adults.displayName }).from(classes).innerJoin(adults, eq(classes.teacherId, adults.id)).orderBy(desc(classes.createdAt))
      : await db.select().from(classes).where(eq(classes.teacherId, user.id)).orderBy(desc(classes.createdAt));
    const classIds = teacherClasses.map((item) => item.id);
    const students = classIds.length ? await db.select().from(classStudents).where(inArray(classStudents.classId, classIds)) : [];
    const activities = classIds.length ? await db.select().from(classActivities).where(inArray(classActivities.classId, classIds)) : [];
    const activityIds = activities.map((item) => item.id);
    const submissions = activityIds.length
      ? await db.select().from(activitySubmissions).where(inArray(activitySubmissions.activityId, activityIds))
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
    return databaseError(error);
  }
}

export async function POST(request: Request) {
  const user = await getSessionAdult();
  if (user && !canTeach(user)) return Response.json({ error: "An approved teacher account is required.", errorBn: "অনুমোদিত শিক্ষকের অ্যাকাউন্ট প্রয়োজন।" }, { status: 403 });
  if (!user) return Response.json({ error: "Sign in to create a class.", errorBn: "ক্লাস তৈরি করতে সাইন ইন করুন।" }, { status: 401 });

  try {
    const body = (await request.json().catch(() => ({}))) as { name?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 60) return Response.json({ error: "Give the class a name of 1–60 characters.", errorBn: "ক্লাসের নাম ১–৬০ অক্ষরের মধ্যে দিন।" }, { status: 400 });

    const db = await getDb();
    // Regenerate on the (vanishingly rare) join-code collision.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const [created] = await db
          .insert(classes)
          .values({ id: crypto.randomUUID(), teacherId: user.id, name, joinCode: generateJoinCode() })
          .returning();
        return Response.json({ class: { ...created, studentCount: 0, activityCount: 0, submissionCount: 0 } }, { status: 201 });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (!message.includes("classes_join_code_unique")) throw error;
      }
    }
    return Response.json({ error: "Could not allocate a join code. Try again.", errorBn: "যোগদান কোড তৈরি করা যায়নি। আবার চেষ্টা করুন।" }, { status: 500 });
  } catch (error) {
    return databaseError(error);
  }
}

function databaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected database error";
  const unavailable = message.includes("no such table") || message.includes("SQLITE");
  return Response.json(unavailable
    ? { error: "The classroom service is still being set up.", errorBn: "ক্লাসরুম সেবাটি এখনো চালু করা হচ্ছে।" }
    : { error: message, errorBn: "ক্লাসের তথ্য এখন পাওয়া যাচ্ছে না। একটু পরে আবার চেষ্টা করুন।" }, { status: 500 });
}

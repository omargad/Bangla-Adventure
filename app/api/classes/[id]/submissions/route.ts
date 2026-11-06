import { getDb } from "@/db";
import { classes } from "@/db/schema";
import { getSessionAdult } from "@/lib/auth";
import { managedClass } from "@/lib/class-access";
import { classServerError } from "@/lib/class-errors";
import { resetSubmission } from "@/lib/grades";
import { canTeach } from "@/lib/roles";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };
const refuse = (status: number, error: string, errorBn: string) => Response.json({ error, errorBn }, { status });

export async function DELETE(request: Request, context: RouteContext) {
  const user = await getSessionAdult();
  if (user && !canTeach(user)) return refuse(403, "An approved teacher account is required.", "অনুমোদিত শিক্ষকের অ্যাকাউন্ট প্রয়োজন।");
  if (!user) return refuse(401, "Sign in to manage grades.", "গ্রেড পরিচালনা করতে সাইন ইন করুন।");

  try {
    const { id } = await context.params;
    const db = await getDb();
    // Administrators manage results in every class; teachers only in their own.
    const [classroom] = await db.select({ id: classes.id }).from(classes).where(managedClass(user, id)).limit(1);
    if (!classroom) return refuse(404, "Class not found.", "ক্লাসটি পাওয়া যায়নি।");

    const body = ((await request.json().catch(() => ({}))) ?? {}) as { submissionId?: unknown };
    const submissionId = typeof body.submissionId === "string" ? body.submissionId : "";
    if (!submissionId) return refuse(400, "Choose a submission to reset.", "রিসেট করতে একটি জমা বেছে নিন।");

    if (!(await resetSubmission(user, id, submissionId))) return refuse(404, "Submission not found.", "জমাটি পাওয়া যায়নি।");
    return Response.json({ ok: true });
  } catch (error) {
    return classServerError(error, "grades");
  }
}

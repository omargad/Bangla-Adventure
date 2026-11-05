import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { adults, curriculumDrafts } from "../../../../db/schema";
import { lessons, type CurriculumLevel } from "../../../curriculum";
import { getSessionAdult, getStaffAccess } from "@/lib/auth";
import { canPublishContent, canTeach } from "@/lib/roles";
import { LessonError } from "@/lib/lesson-model";
import { lessonErrorResponse } from "@/lib/lesson-approval";

export const dynamic = "force-dynamic";
const statuses = new Set(["draft", "ready-for-review", "approved-for-release", "archived"]);

export async function GET() {
  const user = await getSessionAdult();
  if (user && !canTeach(user)) return Response.json({ error: "An approved teacher account is required." }, { status: 403 });
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  const db = await getDb();
  const drafts = await db.select().from(curriculumDrafts).where(eq(curriculumDrafts.ownerEmail, user.email)).orderBy(desc(curriculumDrafts.updatedAt));
  return Response.json({ drafts });
}

export async function POST(request: Request) {
  const user = await getStaffAccess("teach");
  if (user instanceof Response) return user;
  const raw: unknown = await request.json().catch(() => null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return Response.json({ error: "Send a valid curriculum draft." }, { status: 400 });
  const body = raw as Record<string, unknown>;
  const id = value(body.id, 80);
  const lessonId = value(body.lessonId, 60);
  const lesson = lessons.find((item) => item.id === lessonId);
  const title = value(body.title, 120);
  const level = value(body.level, 20) as CurriculumLevel;
  const status = value(body.status, 30);
  if (status === "approved-for-release" && !canPublishContent(user)) return Response.json({ error: "Administrator approval is required to approve a curriculum draft.", errorBn: "পাঠ্যক্রমের খসড়া অনুমোদন করতে প্রশাসকের অনুমোদন প্রয়োজন।" }, { status: 403 });
  const dataJson = value(body.dataJson, 100_000);
  if (!lesson || !title || level !== lesson.level || !statuses.has(status)) return Response.json({ error: "Invalid curriculum draft." }, { status: 400 });
  try {
    JSON.parse(dataJson);
  } catch {
    return Response.json({ error: "The structured lesson draft must be valid JSON." }, { status: 400 });
  }
  try {
    const db = await getDb();
    const draft = db.transaction((tx) => {
      const actor = tx.select().from(adults).where(eq(adults.id, user.id)).get();
      if (!actor || !canTeach(actor) || actor.approvalStatus !== "approved" || actor.mustChangePassword) throw new LessonError("An approved teacher or administrator account is required.", "অনুমোদিত শিক্ষক বা প্রশাসকের অ্যাকাউন্ট প্রয়োজন।", 403);
      if (status === "approved-for-release" && !canPublishContent(actor)) throw new LessonError("Administrator approval is required to approve a curriculum draft.", "পাঠ্যক্রমের খসড়া অনুমোদন করতে প্রশাসকের অনুমোদন প্রয়োজন।", 403);
      const now = new Date().toISOString();
      if (id) {
        const owned = tx.select({ id: curriculumDrafts.id }).from(curriculumDrafts).where(and(eq(curriculumDrafts.id, id), eq(curriculumDrafts.ownerEmail, actor.email))).get();
        if (!owned) throw new LessonError("Draft not found.", "খসড়াটি পাওয়া যায়নি।", 404);
        return tx.update(curriculumDrafts).set({ lessonId, title, level, status, dataJson, updatedAt: now }).where(eq(curriculumDrafts.id, id)).returning().get();
      }
      return tx.insert(curriculumDrafts).values({ id: crypto.randomUUID(), ownerEmail: actor.email, lessonId, title, level, status, dataJson, updatedAt: now }).returning().get();
    });
    return Response.json({ draft }, { status: id ? 200 : 201 });
  } catch (error) { return lessonErrorResponse(error); }
}

function value(input: unknown, maxLength: number) {
  return typeof input === "string" ? input.trim().slice(0, maxLength) : "";
}

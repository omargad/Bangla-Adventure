import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { adults, contentReviews, curriculumDrafts, mediaAssets, videoReviews } from "../../../../db/schema";
import { lessons } from "../../../curriculum";
import { getSessionAdult } from "@/lib/auth";
import { canTeach } from "@/lib/roles";
import { readJsonObject, serverError } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const lessonIds = new Set(lessons.map((lesson) => lesson.id));
const reviewTypes = new Set(["language", "culture", "child-development", "accessibility", "video", "legal-privacy"]);
const statuses = new Set(["not-started", "in-review", "changes-requested", "approved"]);
const teacherRequired = () => Response.json({ error: "An approved teacher account is required.", errorBn: "অনুমোদিত শিক্ষকের অ্যাকাউন্ট প্রয়োজন।" }, { status: 403 });
const signInRequired = () => Response.json({ error: "Sign in required.", errorBn: "সাইন ইন করা প্রয়োজন।" }, { status: 401 });

/**
 * Every staff member's optional specialist checks, recordings and video checks
 * (shared, so colleagues see each other's work), and the caller's own retired
 * curriculum drafts. Account emails are replaced by display names.
 */
export async function GET() {
  const user = await getSessionAdult();
  if (user && !canTeach(user)) return teacherRequired();
  if (!user) return signInRequired();
  try {
    const db = await getDb();
    const [reviews, media, videos, drafts, staff] = await Promise.all([
      db.select().from(contentReviews).orderBy(desc(contentReviews.updatedAt)),
      db.select().from(mediaAssets).orderBy(desc(mediaAssets.createdAt)),
      db.select().from(videoReviews).orderBy(desc(videoReviews.updatedAt)),
      db.select().from(curriculumDrafts).where(eq(curriculumDrafts.ownerEmail, user.email)).orderBy(desc(curriculumDrafts.updatedAt)),
      db.select({ email: adults.email, name: adults.displayName }).from(adults),
    ]);
    const names = new Map(staff.map((row) => [row.email, row.name]));
    const shared = <T extends { ownerEmail: string }>({ ownerEmail, ...row }: T) => ({ ...row, recordedBy: names.get(ownerEmail) ?? null, mine: ownerEmail === user.email });
    return Response.json({ reviews: reviews.map(shared), media: media.map(shared), videos: videos.map(shared), drafts });
  } catch (error) {
    return serverError("GET /api/studio/reviews", error, { error: "Content review data is unavailable. Please try again.", errorBn: "বিষয়বস্তু পর্যালোচনার তথ্য এখন পাওয়া যাচ্ছে না। আবার চেষ্টা করুন।" });
  }
}

export async function POST(request: Request) {
  const user = await getSessionAdult();
  if (user && !canTeach(user)) return teacherRequired();
  if (!user) return signInRequired();
  const body = await readJsonObject(request);
  if (body instanceof Response) return body;
  const lessonId = value(body.lessonId, 60);
  const reviewType = value(body.reviewType, 30);
  const status = value(body.status, 30);
  const reviewerName = value(body.reviewerName, 80);
  const reviewerEmail = value(body.reviewerEmail, 120);
  const notes = value(body.notes, 1500);
  if (!lessonIds.has(lessonId) || !reviewTypes.has(reviewType) || !statuses.has(status)) return Response.json({ error: "Invalid review record.", errorBn: "পর্যালোচনার তথ্য ঠিক নেই।" }, { status: 400 });
  if (status === "approved" && !reviewerName) return Response.json({ error: "Name the reviewer before marking a check approved.", errorBn: "যাচাই অনুমোদিত চিহ্নিত করার আগে পর্যালোচকের নাম লিখুন।" }, { status: 400 });

  const db = await getDb();
  const now = new Date().toISOString();
  const existing = await db.select({ id: contentReviews.id }).from(contentReviews).where(and(eq(contentReviews.ownerEmail, user.email), eq(contentReviews.lessonId, lessonId), eq(contentReviews.reviewType, reviewType))).limit(1);
  const values = { reviewerName, reviewerEmail, status, notes, reviewedAt: status === "approved" ? now : null, updatedAt: now };
  const [review] = existing.length
    ? await db.update(contentReviews).set(values).where(eq(contentReviews.id, existing[0].id)).returning()
    : await db.insert(contentReviews).values({ id: crypto.randomUUID(), ownerEmail: user.email, lessonId, reviewType, ...values }).returning();
  return Response.json({ review }, { status: existing.length ? 200 : 201 });
}

function value(input: unknown, maxLength: number) {
  return typeof input === "string" ? input.trim().slice(0, maxLength) : "";
}

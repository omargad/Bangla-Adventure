import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { learnerProfiles, skillProgress } from "../../../db/schema";
import { lessons } from "../../curriculum";
import { getSessionAdult } from "@/lib/auth";
import { canTeach } from "@/lib/roles";
import { isLessonApproved, lessonUnavailable } from "@/lib/lesson-approval";
import { readJsonObject } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const signInRequired = () => Response.json({ error: "Sign in required.", errorBn: "সাইন ইন করা প্রয়োজন।" }, { status: 401 });
const readOnly = () => Response.json({ error: "Parent accounts have read-only access to learning records.", errorBn: "অভিভাবকের অ্যাকাউন্ট থেকে শেখার রেকর্ড শুধু দেখা যায়।" }, { status: 403 });
const profileNotFound = () => Response.json({ error: "Learner profile not found.", errorBn: "শিক্ষার্থীর প্রোফাইল পাওয়া যায়নি।" }, { status: 404 });

const lessonIds = new Set(lessons.map((lesson) => lesson.id));
const skills = new Set(["listening", "reading", "speaking", "writing", "culture", "mastery"]);

export async function GET(request: Request) {
  const user = await getSessionAdult();
  if (!user) return signInRequired();
  const profileId = new URL(request.url).searchParams.get("profileId") || "";
  const db = await getDb();
  const [profile] = await db.select({ id: learnerProfiles.id }).from(learnerProfiles).where(and(eq(learnerProfiles.id, profileId), eq(learnerProfiles.ownerEmail, user.email))).limit(1);
  if (!profile) return profileNotFound();
  const progress = await db.select().from(skillProgress).where(eq(skillProgress.profileId, profileId));
  return Response.json({ progress });
}

export async function POST(request: Request) {
  const user = await getSessionAdult();
  if (!user) return signInRequired();
  if (!canTeach(user)) return readOnly();
  const body = await readJsonObject(request);
  if (body instanceof Response) return body;
  const profileId = textValue(body.profileId, 80);
  const lessonId = textValue(body.lessonId, 60);
  const sessionId = textValue(body.sessionId, 100);
  const skill = textValue(body.skill, 20);
  const score = typeof body.score === "number" && Number.isFinite(body.score) ? Math.max(0, Math.min(100, Math.round(body.score))) : null;
  if (!profileId || !lessonIds.has(lessonId) || !sessionId.startsWith(`session-${lessonId}-`) || !skills.has(skill)) {
    return Response.json({ error: "Invalid progress event.", errorBn: "অগ্রগতির তথ্য ঠিক নেই।" }, { status: 400 });
  }
  if (!(await isLessonApproved(lessonId))) return lessonUnavailable(400);

  const db = await getDb();
  const [profile] = await db.select({ id: learnerProfiles.id }).from(learnerProfiles).where(and(eq(learnerProfiles.id, profileId), eq(learnerProfiles.ownerEmail, user.email))).limit(1);
  if (!profile) return profileNotFound();
  const now = new Date().toISOString();
  const [progress] = await db.insert(skillProgress).values({
    id: crypto.randomUUID(),
    profileId,
    lessonId,
    sessionId,
    skill,
    score,
    status: "complete",
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [skillProgress.profileId, skillProgress.sessionId],
    set: { status: "complete", score, skill, updatedAt: now },
  }).returning();
  return Response.json({ progress }, { status: 201 });
}

function textValue(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

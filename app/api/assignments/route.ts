import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { assignments, learnerProfiles } from "../../../db/schema";
import { lessons } from "../../curriculum";
import { getSessionAdult } from "@/lib/auth";
import { canTeach } from "@/lib/roles";
import { approvedLessonIds, isLessonApproved, lessonUnavailable } from "@/lib/lesson-approval";
import { learnerAssignments } from "@/lib/lesson-model";
import { readJsonObject } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const signInRequired = () => Response.json({ error: "Sign in required.", errorBn: "সাইন ইন করা প্রয়োজন।" }, { status: 401 });
const readOnly = () => Response.json({ error: "Parent accounts have read-only access to learning records.", errorBn: "অভিভাবকের অ্যাকাউন্ট থেকে শেখার রেকর্ড শুধু দেখা যায়।" }, { status: 403 });
const profileNotFound = () => Response.json({ error: "Learner profile not found.", errorBn: "শিক্ষার্থীর প্রোফাইল পাওয়া যায়নি।" }, { status: 404 });
const lessonIds = new Set(lessons.map((lesson) => lesson.id));

export async function GET(request: Request) {
  const user = await getSessionAdult();
  if (!user) return signInRequired();
  const profileId = new URL(request.url).searchParams.get("profileId");
  const db = await getDb();
  const rows = profileId
    ? await db.select().from(assignments).where(and(eq(assignments.ownerEmail, user.email), eq(assignments.profileId, profileId))).orderBy(desc(assignments.createdAt))
    : await db.select().from(assignments).where(eq(assignments.ownerEmail, user.email)).orderBy(desc(assignments.createdAt));
  return Response.json({ assignments: learnerAssignments(rows, await approvedLessonIds(), canTeach(user)) });
}

export async function POST(request: Request) {
  const user = await getSessionAdult();
  if (!user) return signInRequired();
  if (!canTeach(user)) return readOnly();
  const body = await readJsonObject(request);
  if (body instanceof Response) return body;
  const profileId = value(body.profileId, 80);
  const lessonId = value(body.lessonId, 60);
  const sessionId = value(body.sessionId, 100) || null;
  const dueAt = value(body.dueAt, 40) || null;
  if (!profileId || !lessonIds.has(lessonId) || (sessionId && !sessionId.startsWith(`session-${lessonId}-`))) {
    return Response.json({ error: "Choose a valid learner, module and session.", errorBn: "সঠিক শিক্ষার্থী, মডিউল ও সেশন বেছে নিন।" }, { status: 400 });
  }
  const lesson = lessons.find((item) => item.id === lessonId)!;
  if (!(await isLessonApproved(lessonId))) return lessonUnavailable(400);
  const db = await getDb();
  const [profile] = await db.select({ id: learnerProfiles.id }).from(learnerProfiles).where(and(eq(learnerProfiles.id, profileId), eq(learnerProfiles.ownerEmail, user.email))).limit(1);
  if (!profile) return profileNotFound();
  const [assignment] = await db.insert(assignments).values({
    id: crypto.randomUUID(),
    ownerEmail: user.email,
    profileId,
    lessonId,
    sessionId,
    dueAt,
    title: sessionId ? `${lesson.title} · ${sessionId.split("-").at(-1)}` : lesson.title,
  }).returning();
  return Response.json({ assignment }, { status: 201 });
}

export async function PATCH(request: Request) {
  const user = await getSessionAdult();
  if (!user) return signInRequired();
  if (!canTeach(user)) return readOnly();
  const body = await readJsonObject(request);
  if (body instanceof Response) return body;
  const id = value(body.id, 80);
  const status = value(body.status, 20);
  if (!id || !["assigned", "in-progress", "complete", "archived"].includes(status)) return Response.json({ error: "Invalid assignment update.", errorBn: "কাজের পরিবর্তনের তথ্য ঠিক নেই।" }, { status: 400 });
  const db = await getDb();
  const [assignment] = await db.update(assignments).set({ status, updatedAt: new Date().toISOString() }).where(and(eq(assignments.id, id), eq(assignments.ownerEmail, user.email))).returning();
  if (!assignment) return Response.json({ error: "Assignment not found.", errorBn: "কাজটি পাওয়া যায়নি।" }, { status: 404 });
  return Response.json({ assignment });
}

function value(input: unknown, maxLength: number) {
  return typeof input === "string" ? input.trim().slice(0, maxLength) : "";
}

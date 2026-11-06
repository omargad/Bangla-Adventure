import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { assignments, learnerProfiles, skillProgress } from "../../../../db/schema";
import { getSessionAdult } from "@/lib/auth";
import { canTeach } from "@/lib/roles";
import { approvedLessonIds } from "@/lib/lesson-approval";
import { learnerAssignments } from "@/lib/lesson-model";
import { INVALID_AGE_BAND, isAgeBand } from "@/lib/profile-fields";
import { readJsonObject } from "@/lib/request-security";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const signInRequired = () => Response.json({ error: "Sign in required.", errorBn: "সাইন ইন করা প্রয়োজন।" }, { status: 401 });
const readOnly = () => Response.json({ error: "Parent accounts have read-only access to learning records.", errorBn: "অভিভাবকের অ্যাকাউন্ট থেকে শেখার রেকর্ড শুধু দেখা যায়।" }, { status: 403 });
const notFound = () => Response.json({ error: "Learner profile not found.", errorBn: "শিক্ষার্থীর প্রোফাইল পাওয়া যায়নি।" }, { status: 404 });

export async function GET(_request: Request, context: RouteContext) {
  const user = await getSessionAdult();
  if (!user) return signInRequired();
  const { id } = await context.params;
  const db = await getDb();
  const [profile] = await db.select().from(learnerProfiles).where(and(eq(learnerProfiles.id, id), eq(learnerProfiles.ownerEmail, user.email))).limit(1);
  if (!profile) return notFound();
  const progress = await db.select().from(skillProgress).where(eq(skillProgress.profileId, id));
  const profileAssignments = learnerAssignments(await db.select().from(assignments).where(and(eq(assignments.profileId, id), eq(assignments.ownerEmail, user.email))), await approvedLessonIds(), canTeach(user));
  return Response.json({ profile: { ...profile, homeLanguages: safeJsonArray(profile.homeLanguages) }, progress, assignments: profileAssignments });
}

export async function PATCH(request: Request, context: RouteContext) {
  const user = await getSessionAdult();
  if (!user) return signInRequired();
  if (!canTeach(user)) return readOnly();
  const { id } = await context.params;
  const body = await readJsonObject(request);
  if (body instanceof Response) return body;
  // The same age bands as a new profile; anything else is refused rather than stored.
  if (body.ageBand !== undefined && !isAgeBand(body.ageBand)) return Response.json(INVALID_AGE_BAND, { status: 400 });
  const db = await getDb();
  const [owned] = await db.select({ id: learnerProfiles.id }).from(learnerProfiles).where(and(eq(learnerProfiles.id, id), eq(learnerProfiles.ownerEmail, user.email))).limit(1);
  if (!owned) return notFound();

  const values: Partial<typeof learnerProfiles.$inferInsert> = { updatedAt: new Date().toISOString() };
  if (typeof body.displayName === "string" && body.displayName.trim()) values.displayName = body.displayName.trim().slice(0, 40);
  if (isAgeBand(body.ageBand)) values.ageBand = body.ageBand;
  if (Array.isArray(body.homeLanguages)) values.homeLanguages = JSON.stringify(body.homeLanguages.filter((item): item is string => typeof item === "string").slice(0, 5));
  const [profile] = await db.update(learnerProfiles).set(values).where(eq(learnerProfiles.id, id)).returning();
  return Response.json({ profile: { ...profile, homeLanguages: safeJsonArray(profile.homeLanguages) } });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const user = await getSessionAdult();
  if (!user) return signInRequired();
  if (!canTeach(user)) return readOnly();
  const { id } = await context.params;
  const db = await getDb();
  const [owned] = await db.select({ id: learnerProfiles.id }).from(learnerProfiles).where(and(eq(learnerProfiles.id, id), eq(learnerProfiles.ownerEmail, user.email))).limit(1);
  if (!owned) return notFound();
  // Progress cascades via the profile foreign key; assignments are removed explicitly.
  await db.delete(assignments).where(and(eq(assignments.profileId, id), eq(assignments.ownerEmail, user.email)));
  await db.delete(learnerProfiles).where(eq(learnerProfiles.id, id));
  return Response.json({ ok: true });
}

function safeJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

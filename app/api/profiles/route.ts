import { desc, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { assignments, learnerProfiles, skillProgress } from "../../../db/schema";
import { getSessionAdult } from "@/lib/auth";
import { canTeach } from "@/lib/roles";
import { approvedLessonIds } from "@/lib/lesson-approval";
import { learnerAssignments } from "@/lib/lesson-model";
import { isAgeBand } from "@/lib/profile-fields";
import { readJsonObject, serverError } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionAdult();
  if (!user) return Response.json({ error: "Sign in as a grown-up to view learner profiles.", errorBn: "শিক্ষার্থীর প্রোফাইল দেখতে বড়দের অ্যাকাউন্টে সাইন ইন করুন।" }, { status: 401 });

  try {
    const db = await getDb();
    const profiles = await db.select().from(learnerProfiles).where(inArray(learnerProfiles.ownerEmail, [user.email])).orderBy(desc(learnerProfiles.updatedAt));
    const profileIds = profiles.map((profile) => profile.id);
    const progress = profileIds.length ? await db.select().from(skillProgress).where(inArray(skillProgress.profileId, profileIds)) : [];
    const profileAssignments = learnerAssignments(profileIds.length ? await db.select().from(assignments).where(inArray(assignments.profileId, profileIds)).orderBy(desc(assignments.createdAt)) : [], await approvedLessonIds(), canTeach(user));

    return Response.json({
      profiles: profiles.map((profile) => ({
        ...profile,
        homeLanguages: safeJsonArray(profile.homeLanguages),
        progress: progress.filter((item) => item.profileId === profile.id),
        assignments: profileAssignments.filter((item) => item.profileId === profile.id),
      })),
    });
  } catch (error) {
    return databaseError(error);
  }
}

export async function POST(request: Request) {
  const user = await getSessionAdult();
  if (!user) return Response.json({ error: "Sign in as a grown-up to create a learner profile.", errorBn: "শিক্ষার্থীর প্রোফাইল তৈরি করতে বড়দের অ্যাকাউন্টে সাইন ইন করুন।" }, { status: 401 });
  if (!canTeach(user)) return Response.json({ error: "Parent accounts have read-only access to learning records.", errorBn: "অভিভাবকের অ্যাকাউন্ট থেকে শেখার রেকর্ড শুধু দেখা যায়।" }, { status: 403 });
  const body = await readJsonObject(request);
  if (body instanceof Response) return body;

  try {
    const displayName = typeof body.displayName === "string" ? body.displayName.trim().slice(0, 40) : "";
    const ageBand = isAgeBand(body.ageBand) ? body.ageBand : "not-specified";
    const homeLanguages = Array.isArray(body.homeLanguages)
      ? body.homeLanguages.filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, 30)).filter(Boolean).slice(0, 5)
      : [];
    if (!displayName) return Response.json({ error: "A display name is required.", errorBn: "একটি প্রদর্শন নাম দিন।" }, { status: 400 });

    const db = await getDb();
    // ISO like PATCH writes, so the list's updated_at order compares like with like.
    const now = new Date().toISOString();
    const [profile] = await db.insert(learnerProfiles).values({
      id: crypto.randomUUID(),
      ownerEmail: user.email,
      displayName,
      ageBand,
      homeLanguages: JSON.stringify(homeLanguages),
      createdAt: now,
      updatedAt: now,
    }).returning();
    return Response.json({ profile: { ...profile, homeLanguages } }, { status: 201 });
  } catch (error) {
    return databaseError(error);
  }
}

function safeJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/** The detail stays in the server log; the browser gets a fixed message in both languages. */
function databaseError(error: unknown) {
  return serverError("Learner profiles", error, {
    error: "Saved progress is unavailable right now. Local learning still works.",
    errorBn: "সংরক্ষিত অগ্রগতি এখন পাওয়া যাচ্ছে না। এই ডিভাইসে শেখা চালিয়ে যেতে পারবেন।",
  });
}

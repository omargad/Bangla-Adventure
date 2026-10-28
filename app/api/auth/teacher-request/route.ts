import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { adults, userAuditEvents } from "@/db/schema";
import { getSessionAdult, publicAdultFields } from "@/lib/auth";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST() {
  const adult = await getSessionAdult();
  if (!adult) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (adult.role !== "parent" || adult.teacherStatus === "pending") return Response.json({ adult });
  const limit = checkRateLimit(`teacher-request:${adult.id}`, 3, 24 * 60 * 60 * 1000);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);
  const db = await getDb();
  const updated = db.transaction((tx) => {
    const row = tx.update(adults).set({ teacherStatus: "pending", teacherRequestedAt: new Date().toISOString() })
      .where(and(eq(adults.id, adult.id), eq(adults.role, "parent"), eq(adults.status, "active")))
      .returning(publicAdultFields).get();
    if (row) tx.insert(userAuditEvents).values({ id: crypto.randomUUID(), actorId: adult.id, targetId: adult.id, targetType: "adult", action: "teacher-requested" }).run();
    return row;
  });
  if (!updated) return Response.json({ error: "Account unavailable. Sign in again." }, { status: 403 });
  return Response.json({ adult: updated });
}

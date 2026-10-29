import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { classAnnouncements, userAuditEvents } from "../../../../../db/schema";
import { getSessionAdult } from "@/lib/auth";
import { canTeach } from "@/lib/roles";
import { findManagedClass } from "@/lib/class-access";
import { parseAnnouncement } from "@/lib/announcements";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** Post to the class: { body, audience } where audience is "all" (default), "students" or "parents". */
export async function POST(request: Request, context: RouteContext) {
  const user = await getSessionAdult();
  if (user && !canTeach(user)) return Response.json({ error: "An approved teacher account is required." }, { status: 403 });
  if (!user) return Response.json({ error: "Sign in to post announcements." }, { status: 401 });

  try {
    const { id } = await context.params;
    if (!(await findManagedClass(user, id))) return Response.json({ error: "Class not found." }, { status: 404 });

    const input = parseAnnouncement(await request.json().catch(() => null));
    if ("error" in input) return Response.json(input, { status: 400 });

    const db = await getDb();
    const [announcement] = await db
      .insert(classAnnouncements)
      .values({ id: crypto.randomUUID(), classId: id, body: input.body, audience: input.audience, authorId: user.id })
      .returning();
    return Response.json({ announcement: { ...announcement, authorName: user.displayName } }, { status: 201 });
  } catch (error) {
    return databaseError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const user = await getSessionAdult();
  if (user && !canTeach(user)) return Response.json({ error: "An approved teacher account is required." }, { status: 403 });
  if (!user) return Response.json({ error: "Sign in to manage announcements." }, { status: 401 });

  try {
    const { id } = await context.params;
    if (!(await findManagedClass(user, id))) return Response.json({ error: "Class not found." }, { status: 404 });

    const payload = (await request.json().catch(() => ({}))) as { announcementId?: unknown };
    const announcementId = typeof payload.announcementId === "string" ? payload.announcementId : "";
    if (!announcementId) return Response.json({ error: "Choose an announcement to remove." }, { status: 400 });

    const db = await getDb();
    // Removing a post takes it away from every student and parent, so it is audited.
    const removed = db.transaction((tx) => {
      const row = tx
        .delete(classAnnouncements)
        .where(and(eq(classAnnouncements.id, announcementId), eq(classAnnouncements.classId, id)))
        .returning()
        .get();
      if (row) tx.insert(userAuditEvents).values({
        id: crypto.randomUUID(), actorId: user.id, targetId: id, targetType: "class", action: "announcement-removed",
        detailsJson: JSON.stringify({ announcementId: row.id, audience: row.audience, authorId: row.authorId }),
      }).run();
      return row;
    });
    if (!removed) return Response.json({ error: "Announcement not found." }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    return databaseError(error);
  }
}

function databaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected database error";
  const unavailable = message.includes("no such table") || message.includes("SQLITE");
  return Response.json({ error: unavailable ? "The classroom service is still being set up." : message }, { status: 500 });
}

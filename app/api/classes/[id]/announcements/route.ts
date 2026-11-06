import { getSessionAdult } from "@/lib/auth";
import { canTeach } from "@/lib/roles";
import { findManagedClass } from "@/lib/class-access";
import { parseAnnouncement } from "@/lib/announcements";
import { postAnnouncement, removeAnnouncement } from "@/lib/class-announcements";
import { classServerError } from "@/lib/class-errors";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };
const classNotFound = () => Response.json({ error: "Class not found.", errorBn: "ক্লাসটি পাওয়া যায়নি।" }, { status: 404 });

/** Post to the class: { body, audience } where audience is "all" (default), "students" or "parents". Audited. */
export async function POST(request: Request, context: RouteContext) {
  const user = await getSessionAdult();
  if (user && !canTeach(user)) return Response.json({ error: "An approved teacher account is required.", errorBn: "অনুমোদিত শিক্ষকের অ্যাকাউন্ট প্রয়োজন।" }, { status: 403 });
  if (!user) return Response.json({ error: "Sign in to post announcements.", errorBn: "ঘোষণা প্রকাশ করতে সাইন ইন করুন।" }, { status: 401 });

  try {
    const { id } = await context.params;
    if (!(await findManagedClass(user, id))) return classNotFound();

    const input = parseAnnouncement(await request.json().catch(() => null));
    if ("error" in input) return Response.json(input, { status: 400 });

    const announcement = await postAnnouncement(user, id, input);
    if (!announcement) return classNotFound();
    return Response.json({ announcement: { ...announcement, authorName: user.displayName } }, { status: 201 });
  } catch (error) {
    return classServerError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const user = await getSessionAdult();
  if (user && !canTeach(user)) return Response.json({ error: "An approved teacher account is required.", errorBn: "অনুমোদিত শিক্ষকের অ্যাকাউন্ট প্রয়োজন।" }, { status: 403 });
  if (!user) return Response.json({ error: "Sign in to manage announcements.", errorBn: "ঘোষণা পরিচালনা করতে সাইন ইন করুন।" }, { status: 401 });

  try {
    const { id } = await context.params;
    if (!(await findManagedClass(user, id))) return classNotFound();

    const payload = (await request.json().catch(() => null)) as { announcementId?: unknown } | null;
    const announcementId = typeof payload?.announcementId === "string" ? payload.announcementId : "";
    if (!announcementId) return Response.json({ error: "Choose an announcement to remove.", errorBn: "মুছতে একটি ঘোষণা বেছে নিন।" }, { status: 400 });

    // Removing a post takes it away from every student and parent, so it is audited.
    if (!(await removeAnnouncement(user, id, announcementId))) return Response.json({ error: "Announcement not found.", errorBn: "ঘোষণাটি পাওয়া যায়নি।" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    return classServerError(error);
  }
}

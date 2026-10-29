import { eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { mediaAssets } from "../../../../../db/schema";
import { getStaffAccess } from "@/lib/auth";
import { getMediaObject } from "@/lib/storage";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

/**
 * Staff play any uploaded recording, including one still waiting for review, so
 * they can listen before approving it. Learners only ever get approved tracks
 * through /api/audio.
 */
export async function GET(_request: Request, context: RouteContext) {
  const actor = await getStaffAccess("teach");
  if (actor instanceof Response) return actor;
  const { id } = await context.params;
  const notFound = Response.json({ error: "Recording not found.", errorBn: "রেকর্ডিংটি পাওয়া যায়নি।" }, { status: 404 });
  if (!/^[A-Za-z0-9-]{1,80}$/.test(id)) return notFound;
  const db = await getDb();
  const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, id)).limit(1);
  const body = asset ? await getMediaObject(asset.objectKey) : null;
  if (!asset || !body) return notFound;
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": asset.contentType.startsWith("audio/") ? asset.contentType : "application/octet-stream",
      "Content-Length": String(body.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

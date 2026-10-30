import { getSessionStatus } from "@/lib/session-status";
import { currentRelease } from "@/lib/release";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ ...await getSessionStatus(), release: currentRelease() }, { headers: { "Cache-Control": "private, no-store" } });
}

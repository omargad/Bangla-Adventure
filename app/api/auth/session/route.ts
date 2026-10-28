import { getSessionStatus } from "@/lib/session-status";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ ...await getSessionStatus(), release: process.env.NEXT_DIST_DIR ?? "development" }, { headers: { "Cache-Control": "private, no-store" } });
}

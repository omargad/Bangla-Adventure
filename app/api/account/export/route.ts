import { getSessionAdult } from "../../../../lib/auth";
import { exportAccountData } from "../../../../lib/user-management";

export const dynamic = "force-dynamic";

/** Machine-readable export of everything stored for the signed-in grown-up (see exportAccountData). */
export async function GET() {
  const adult = await getSessionAdult();
  if (!adult) return Response.json({ error: "Sign in required.", errorBn: "সাইন ইন করা প্রয়োজন।" }, { status: 401 });

  const payload = await exportAccountData(adult.id);
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": 'attachment; filename="bangla-adventures-export.json"',
      "Cache-Control": "no-store",
    },
  });
}

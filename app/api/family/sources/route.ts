import { getSessionAdult } from "@/lib/auth";
import { classSourceErrorResponse, parentClassSources } from "@/lib/class-sources";

export const dynamic = "force-dynamic";

/** The class sources of each class a parent's linked children are allocated to, by class id. */
export async function GET() {
  const parent = await getSessionAdult();
  if (!parent) return Response.json({ error: "Parent sign in required.", errorBn: "অভিভাবক হিসেবে সাইন ইন করুন।" }, { status: 401 });
  try {
    return Response.json({ classes: await parentClassSources(parent.id) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return classSourceErrorResponse(error); }
}

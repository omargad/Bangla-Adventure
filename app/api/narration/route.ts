import { generatedNarration } from "@/lib/generated-narration";
import { createNarrationHandler } from "@/lib/narration-handler";
import { getNarrationActor, resolveNarration } from "@/lib/narration-source";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = createNarrationHandler({
  getActor: getNarrationActor,
  resolveSource: resolveNarration,
  generate: generatedNarration,
  rateLimit: checkRateLimit,
});

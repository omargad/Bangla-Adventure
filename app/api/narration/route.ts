import { generatedNarration } from "@/lib/generated-narration";
import { createNarrationHandler } from "@/lib/narration-handler";
import { getNarrationActor, resolveNarrationSource } from "@/lib/narration-source";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = createNarrationHandler({
  getActor: getNarrationActor,
  resolveSource: resolveNarrationSource,
  generate: generatedNarration,
  rateLimit: checkRateLimit,
});

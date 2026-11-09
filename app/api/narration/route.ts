import { generatedNarration, newNarrationConfigured } from "@/lib/generated-narration";
import { createNarrationHandler, createNarrationStatusHandler } from "@/lib/narration-handler";
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

/** Only whether new narration can be made, for the signed-in reader's Listen labels. */
export const GET = createNarrationStatusHandler({
  getActor: getNarrationActor,
  configured: () => newNarrationConfigured(process.env),
  rateLimit: checkRateLimit,
});

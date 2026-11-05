import { createHash } from "node:crypto";
import { generatedNarration, NarrationError } from "@/lib/generated-narration";
import { splitNarration } from "@/lib/narration-model";
import { getNarrationActor, NarrationSourceError, resolveNarrationSource, type NarrationSourceRequest } from "@/lib/narration-source";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 2048;
const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
type NarrationRequest = NarrationSourceRequest & { hash: string; part: number };

function failure(status: number, error: string, headers?: Record<string, string>) {
  return Response.json({ error }, { status, headers: { ...privateHeaders, ...headers } });
}

/** Read no more than 2 KB even when Content-Length is missing or incorrect. */
async function readBody(request: Request): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > MAX_BODY_BYTES) throw new NarrationSourceError(413, "The narration request is too large.");
  if (!request.body) throw new NarrationSourceError(400, "Send a valid narration request.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new NarrationSourceError(413, "The narration request is too large.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, length)));
  } catch {
    throw new NarrationSourceError(400, "Send a valid narration request.");
  }
}

function parseBody(body: unknown): NarrationRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new NarrationSourceError(400, "Send a valid narration request.");
  const value = body as Record<string, unknown>;
  const { kind, id, slot, language, hash, part } = value;
  const validSlot = typeof slot === "string" && (kind === "topic"
    ? /^(intro|(?:section|fact):(?:0|[1-9][0-9]{0,2}))$/.test(slot)
    : /^(instructions|question:(?:0|[1-9][0-9]{0,2}))$/.test(slot));
  if ((kind !== "topic" && kind !== "activity") || typeof id !== "string" || !id.length || id.length > 100
    || !validSlot || (language !== "bn" && language !== "en") || typeof hash !== "string" || !/^[a-f0-9]{64}$/i.test(hash)
    || typeof part !== "number" || !Number.isSafeInteger(part) || part < 0) {
    throw new NarrationSourceError(400, "Choose valid content, language and narration part.");
  }
  return { kind, id, slot: slot as string, language, hash: hash.toLowerCase(), part };
}

/** Generate only text derived from accessible stored content, never arbitrary client text. */
export async function POST(request: Request) {
  try {
    const actor = await getNarrationActor();
    const limit = checkRateLimit(`narration:${actor.key}`, 120, 60_000);
    if (!limit.allowed) return failure(429, "Too many narration requests. Please wait a moment.", { "Retry-After": String(limit.retryAfterSeconds) });
    const source = parseBody(await readBody(request));
    const text = await resolveNarrationSource(actor, source);
    if (createHash("sha256").update(text, "utf8").digest("hex") !== source.hash) {
      return failure(409, "This content has changed. Refresh it before listening.");
    }
    const chunk = splitNarration(text)[source.part];
    if (!chunk) return failure(400, "Choose a valid narration part.");
    const generated = await generatedNarration(chunk, source.language, actor.key);
    // A provider call can take time; an intervening withdrawal, enrollment
    // change or edit must not return audio the reader may no longer hear.
    if (await resolveNarrationSource(actor, source) !== text) {
      return failure(409, "This content has changed. Refresh it before listening.");
    }
    return new Response(new Uint8Array(generated.audio), { headers: {
      ...privateHeaders, "Content-Type": "audio/ogg", "X-Narration-Provider": "ElevenLabs", "X-Narration-Cache": generated.cached ? "hit" : "miss",
    } });
  } catch (error) {
    if (error instanceof NarrationSourceError || error instanceof NarrationError) return failure(error.status, error.message);
    return failure(503, "Narration is temporarily unavailable. Please try again.");
  }
}

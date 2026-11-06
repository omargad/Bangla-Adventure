import { createHash } from "node:crypto";
import { NarrationError } from "./generated-narration";
import { splitNarration, type NarrationLanguage } from "./narration-model";
import { NarrationSourceError, type NarrationActor, type NarrationSourceRequest, type ResolvedNarration } from "./narration-source";
import type { RateLimitResult } from "./rate-limit";

type NarrationDependencies = {
  getActor: () => Promise<NarrationActor>;
  /** The text alone, or with `savedOnly` when only audio saved earlier may be played (see resolveNarration). */
  resolveSource: (actor: NarrationActor, source: NarrationSourceRequest) => Promise<string | ResolvedNarration>;
  /** Called with a fourth argument, `{ savedOnly: true }`, when it must not make new audio. */
  generate: (text: string, language: NarrationLanguage, actorKey: string, options?: { savedOnly: true }) => Promise<{ audio: Buffer; cached: boolean }>;
  rateLimit: (key: string, limit: number, windowMs: number) => RateLimitResult;
};

const MAX_BODY_BYTES = 2048;
const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
type NarrationRequest = NarrationSourceRequest & { hash: string; part: number };

function failure(status: number, error: string, headers?: Record<string, string>, errorBn?: string) {
  return Response.json(errorBn ? { error, errorBn } : { error }, { status, headers: { ...privateHeaders, ...headers } });
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

function resolved(source: string | ResolvedNarration): { text: string; savedOnly?: true } {
  return typeof source === "string" ? { text: source } : source.savedOnly ? { text: source.text, savedOnly: true } : { text: source.text };
}

/** Generate only text derived from accessible stored content, never arbitrary client text. */
export function createNarrationHandler({ getActor, resolveSource, generate, rateLimit }: NarrationDependencies) {
  return async function handleNarration(request: Request) {
    try {
      const actor = await getActor();
      const limit = rateLimit(`narration:${actor.key}`, 120, 60_000);
      if (!limit.allowed) return failure(429, "Too many narration requests. Please wait a moment.", { "Retry-After": String(limit.retryAfterSeconds) });
      const source = parseBody(await readBody(request));
      const { text, savedOnly } = resolved(await resolveSource(actor, source));
      if (createHash("sha256").update(text, "utf8").digest("hex") !== source.hash) {
        return failure(409, "This content has changed. Refresh it before listening.");
      }
      const chunk = splitNarration(text)[source.part];
      if (!chunk) return failure(400, "Choose a valid narration part.");
      const generated = savedOnly ? await generate(chunk, source.language, actor.key, { savedOnly }) : await generate(chunk, source.language, actor.key);
      // A provider call can take time; an intervening withdrawal, enrollment
      // change or edit must not return audio the reader may no longer hear.
      const currentActor = await getActor();
      if (currentActor.kind !== actor.kind || currentActor.id !== actor.id) {
        return failure(401, "Sign in to listen to this content.");
      }
      if (resolved(await resolveSource(actor, source)).text !== text) {
        return failure(409, "This content has changed. Refresh it before listening.");
      }
      return new Response(new Uint8Array(generated.audio), { headers: {
        ...privateHeaders, "Content-Type": "audio/ogg", "X-Narration-Provider": "ElevenLabs", "X-Narration-Cache": generated.cached ? "hit" : "miss",
      } });
    } catch (error) {
      if (error instanceof NarrationError) return failure(error.status, error.message, undefined, error.messageBn);
      if (error instanceof NarrationSourceError) return failure(error.status, error.message);
      return failure(503, "Narration is temporarily unavailable. Please try again.");
    }
  };
}

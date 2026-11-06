// Server-side only: credentials and generated audio never enter a client bundle.
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

type Language = "bn" | "en";
type Environment = Record<string, string | undefined>;
const DEFAULT_VOICE = "6fKdJFZHa5oCXNSVGieE";
const DEFAULT_MODEL = "eleven_v4";
const FORMAT = "opus_48000_64";
const MAX_BYTES = 8 * 1024 * 1024;
const COOLDOWN_MS = 60_000;
const TIMEOUT_MS = 60_000;
const settingsFor = (modelId: string) => ({ stability: modelId === "eleven_v3" ? 0.5 : 0.7, similarityBoost: 0.75 });

export class NarrationError extends Error {
  constructor(public readonly status: number, message: string, public readonly messageBn?: string) {
    super(message);
    this.name = "NarrationError";
  }
}

/** How much of the site's daily allowance one account may use, a quarter of it unless ELEVENLABS_ACCOUNT_DAILY_CHARACTER_LIMIT says otherwise. */
export function accountDailyLimit(siteLimit: number, configured: string | undefined): number | null {
  const raw = configured?.trim() || "";
  if (!raw) return Math.floor(siteLimit / 4);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) return null;
  return Math.min(Number(raw), siteLimit);
}

const accountKey = (actorKey: string) => createHash("sha256").update(actorKey).digest("hex");

/** Public for offline fixtures; contains no account, key or provider response. */
export function narrationCacheKey(text: string, language: Language, voiceId = DEFAULT_VOICE, modelId = DEFAULT_MODEL): string {
  return createHash("sha256").update(JSON.stringify({ schema: 1, text, language, voiceId, modelId, format: FORMAT, settings: settingsFor(modelId) })).digest("hex");
}

type TransportRequest = {
  text: string;
  language: Language;
  voiceId: string;
  modelId: string;
  key: string;
  signal: AbortSignal;
};
type Dependencies = {
  env: () => Environment;
  now?: () => number;
  transport?: (request: TransportRequest) => Promise<ReadableStream<Uint8Array>>;
};

async function providerTransport(request: TransportRequest): Promise<ReadableStream<Uint8Array>> {
  const { ElevenLabsClient } = await import("@elevenlabs/elevenlabs-js");
  const client = new ElevenLabsClient({ apiKey: request.key, maxRetries: 0 });
  return client.textToSpeech.convert(request.voiceId, {
    text: request.text,
    languageCode: request.language,
    modelId: request.modelId,
    outputFormat: FORMAT,
    voiceSettings: settingsFor(request.modelId),
  }, { maxRetries: 0, timeoutInSeconds: TIMEOUT_MS / 1000, abortSignal: request.signal });
}

function validAudio(audio: Buffer): boolean {
  if (audio.length < 47 || audio.length > MAX_BYTES || audio.subarray(0, 4).toString("ascii") !== "OggS" || audio[4] !== 0 || audio[26] === 0) return false;
  const packetStart = 27 + audio[26];
  return packetStart + 19 <= audio.length && audio.subarray(packetStart, packetStart + 8).toString("ascii") === "OpusHead";
}

async function readAudio(file: string): Promise<Buffer | null> {
  try {
    const info = await fs.stat(file);
    if (!info.isFile() || info.size > MAX_BYTES) throw new Error("invalid cache");
    const audio = await fs.readFile(file);
    if (!validAudio(audio)) throw new Error("invalid cache");
    return audio;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new NarrationError(503, "Saved narration is unavailable. Please try again later.");
  }
}

async function atomicWrite(file: string, bytes: string | Buffer): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(temporary, bytes, { mode: 0o600, flag: "wx" });
    await fs.rename(temporary, file);
  } finally {
    await fs.unlink(temporary).catch(() => undefined);
  }
}

async function collectAudio(stream: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
        const abort = () => reject(new Error("narration timed out"));
        if (signal.aborted) return abort();
        signal.addEventListener("abort", abort, { once: true });
        reader.read().then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
      });
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_BYTES) throw new Error("audio too large");
      chunks.push(Buffer.from(part.value));
    }
    const audio = Buffer.concat(chunks);
    if (!validAudio(audio)) throw new Error("invalid audio");
    return audio;
  } finally {
    // Cancel without blocking cleanup if a remote stream never answers.
    void reader.cancel().catch(() => undefined);
  }
}

/** Injectable environment and transport keep tests offline and independent of secrets. */
export function createGeneratedNarration({ env, now = Date.now, transport = providerTransport }: Dependencies) {
  const inFlight = new Map<string, Promise<{ audio: Buffer; cached: boolean }>>();
  const failed = new Map<string, number>();
  let active = 0;
  let budgetQueue: Promise<void> = Promise.resolve();

  /**
   * Reserve characters from today's allowance: the site's (`limit`) and the account's own share
   * (`accountLimit`), so one account cannot use up narration for everyone. Accounts are stored hashed.
   */
  function reserve(root: string, amount: number, limit: number, accountLimit: number, actorKey: string): Promise<void> {
    const reservation = budgetQueue.then(async () => {
      const file = path.join(root, "daily-budget.json");
      const day = new Date(now()).toISOString().slice(0, 10);
      const account = accountKey(actorKey);
      let used = 0;
      let accounts: Record<string, number> = {};
      try {
        const stored = JSON.parse(await fs.readFile(file, "utf8"));
        if (!stored || stored.schema !== 1 || typeof stored.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(stored.day) || stored.day > day || !Number.isSafeInteger(stored.characters) || stored.characters < 0) throw new Error("invalid budget");
        const storedDate = Date.parse(`${stored.day}T00:00:00.000Z`);
        if (!Number.isFinite(storedDate) || new Date(storedDate).toISOString().slice(0, 10) !== stored.day) throw new Error("invalid budget date");
        // Files written before the per-account share have no accounts: everyone starts from zero.
        const storedAccounts: unknown = stored.accounts ?? {};
        if (!storedAccounts || typeof storedAccounts !== "object" || Array.isArray(storedAccounts)
          || Object.entries(storedAccounts).some(([key, value]) => !/^[a-f0-9]{64}$/.test(key) || !Number.isSafeInteger(value) || (value as number) < 0)) throw new Error("invalid accounts");
        if (stored.day === day) { used = stored.characters; accounts = storedAccounts as Record<string, number>; }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new NarrationError(503, "Narration usage is unavailable. Please try again later.");
      }
      if (used + amount > limit) throw new NarrationError(429, "Today's narration allowance has been used. Saved audio is still available.", "আজকের কণ্ঠ তৈরির সীমা শেষ হয়ে গেছে। সংরক্ষিত অডিও এখনো শোনা যাবে।");
      if ((accounts[account] ?? 0) + amount > accountLimit) {
        throw new NarrationError(429, "This account's narration allowance for today has been used. Saved audio is still available.", "আজকের জন্য এই অ্যাকাউন্টের কণ্ঠ তৈরির সীমা শেষ হয়ে গেছে। সংরক্ষিত অডিও এখনো শোনা যাবে।");
      }
      try {
        // Keep reservations after failures: a provider may have charged before a connection failed.
        await atomicWrite(file, JSON.stringify({ schema: 1, day, characters: used + amount, accounts: { ...accounts, [account]: (accounts[account] ?? 0) + amount }, lastActor: account }));
      } catch {
        throw new NarrationError(503, "Narration usage is unavailable. Please try again later.");
      }
    });
    budgetQueue = reservation.catch(() => undefined);
    return reservation;
  }

  /** With `savedOnly` (a staff preview of an activity not yet approved), only audio saved earlier is returned. */
  return async function generate(text: string, language: Language, actorKey: string, options?: { savedOnly?: boolean }): Promise<{ audio: Buffer; cached: boolean }> {
    if (typeof window !== "undefined") throw new NarrationError(503, "Narration is only available on the server.");
    if (typeof text !== "string" || !text.trim() || [...text].length > 1500 || !["bn", "en"].includes(language) || typeof actorKey !== "string" || !actorKey.trim() || actorKey.length > 512) throw new NarrationError(400, "This narration request is invalid.");
    const configuration = env();
    const voiceId = configuration.ELEVENLABS_VOICE_ID?.trim() || DEFAULT_VOICE;
    const modelId = configuration.ELEVENLABS_MODEL_ID?.trim() || DEFAULT_MODEL;
    if (!/^[A-Za-z0-9]{10,40}$/.test(voiceId) || !["eleven_v4", "eleven_v3"].includes(modelId)) throw new NarrationError(503, "Narration settings are unavailable.");
    const root = path.join(path.resolve(configuration.MEDIA_ROOT || path.join(process.cwd(), ".data", "media")), "generated-narration", "v1");
    const hash = narrationCacheKey(text, language, voiceId, modelId);
    const file = path.join(root, `${hash}.ogg`);
    const identity = `${root}/${hash}`;
    if (options?.savedOnly) {
      const saved = await readAudio(file);
      if (saved) return { audio: saved, cached: true };
      throw new NarrationError(409, "New narration is made only for approved, open activities. Saved audio still plays.", "নতুন কণ্ঠ শুধু অনুমোদিত ও খোলা কার্যক্রমের জন্য তৈরি হয়। সংরক্ষিত অডিও এখনো শোনা যাবে।");
    }
    const pending = inFlight.get(identity);
    if (pending) return pending;

    const run = async (): Promise<{ audio: Buffer; cached: boolean }> => {
      const existing = await readAudio(file);
      if (existing) return { audio: existing, cached: true };
      if ((failed.get(identity) ?? 0) > now()) throw new NarrationError(503, "Narration is temporarily unavailable. Please try again shortly.");
      const key = configuration.ELEVENLABS_API_KEY?.trim() || "";
      if (!key || !/^[\x21-\x7e]+$/.test(key) || key === voiceId) throw new NarrationError(503, "New narration is not configured. Saved audio is still available.");
      const rawLimit = configuration.ELEVENLABS_DAILY_CHARACTER_LIMIT?.trim() || "20000";
      const limit = Number(rawLimit);
      if (!/^\d+$/.test(rawLimit) || !Number.isSafeInteger(limit)) throw new NarrationError(503, "Narration settings are unavailable.");
      const accountLimit = accountDailyLimit(limit, configuration.ELEVENLABS_ACCOUNT_DAILY_CHARACTER_LIMIT);
      if (accountLimit === null) throw new NarrationError(503, "Narration settings are unavailable.");
      if (active >= 2) throw new NarrationError(503, "Narration is busy. Please try again shortly.");
      active += 1;
      try {
        await reserve(root, [...text].length, limit, accountLimit, actorKey);
        let audio: Buffer;
        try {
          const signal = AbortSignal.timeout(TIMEOUT_MS);
          audio = await collectAudio(await transport({ text, language, voiceId, modelId, key, signal }), signal);
        } catch {
          // Never forward provider errors, request text, headers, credentials or causes.
          for (const [entry, until] of failed) if (until <= now()) failed.delete(entry);
          if (failed.size >= 1024) failed.delete(failed.keys().next().value!);
          failed.set(identity, now() + COOLDOWN_MS);
          throw new NarrationError(503, "Narration could not be generated. Please try again shortly.");
        }
        try {
          await atomicWrite(file, audio);
        } catch {
          failed.set(identity, now() + COOLDOWN_MS);
          throw new NarrationError(503, "Narration could not be saved. Please try again shortly.");
        }
        failed.delete(identity);
        return { audio, cached: false };
      } finally {
        active -= 1;
      }
    };
    const work = run();
    inFlight.set(identity, work);
    try {
      return await work;
    } finally {
      inFlight.delete(identity);
    }
  };
}

export const generatedNarration = createGeneratedNarration({ env: () => process.env });

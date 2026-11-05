#!/usr/bin/env node
/**
 * Official ElevenLabs SDK transport for the existing asset generator.
 * Load credentials externally, for example:
 * node --env-file=.env.local scripts/generate-elevenlabs-audio.mjs --voice <id> --samples
 * Add --bangla-only to leave the existing English clips unchanged.
 */
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import generator from "./generate-voice-assets.cjs";

const { allAssets, elevenLabsRequest, generate, isOggOpus, parseOptions } = generator;

class SafeGenerationError extends Error {}

/** Never retain the SDK error, its body, headers, request, or credentials. */
function requestFailure(error) {
  const status = error?.statusCode;
  return new SafeGenerationError(
    Number.isInteger(status) && status >= 100 && status <= 599
      ? `ElevenLabs audio generation failed (HTTP ${status}).`
      : "ElevenLabs audio generation failed.",
  );
}

/** The generator wraps failures to record its resumable progress. */
export function safeErrorMessage(error) {
  if (error instanceof SafeGenerationError) return error.message;
  if (error?.cause instanceof SafeGenerationError) return error.cause.message;
  return "ElevenLabs audio generation failed. Completed clips are saved; retry with --resume.";
}

export function parseSdkOptions(argv = [], env = {}) {
  const banglaOnly = argv.includes("--bangla-only");
  const args = argv.filter((arg) => arg !== "--bangla-only");
  const hasProvider = args.some((arg) => arg === "--provider" || arg.startsWith("--provider="));
  try {
    const options = parseOptions(hasProvider ? args : ["--provider", "elevenlabs", ...args], env);
    if (options.provider !== "elevenlabs") throw new Error();
    return { ...options, banglaOnly };
  } catch {
    throw new SafeGenerationError("Invalid ElevenLabs options. Check --voice, --model and ELEVENLABS_API_KEY.");
  }
}

/** Keep validation and voice settings identical to the existing generator. */
export function sdkRequest(asset, options) {
  const { init } = elevenLabsRequest({
    text: asset.text,
    language: asset.language,
    voiceId: options.voices[asset.language],
    model: options.model,
    key: options.key,
  });
  const body = JSON.parse(init.body);
  return {
    text: body.text,
    modelId: body.model_id,
    ...(body.language_code ? { languageCode: body.language_code } : {}),
    voiceSettings: {
      stability: body.voice_settings.stability,
      similarityBoost: body.voice_settings.similarity_boost,
    },
    outputFormat: "opus_48000_64",
  };
}

export async function synthesizeWithSdk(asset, options, client) {
  let bytes;
  try {
    const audio = await client.textToSpeech.convert(options.voices[asset.language], sdkRequest(asset, options));
    const chunks = [];
    // The official SDK returns a web ReadableStream.
    for await (const chunk of Readable.fromWeb(audio)) chunks.push(Buffer.from(chunk));
    bytes = Buffer.concat(chunks);
  } catch (error) {
    throw requestFailure(error);
  }
  if (!isOggOpus(bytes)) {
    throw new SafeGenerationError("ElevenLabs returned invalid audio; expected Ogg Opus.");
  }
  return bytes;
}

/** Inject a client/assets for offline tests; the CLI uses the official SDK. */
export async function run(argv = [], env = process.env, { client, assets, log } = {}) {
  const options = parseSdkOptions(argv, env);
  let selected = assets ?? await allAssets();
  if (options.banglaOnly) selected = selected.filter((asset) => asset.language === "bn");
  let sdk = client;
  if (!options.dryRun && !sdk) {
    const { ElevenLabsClient } = await import("@elevenlabs/elevenlabs-js");
    sdk = new ElevenLabsClient({ apiKey: options.key });
  }
  return generate(options, {
    assets: selected,
    synthesize: (asset) => synthesizeWithSdk(asset, options, sdk),
    ...(log ? { log } : {}),
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  run(process.argv.slice(2)).catch((error) => {
    console.error(safeErrorMessage(error));
    process.exitCode = 1;
  });
}

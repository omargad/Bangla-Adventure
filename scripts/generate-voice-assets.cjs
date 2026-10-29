#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- text2wav is a CommonJS-only build tool. */

/**
 * Builds the bundled pronunciation clips in public/audio and records in
 * public/audio/voice-manifest.json which engine and voice made each one. The
 * learner pages read the manifest: a clip from a neural provider plays before
 * the device's own Bangla voice, an eSpeak clip only after it.
 *
 *   npm run audio:generate                         eSpeak, only missing files
 *   npm run audio:generate -- --force              eSpeak, every file again
 *   npm run audio:generate -- --provider elevenlabs --dry-run --force
 *   npm run audio:generate -- --provider elevenlabs --samples [--voice <voice id>] [--model eleven_v3]
 *   npm run audio:generate -- --provider elevenlabs --force [--only story-1-bn,lesson-hello-me] [--resume]
 *   npm run audio:generate -- --provider azure --force [--voice bn-BD-PradeepNeural] [--only lesson-my-family]
 *
 * ElevenLabs (the provider the client chose) reads ELEVENLABS_API_KEY and the
 * voice ids ELEVENLABS_VOICE_ID_BN and ELEVENLABS_VOICE_ID_EN; Azure reads
 * AZURE_SPEECH_KEY and AZURE_SPEECH_REGION. Keys are only used here, at build
 * time, and are never printed; they never reach the app or the browser.
 * --dry-run counts the clips and characters a run would send without calling
 * anything, --samples makes five comparison clips in voice-samples/, and
 * --resume continues a stopped run without paying for clips already made.
 */

const { spawnSync } = require("node:child_process");
const { access, mkdir, readFile, unlink, writeFile } = require("node:fs/promises");
const path = require("node:path");

const defaultOutputDirectory = path.resolve(__dirname, "../public/audio");
const MANIFEST_FILE = "voice-manifest.json";

const ESPEAK_VOICES = { bn: "bn+f3", en: "en-gb+f3" };
const AZURE_DEFAULT_VOICES = { bn: "bn-BD-NabanitaNeural", en: "en-AU-NatashaNeural" };
/** Slightly slower than normal speech, for children learning the language. */
const AZURE_RATES = { bn: "-10%", en: "-5%" };
const AZURE_FORMAT = "ogg-24khz-16bit-mono-opus";
const PROVIDERS = new Set(["espeak", "azure", "elevenlabs"]);
const AZURE_REGION = /^[a-z0-9]{2,40}$/;
const AZURE_VOICE = /^[a-z]{2,3}-[A-Z]{2}-[A-Za-z0-9]{2,60}$/;

const ELEVENLABS_URL = "https://api.elevenlabs.io/v1/text-to-speech";
const ELEVENLABS_DEFAULT_MODEL = "eleven_v4";
/**
 * The models this script may use, with the most characters one request takes.
 * Eleven v4 and v3 list Bengali and take language_code; Multilingual v2 does
 * neither, so it can only make the English story and place clips.
 */
const ELEVENLABS_MODELS = {
  eleven_v4: { characters: 10000, bangla: true, languageCode: true },
  eleven_v3: { characters: 5000, bangla: true, languageCode: true },
  eleven_multilingual_v2: { characters: 10000, bangla: false, languageCode: false },
};
/**
 * Steady, clear delivery for children: more stable than ElevenLabs' default
 * (0.5), so every clip is read in the same calm way, with the default
 * similarity to the chosen voice. Eleven v3 keeps its middle ("natural")
 * stability of 0.5. Eleven v4 has no speed setting, so its clips play at the
 * voice's own pace.
 */
const ELEVENLABS_SETTINGS = {
  eleven_v4: { stability: 0.7, similarity_boost: 0.75 },
  eleven_v3: { stability: 0.5, similarity_boost: 0.75 },
  eleven_multilingual_v2: { stability: 0.7, similarity_boost: 0.75 },
};
/**
 * Opus at 48 kHz and 64 kbit/s, which ElevenLabs sends as an Ogg Opus stream:
 * the same kind of .ogg file as the eSpeak and Azure clips. The API reference
 * only names the codec, rate and bitrate, so every answer is checked for the
 * Ogg "OggS" capture pattern and the Opus identification header before it is
 * written (isOggOpus), and a clip whose answer is anything else fails. There
 * is no MP3 fallback (mp3_44100_128): the app plays bundled clips only as
 * <name>.ogg (lib/voice-playback.ts), so an .mp3 file would never be heard.
 */
const ELEVENLABS_FORMAT = "opus_48000_64";
/** Voice ids are short strings of letters and digits, such as JBFqnCBsd6RMkjVDRZzb. */
const ELEVENLABS_VOICE = /^[A-Za-z0-9]{10,40}$/;
/** Clips requested at once: the smallest plan's limit in ElevenLabs' concurrency table, so a run is rarely throttled. */
const ELEVENLABS_CONCURRENCY = 2;
const REQUEST_TIMEOUT_MS = 120000;
/** The longest wait a provider may ask for before a retry. */
const MAX_RETRY_WAIT_SECONDS = 300;

/**
 * Five clips to compare voices and models on before making all of them: the
 * names Maya and Rafi (মায়া, রাফি), a word with its example sentence, a longer
 * description with place names, and one English story line.
 */
const SAMPLE_CLIPS = ["story-1-bn", "lesson-hello-me-dialogue", "word-boat-example-bn", "place-sundarbans-bn", "story-1-en"];
const defaultSamplesDirectory = path.resolve(__dirname, "../voice-samples");

const baseAssets = [
  { file: "hello-bn", text: "হ্যালো, বন্ধু!", language: "bn" },
  { file: "word-river-bn", text: "নদী", language: "bn" },
  { file: "word-river-example-bn", text: "নদী। নদী বয়ে যায়।", language: "bn" },
  { file: "word-boat-bn", text: "নৌকা", language: "bn" },
  { file: "word-boat-example-bn", text: "নৌকা। নৌকা জলে চলে।", language: "bn" },
  { file: "word-tiger-bn", text: "বাঘ", language: "bn" },
  { file: "word-tiger-example-bn", text: "বাঘ। বাঘ বনে থাকে।", language: "bn" },
  { file: "word-friend-bn", text: "বন্ধু", language: "bn" },
  { file: "word-friend-example-bn", text: "বন্ধু। তুমি আমার বন্ধু।", language: "bn" },
  {
    file: "story-1-en",
    text: "Maya stood beside a wide river. A little boat rocked near the bank.",
    language: "en",
  },
  {
    file: "story-1-bn",
    text: "মায়া একটি চওড়া নদীর পাশে দাঁড়াল। তীরে একটি ছোট নৌকা দুলছিল।",
    language: "bn",
  },
  {
    file: "story-2-en",
    text: "Come aboard, called Rafi. Together, the new friends followed the moonlight.",
    language: "en",
  },
  {
    file: "story-2-bn",
    text: "নৌকায় এসো! রাফি ডাকল। নতুন দুই বন্ধু চাঁদের আলো ধরে এগিয়ে গেল।",
    language: "bn",
  },
  {
    file: "story-3-en",
    text: "Across the water came a gentle song. Maya smiled and sang the last line in Bangla.",
    language: "en",
  },
  {
    file: "story-3-bn",
    text: "জলের ওপার থেকে মিষ্টি গান ভেসে এল। মায়া হেসে শেষ লাইনটি বাংলায় গাইল।",
    language: "bn",
  },
  {
    file: "place-sundarbans-en",
    text: "The Sundarbans. This immense tidal mangrove forest stretches across river channels and mudflats. It is home to remarkable wildlife, including the Royal Bengal tiger.",
    language: "en",
  },
  {
    file: "place-sundarbans-bn",
    text: "সুন্দরবন। জোয়ার-ভাটার নদী আর কাদামাটির চরজুড়ে বিস্তৃত এই বিশাল ম্যানগ্রোভ বন। রয়েল বেঙ্গল টাইগারসহ অনেক প্রাণীর আবাস এটি।",
    language: "bn",
  },
  {
    file: "place-bagerhat-en",
    text: "Historic Bagerhat. Bagerhat grew as a medieval city in the fourteen hundreds. Its many brick mosques show clever building traditions shaped by the green delta landscape.",
    language: "en",
  },
  {
    file: "place-bagerhat-bn",
    text: "ঐতিহাসিক বাগেরহাট। চৌদ্দশ শতকে বাগেরহাট মধ্যযুগের একটি শহর হিসেবে গড়ে ওঠে। এখানকার ইটের মসজিদগুলো বদ্বীপ অঞ্চলের চমৎকার নির্মাণকৌশল দেখায়।",
    language: "bn",
  },
  {
    file: "place-paharpur-en",
    text: "Paharpur Vihara. The ruins at Paharpur are the remains of a vast Buddhist monastery and centre of learning that influenced architecture far beyond Bangladesh.",
    language: "en",
  },
  {
    file: "place-paharpur-bn",
    text: "পাহাড়পুর বিহার। পাহাড়পুরের ধ্বংসাবশেষ এক বিশাল বৌদ্ধ বিহার ও শিক্ষাকেন্দ্রের স্মৃতি। এর স্থাপত্য বাংলাদেশের বাইরেও প্রভাব ফেলেছিল।",
    language: "bn",
  },
  { file: "diagnostic-listen-1", text: "হ্যালো! আমার নাম মায়া।", language: "bn" },
  { file: "diagnostic-listen-2", text: "প্রথমে সোজা যান। নদীর আগে বাঁ দিকে যান। বাজারটি স্কুলের পাশে।", language: "bn" },
  { file: "diagnostic-listen-3", text: "ভাষা পরিচয়ের গুরুত্বপূর্ণ অংশ হতে পারে, তবে সবার অভিজ্ঞতা এক নয় এবং দক্ষতাই পরিচয়ের একমাত্র মাপকাঠি নয়।", language: "bn" },
];

async function curriculumAssets() {
  const curriculumPath = path.resolve(__dirname, "../app/curriculum.ts");
  const curriculumSource = await readFile(curriculumPath, "utf8");
  const lessonSections = curriculumSource.split(/\n  \{\n    id:\s*/).slice(1);
  const assets = [];

  for (const section of lessonSections) {
    if (!section.includes("vocabulary:")) continue;
    const id = section.match(/^"([^"]+)"/)?.[1];
    const vocabularyBlock = section.match(/vocabulary:\s*\[([\s\S]*?)\n\s*\],\n\s*patterns:/)?.[1];
    const patternBlock = section.match(/patterns:\s*\[([\s\S]*?)\n\s*\],\n\s*teaching:/)?.[1];
    if (!id || !vocabularyBlock || !patternBlock) {
      throw new Error("Could not read a curriculum lesson for audio generation.");
    }

    [...vocabularyBlock.matchAll(/\{ bn: "([^"]+)"/g)].forEach((match, index) => {
      assets.push({ file: `lesson-${id}-word-${index + 1}`, text: match[1], language: "bn" });
    });
    [...patternBlock.matchAll(/\{ bn: "([^"]+)"/g)].forEach((match, index) => {
      assets.push({ file: `lesson-${id}-pattern-${index + 1}`, text: match[1], language: "bn" });
    });
  }
  return assets;
}

async function extendedLessonAssets() {
  const contentPath = path.resolve(__dirname, "../app/learning-content.ts");
  const contentSource = await readFile(contentPath, "utf8");
  const lessonSections = contentSource.split(/\n  \{\n    lessonId:\s*/).slice(1);
  const assets = [];

  for (const section of lessonSections) {
    const id = section.match(/^"([^"]+)"/)?.[1];
    const dialogueBlock = section.match(/dialogue:\s*\[([\s\S]*?)\n\s*\],\n\s*listening:/)?.[1];
    const readingText = section.match(/reading:\s*\{[\s\S]*?bn:\s*"([^"]+)"/)?.[1];
    if (!id || !dialogueBlock || !readingText) {
      throw new Error("Could not read an extended lesson for audio generation.");
    }
    // Only the spoken lines: the speakers' names are never read aloud.
    const dialogue = [...dialogueBlock.matchAll(/bn:\s*"([^"]+)"/g)].map((match) => match[1]).join(" ");
    assets.push({ file: `lesson-${id}-dialogue`, text: dialogue, language: "bn" });
    assets.push({ file: `lesson-${id}-reading`, text: readingText, language: "bn" });
  }
  return assets;
}

/** Every bundled clip: the fixed ones plus a clip per lesson word, pattern, dialogue and reading. */
async function allAssets() {
  return [...baseAssets, ...(await curriculumAssets()), ...(await extendedLessonAssets())];
}

function readFlag(argv, name) {
  const index = argv.findIndex((item) => item === `--${name}` || item.startsWith(`--${name}=`));
  if (index === -1) return undefined;
  const item = argv[index];
  if (item.includes("=")) return item.slice(item.indexOf("=") + 1);
  const next = argv[index + 1];
  if (next === undefined || next.startsWith("--")) throw new Error(`--${name} needs a value.`);
  return next;
}

/** Command-line options, checked before anything is generated. Secrets come only from the environment. */
function parseOptions(argv = [], env = {}) {
  const provider = (readFlag(argv, "provider") ?? "espeak").toLowerCase();
  if (!PROVIDERS.has(provider)) throw new Error(`Unknown provider "${provider}". Use espeak, elevenlabs or azure.`);
  const samples = argv.includes("--samples");
  const only = (readFlag(argv, "only") ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  if (samples && only.length > 0) throw new Error("Use either --samples or --only, not both.");
  const out = readFlag(argv, "out");
  const options = {
    provider,
    // Samples are always made again, so a second try with another voice is heard.
    force: argv.includes("--force") || samples,
    resume: argv.includes("--resume"),
    dryRun: argv.includes("--dry-run"),
    only: samples ? [...SAMPLE_CLIPS] : only,
    outputDirectory: out ? path.resolve(out) : samples ? defaultSamplesDirectory : defaultOutputDirectory,
    concurrency: 1,
  };
  if (provider === "espeak") return { ...options, voices: { ...ESPEAK_VOICES } };
  if (provider === "elevenlabs") return { ...options, ...elevenLabsOptions(argv, env, options.dryRun) };

  const key = (env.AZURE_SPEECH_KEY ?? "").trim();
  const region = (env.AZURE_SPEECH_REGION ?? "").trim().toLowerCase();
  if (!key) throw new Error("Set AZURE_SPEECH_KEY to the Speech resource key (ask Faysal) before using --provider azure.");
  if (!AZURE_REGION.test(region)) throw new Error("Set AZURE_SPEECH_REGION to the Speech resource region, for example southeastasia.");
  const voices = {
    bn: readFlag(argv, "voice") ?? env.AZURE_SPEECH_VOICE ?? AZURE_DEFAULT_VOICES.bn,
    en: readFlag(argv, "voice-en") ?? env.AZURE_SPEECH_VOICE_EN ?? AZURE_DEFAULT_VOICES.en,
  };
  for (const voice of Object.values(voices)) {
    if (!AZURE_VOICE.test(voice)) throw new Error(`"${voice}" is not an Azure voice name such as bn-BD-NabanitaNeural.`);
  }
  if (!voices.bn.startsWith("bn-")) throw new Error(`The Bangla voice must be a bn-BD or bn-IN voice, not "${voices.bn}".`);
  return { ...options, voices, key, region };
}

/**
 * The ElevenLabs settings: the API key, the model and a voice id per language.
 * A dry run sends nothing, so it needs neither the key nor the voices. Values
 * that fail a check are never repeated in the message, in case one is the key.
 */
function elevenLabsOptions(argv, env, dryRun) {
  const key = (env.ELEVENLABS_API_KEY ?? "").trim();
  if (!key && !dryRun) {
    throw new Error("Set ELEVENLABS_API_KEY to the client's ElevenLabs API key before using --provider elevenlabs (or add --dry-run to count the clips and characters without one).");
  }
  const model = (readFlag(argv, "model") ?? ELEVENLABS_DEFAULT_MODEL).trim();
  if (!Object.hasOwn(ELEVENLABS_MODELS, model)) throw new Error("--model must be eleven_v4 (the default), eleven_v3 or eleven_multilingual_v2.");
  const bn = (readFlag(argv, "voice") ?? env.ELEVENLABS_VOICE_ID_BN ?? "").trim();
  // English story clips use their own voice when one is set, otherwise the Bangla voice.
  const en = (readFlag(argv, "voice-en") ?? env.ELEVENLABS_VOICE_ID_EN ?? "").trim() || bn;
  if (!bn && !dryRun) {
    throw new Error("Choose the ElevenLabs voice for Bangla: set ELEVENLABS_VOICE_ID_BN or pass --voice <voice id>. English clips use ELEVENLABS_VOICE_ID_EN (or --voice-en), otherwise the same voice.");
  }
  const named = [["Bangla", "--voice or ELEVENLABS_VOICE_ID_BN", bn], ["English", "--voice-en or ELEVENLABS_VOICE_ID_EN", en]];
  for (const [language, where, voice] of named) {
    if (!voice) continue;
    if (key && voice === key) throw new Error(`The ${language} voice (${where}) holds the API key. Set it to the voice id instead.`);
    if (!ELEVENLABS_VOICE.test(voice)) throw new Error(`The ${language} voice (${where}) is not an ElevenLabs voice id: copy the id (10 to 40 letters and digits) from the voice in the ElevenLabs account.`);
  }
  return { voices: { bn, en }, model, key, concurrency: ELEVENLABS_CONCURRENCY };
}

function escapeXml(text) {
  return text.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]);
}

/**
 * The Azure Speech text-to-speech REST request for one clip:
 * POST https://<region>.tts.speech.microsoft.com/cognitiveservices/v1 with an
 * SSML body, the resource key and the Ogg/Opus output format.
 */
function azureSpeechRequest({ text, voice, region, key, rate = "0%" }) {
  if (!AZURE_REGION.test(region)) throw new Error("Invalid Azure region.");
  if (!AZURE_VOICE.test(voice)) throw new Error("Invalid Azure voice name.");
  if (!text.trim()) throw new Error("Nothing to speak.");
  const locale = voice.split("-").slice(0, 2).join("-");
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}">`
    + `<voice name="${voice}"><prosody rate="${escapeXml(rate)}">${escapeXml(text)}</prosody></voice></speak>`;
  return {
    url: `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
    init: {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": AZURE_FORMAT,
        "User-Agent": "bangla-adventures-voice-assets",
      },
      body: ssml,
    },
  };
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * One clip from Azure as Ogg/Opus bytes. Throttling (429) and server errors are
 * retried with the wait Azure asks for; a refused key stops at once.
 */
async function synthesizeAzure(asset, options, { fetch = globalThis.fetch, sleep = wait, attempts = 5 } = {}) {
  const { url, init } = azureSpeechRequest({
    text: asset.text,
    voice: options.voices[asset.language],
    region: options.region,
    key: options.key,
    rate: AZURE_RATES[asset.language],
  });
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(url, init);
    if (response.ok) {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.subarray(0, 4).toString("latin1") !== "OggS") throw new Error(`Azure did not return Ogg audio for ${asset.file}.`);
      return bytes;
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Azure refused the request (${response.status}). Check AZURE_SPEECH_KEY and AZURE_SPEECH_REGION.`);
    }
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt >= attempts) {
      throw new Error(`Azure text-to-speech failed for ${asset.file} (${response.status}).`);
    }
    const retryAfter = Number(response.headers.get("retry-after"));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 60) * 1000 : 2 ** attempt * 1000);
  }
}

/**
 * The ElevenLabs "Create speech" request for one clip: POST
 * https://api.elevenlabs.io/v1/text-to-speech/<voice id>?output_format=opus_48000_64
 * with the API key in xi-api-key and a JSON body of the text, the model, the
 * clip's language (for the models that take language_code) and the voice settings.
 */
function elevenLabsRequest({ text, language, voiceId, model, key }) {
  const spec = Object.hasOwn(ELEVENLABS_MODELS, model) ? ELEVENLABS_MODELS[model] : null;
  if (!spec) throw new Error("Invalid ElevenLabs model.");
  if (!ELEVENLABS_VOICE.test(voiceId ?? "")) throw new Error("Invalid ElevenLabs voice id.");
  if (language !== "bn" && language !== "en") throw new Error("Unknown clip language.");
  if (language === "bn" && !spec.bangla) throw new Error(`${model} cannot speak Bangla.`);
  if (!text.trim()) throw new Error("Nothing to speak.");
  if ([...text].length > spec.characters) throw new Error(`The text is longer than the ${spec.characters} characters ${model} takes.`);
  const body = {
    text,
    model_id: model,
    ...(spec.languageCode ? { language_code: language } : {}),
    voice_settings: { ...ELEVENLABS_SETTINGS[model] },
  };
  return {
    url: `${ELEVENLABS_URL}/${voiceId}?output_format=${ELEVENLABS_FORMAT}`,
    init: {
      method: "POST",
      headers: {
        "xi-api-key": key,
        "Content-Type": "application/json",
        "User-Agent": "bangla-adventures-voice-assets",
      },
      body: JSON.stringify(body),
    },
  };
}

/**
 * True for an Ogg Opus stream: it starts with an Ogg page ("OggS") whose first
 * packet is the Opus identification header ("OpusHead", RFC 7845).
 */
function isOggOpus(bytes) {
  if (bytes.length < 28 || bytes.subarray(0, 4).toString("latin1") !== "OggS") return false;
  const start = 27 + bytes[26];
  return bytes.subarray(start, start + 8).toString("latin1") === "OpusHead";
}

/** The wait before retry number `attempt`: what Retry-After asks for (seconds or a date), otherwise 2, 4, 8… seconds. */
function retryWait(retryAfter, attempt, now = Date.now()) {
  const value = (retryAfter ?? "").trim();
  if (/^\d+(\.\d+)?$/.test(value)) return Math.min(Number(value), MAX_RETRY_WAIT_SECONDS) * 1000;
  const date = value ? Date.parse(value) : Number.NaN;
  if (Number.isFinite(date)) return Math.min(Math.max(date - now, 0), MAX_RETRY_WAIT_SECONDS * 1000);
  return 2 ** attempt * 1000;
}

/** A short reason from an ElevenLabs error answer ({"detail": ...}), with the key blanked out should it ever appear. */
async function errorReason(response, key) {
  let text = "";
  try {
    text = typeof response.text === "function" ? await response.text() : "";
  } catch {
    return "";
  }
  let reason = text;
  try {
    const { detail } = JSON.parse(text);
    if (typeof detail === "string") reason = detail;
    else if (Array.isArray(detail)) reason = detail.map((item) => item?.msg).filter(Boolean).join("; ");
    else if (detail && typeof detail === "object") reason = [detail.status, detail.message].filter(Boolean).join(": ");
  } catch {
    // Not JSON: the text itself is the reason.
  }
  reason = reason.replace(/\s+/g, " ").trim().slice(0, 200);
  return key ? reason.split(key).join("[key]") : reason;
}

/**
 * One clip from ElevenLabs as Ogg Opus bytes. Throttling (429), server errors
 * and network failures are retried after the wait ElevenLabs asks for (or
 * 2, 4, 8… seconds); a refused key or a request ElevenLabs rejects as invalid
 * stops at once. The key is never part of an error message.
 */
async function synthesizeElevenLabs(asset, options, { fetch = globalThis.fetch, sleep = wait, attempts = 5, timeout = REQUEST_TIMEOUT_MS } = {}) {
  const { url, init } = elevenLabsRequest({
    text: asset.text,
    language: asset.language,
    voiceId: options.voices[asset.language],
    model: options.model,
    key: options.key,
  });
  for (let attempt = 1; ; attempt += 1) {
    let response;
    let bytes = null;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
      // A connection that drops while the audio arrives is retried like one that never answered.
      if (response.ok) bytes = Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt >= attempts) {
        const why = error && error.name === "TimeoutError" ? "no answer in time" : "network error";
        throw new Error(`ElevenLabs could not be reached for ${asset.file} (${why}).`);
      }
      await sleep(retryWait(null, attempt));
      continue;
    }
    if (bytes) {
      if (!isOggOpus(bytes)) {
        const type = (response.headers.get("content-type") ?? "no content type").slice(0, 60);
        throw new Error(`ElevenLabs did not return Ogg Opus audio for ${asset.file} (${type}), so nothing was written: the app plays bundled clips only as .ogg.`);
      }
      return bytes;
    }
    const reason = await errorReason(response, options.key);
    const said = reason ? `: ${reason}` : "";
    if (response.status === 401 || response.status === 403) {
      throw new Error(`ElevenLabs refused the request (${response.status})${said}. Check ELEVENLABS_API_KEY, its permissions and the characters left on the plan.`);
    }
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt >= attempts) throw new Error(`ElevenLabs text-to-speech failed for ${asset.file} (${response.status})${said}.`);
    await sleep(retryWait(response.headers.get("retry-after"), attempt));
  }
}

/** One clip from the bundled eSpeak-NG voice, converted to Ogg/Opus with ffmpeg. */
async function synthesizeEspeak(asset, options) {
  const text2wav = require("text2wav");
  const isBangla = asset.language === "bn";
  const wav = await text2wav(asset.text, {
    voice: options.voices[asset.language],
    amplitude: 92,
    speed: isBangla ? 132 : 150,
    pitch: isBangla ? 58 : 55,
    wordGap: isBangla ? 4 : 2,
  });
  const temporaryWav = path.join(options.outputDirectory, `${asset.file}.tmp.wav`);
  const temporaryOgg = path.join(options.outputDirectory, `${asset.file}.tmp.ogg`);
  await writeFile(temporaryWav, wav);
  const conversion = spawnSync(
    "ffmpeg",
    [
      "-y", "-hide_banner", "-loglevel", "error", "-i", temporaryWav,
      "-af", "highpass=f=85,lowpass=f=9000,volume=0.86",
      "-ac", "1", "-ar", "24000", "-c:a", "libopus", "-b:a", "32k", "-vbr", "on", "-application", "voip",
      temporaryOgg,
    ],
    { stdio: "inherit" },
  );
  await unlink(temporaryWav);
  if (conversion.status !== 0) throw new Error(`ffmpeg failed while generating ${asset.file}.ogg`);
  const bytes = await readFile(temporaryOgg);
  await unlink(temporaryOgg);
  return bytes;
}

async function readManifest(directory) {
  try {
    const parsed = JSON.parse(await readFile(path.join(directory, MANIFEST_FILE), "utf8"));
    if (parsed && typeof parsed.files === "object" && parsed.files) return parsed;
  } catch {
    // A missing or unreadable manifest is rebuilt below.
  }
  return { files: {} };
}

async function writeManifest(directory, manifest) {
  const files = Object.fromEntries(Object.keys(manifest.files).sort().map((file) => [file, manifest.files[file]]));
  const body = {
    about: "Written by scripts/generate-voice-assets.cjs: the engine and voice that made each bundled clip. Clips from a neural provider play before a device's own voice.",
    files,
  };
  await writeFile(path.join(directory, MANIFEST_FILE), `${JSON.stringify(body, null, 2)}\n`);
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/** The manifest entry for a clip made now: the provider, the voice and, for ElevenLabs, the model. */
function manifestEntry(options, asset) {
  const entry = { provider: options.provider, voice: options.voices[asset.language] };
  return options.model ? { ...entry, model: options.model } : entry;
}

const sameMaker = (entry, wanted) => Boolean(entry)
  && entry.provider === wanted.provider && entry.voice === wanted.voice && (entry.model ?? null) === (wanted.model ?? null);

/** Characters as a text-to-speech provider counts them against a plan. */
const characterCount = (text) => [...text].length;
const clips = (count) => `${count} ${count === 1 ? "clip" : "clips"}`;

const describeMaker = (options, language) => [options.provider, options.model, options.voices[language] || "voice not set"].filter(Boolean).join(", ");

/** Stops before anything is sent when the chosen model cannot speak a selected clip. */
function checkLanguages(list, options) {
  if (options.provider !== "elevenlabs" || ELEVENLABS_MODELS[options.model].bangla) return;
  if (list.some((asset) => asset.language === "bn")) {
    throw new Error(`${options.model} does not speak Bangla: Bengali is not one of its languages and it does not take language_code. `
      + `Use --model eleven_v4 (the default) or eleven_v3, or use ${options.model} only for English clips (for example --only story-1-en,place-sundarbans-en).`);
  }
}

/** What a run would send: the clips and characters in all and per language. */
function summarize(assets) {
  const count = (items) => ({ clips: items.length, characters: items.reduce((sum, asset) => sum + characterCount(asset.text), 0) });
  return {
    ...count(assets),
    bn: count(assets.filter((asset) => asset.language === "bn")),
    en: count(assets.filter((asset) => asset.language === "en")),
  };
}

/**
 * Generates the clips that are missing (or every clip with --force) with the
 * chosen provider, writing each as <name>.ogg and its provider, voice and model
 * into the manifest. Clips that are kept keep their manifest entry; one made
 * before the manifest existed was made with eSpeak. --resume makes every clip
 * except those already made with this provider, voice and model; --dry-run
 * only reports what would be sent. ElevenLabs clips are made two at a time.
 */
async function generate(options, { assets, fetch, sleep, synthesize, log = (line) => process.stdout.write(`${line}\n`) } = {}) {
  const list = (assets ?? (await allAssets())).filter((asset) => options.only.length === 0 || options.only.some((prefix) => asset.file.startsWith(prefix)));
  if (list.length === 0) throw new Error("No clip matches --only.");
  checkLanguages(list, options);
  const manifest = await readManifest(options.outputDirectory);
  const pending = [];
  let kept = 0;
  for (const asset of list) {
    const present = await exists(path.join(options.outputDirectory, `${asset.file}.ogg`));
    const keep = present && (options.resume ? sameMaker(manifest.files[asset.file], manifestEntry(options, asset)) : !options.force);
    if (!keep) {
      pending.push(asset);
      continue;
    }
    manifest.files[asset.file] ??= { provider: "espeak", voice: ESPEAK_VOICES[asset.language] };
    kept += 1;
  }

  if (options.dryRun) {
    const planned = summarize(pending);
    log(`dry run: nothing is sent to ${options.provider} and no file is written`);
    log(`would make ${clips(planned.clips)} with ${options.provider}, ${planned.characters} characters in all`);
    if (planned.bn.clips) log(`  ${clips(planned.bn.clips)} in Bangla, ${planned.bn.characters} characters (${describeMaker(options, "bn")})`);
    if (planned.en.clips) log(`  ${clips(planned.en.clips)} in English, ${planned.en.characters} characters (${describeMaker(options, "en")})`);
    if (kept > 0) log(`would keep ${clips(kept)}${options.resume ? " already made this way" : " that exist; add --force to count them too"}`);
    return { generated: 0, kept, planned, manifest };
  }

  await mkdir(options.outputDirectory, { recursive: true });
  const make = synthesize ?? ({
    azure: (asset) => synthesizeAzure(asset, options, { fetch, sleep }),
    elevenlabs: (asset) => synthesizeElevenLabs(asset, options, { fetch, sleep }),
  }[options.provider] ?? ((asset) => synthesizeEspeak(asset, options)));
  let generated = 0;
  let characters = 0;
  let next = 0;
  let failure = null;
  // One manifest write at a time, each with every clip made so far.
  let saving = Promise.resolve();
  const save = () => (saving = saving.then(() => writeManifest(options.outputDirectory, manifest)));
  const worker = async () => {
    while (failure === null && next < pending.length) {
      const asset = pending[next];
      next += 1;
      try {
        const bytes = await make(asset);
        await writeFile(path.join(options.outputDirectory, `${asset.file}.ogg`), bytes);
        manifest.files[asset.file] = manifestEntry(options, asset);
        // Written after every clip, so an interrupted run still records what it made.
        await save();
        generated += 1;
        characters += characterCount(asset.text);
        log(`generated ${asset.file}.ogg (${describeMaker(options, asset.language)})`);
      } catch (error) {
        if (failure === null) failure = error instanceof Error ? error : new Error(String(error));
      }
    }
  };
  const workers = Math.max(1, Math.min(options.concurrency ?? 1, pending.length));
  await Promise.all(Array.from({ length: workers }, worker));
  await save();
  if (failure) {
    const note = generated > 0 && (options.force || options.resume)
      ? ` The ${clips(generated)} made before this are saved and listed in the manifest; run the same command with --resume to make only the rest.`
      : "";
    throw new Error(`${failure.message}${note}`, { cause: failure });
  }
  if (generated > 0) log(`made ${clips(generated)} (${characters} characters) with ${options.provider}`);
  if (kept > 0 && options.resume) log(`kept ${clips(kept)} already made with ${options.provider} and the same voice`);
  else if (kept > 0 && !options.force) log(`kept ${kept} existing clips; pass --force to make them again with ${options.provider}`);
  return { generated, kept, manifest };
}

module.exports = {
  allAssets,
  azureSpeechRequest,
  elevenLabsRequest,
  generate,
  isOggOpus,
  parseOptions,
  readManifest,
  retryWait,
  synthesizeAzure,
  synthesizeElevenLabs,
  MANIFEST_FILE,
  SAMPLE_CLIPS,
};

if (require.main === module) {
  Promise.resolve()
    .then(() => generate(parseOptions(process.argv.slice(2), process.env)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}

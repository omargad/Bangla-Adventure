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
 *   npm run audio:generate -- --provider azure --force [--voice bn-BD-PradeepNeural] [--only lesson-my-family]
 *
 * The Azure provider reads AZURE_SPEECH_KEY and AZURE_SPEECH_REGION from the
 * environment and calls the Speech service's text-to-speech REST API. The key
 * is only used here, at build time; it never reaches the app or the browser.
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
const PROVIDERS = new Set(["espeak", "azure"]);
const AZURE_REGION = /^[a-z0-9]{2,40}$/;
const AZURE_VOICE = /^[a-z]{2,3}-[A-Z]{2}-[A-Za-z0-9]{2,60}$/;

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
  if (!PROVIDERS.has(provider)) throw new Error(`Unknown provider "${provider}". Use espeak or azure.`);
  const only = (readFlag(argv, "only") ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const options = {
    provider,
    force: argv.includes("--force"),
    only,
    outputDirectory: readFlag(argv, "out") ? path.resolve(readFlag(argv, "out")) : defaultOutputDirectory,
  };
  if (provider === "espeak") return { ...options, voices: { ...ESPEAK_VOICES } };

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

/**
 * Generates the clips that are missing (or every clip with --force) with the
 * chosen provider, writing each as <name>.ogg and its provider and voice into
 * the manifest. Clips that are kept keep their manifest entry; one made before
 * the manifest existed was made with eSpeak.
 */
async function generate(options, { assets, fetch, sleep, synthesize, log = (line) => process.stdout.write(`${line}\n`) } = {}) {
  const list = (assets ?? (await allAssets())).filter((asset) => options.only.length === 0 || options.only.some((prefix) => asset.file.startsWith(prefix)));
  if (list.length === 0) throw new Error("No clip matches --only.");
  await mkdir(options.outputDirectory, { recursive: true });
  const manifest = await readManifest(options.outputDirectory);
  const make = synthesize ?? (options.provider === "azure"
    ? (asset) => synthesizeAzure(asset, options, { fetch, sleep })
    : (asset) => synthesizeEspeak(asset, options));
  let generated = 0;
  let kept = 0;

  for (const asset of list) {
    const destination = path.join(options.outputDirectory, `${asset.file}.ogg`);
    if (!options.force && (await exists(destination))) {
      manifest.files[asset.file] ??= { provider: "espeak", voice: ESPEAK_VOICES[asset.language] };
      kept += 1;
      continue;
    }
    const bytes = await make(asset);
    await writeFile(destination, bytes);
    manifest.files[asset.file] = { provider: options.provider, voice: options.voices[asset.language] };
    // Written after every clip, so an interrupted run still records what it made.
    await writeManifest(options.outputDirectory, manifest);
    generated += 1;
    log(`generated ${asset.file}.ogg (${options.provider}, ${options.voices[asset.language]})`);
  }
  await writeManifest(options.outputDirectory, manifest);
  if (kept > 0 && !options.force) log(`kept ${kept} existing clips; pass --force to make them again with ${options.provider}`);
  return { generated, kept, manifest };
}

module.exports = { allAssets, azureSpeechRequest, generate, parseOptions, readManifest, synthesizeAzure, MANIFEST_FILE };

if (require.main === module) {
  Promise.resolve()
    .then(() => generate(parseOptions(process.argv.slice(2), process.env)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}

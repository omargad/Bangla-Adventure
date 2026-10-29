# Lesson media review (videos & audio)

Every lesson ships with media already wired in:

- **One YouTube video** per lesson — rendered click-to-load through
  `youtube-nocookie.com` with before/during/after teaching notes, and never
  contacted until a learner presses play.
- **One curated playlist** per lesson (four shared playlists across the 18
  lessons), linked out to YouTube.
- **Per-lesson pronunciation audio** for every slot (dialogue, reading, two
  patterns, six words). A bundled synthetic Bangla clip is the offline-safe
  fallback; a named, consented human recording replaces it once uploaded and
  approved in Lessons (`/studio`). See "Which voice learners hear" below.

## Why the video/playlist IDs need a human check

The current YouTube IDs come from the original prototype. They have **not** been
independently confirmed to resolve to real, relevant, child-appropriate videos.
Treat them as candidates, not verified content, until a reviewer signs off.

## Step 1 — automated existence check

From a network that can reach `youtube.com`:

```bash
npm run verify:media          # human-readable report
npm run verify:media -- --json > media-report.json
```

For each video and playlist it calls YouTube's public oEmbed endpoint (no API
key) and prints whether the ID resolves plus the **real title YouTube returns**,
so you can compare it against the intended title. It exits non-zero if anything
fails, so it can gate a release step.

> If every item fails with status `0` or `403`, your network/proxy blocked
> YouTube — rerun elsewhere. That is not evidence the media is missing. (This
> repo's CI sandbox blocks YouTube, which is why `verify:media` is a manual
> step, not part of `npm test`.)

## Step 2 — replace what fails or doesn't fit

Edit `app/curriculum.ts`:

- Video IDs live on each lesson's `video: { id, title, channel, duration, reason }`.
- Playlists are the shared `beginnerPlaylist` / `conversationPlaylist` /
  `storyPlaylist` / `coursePlaylist` constants near the top of the file.

Pick replacements that are age-appropriate, ideally captioned, and on stable
channels. Update `title`, `channel` and `duration` to match reality.

## Step 3 — record the human decision

In **Lessons → Preview lesson → Video check**, set the decision, captions status
and child-suitability for each lesson and note the exact segment. The check is
shared by all staff: the newest one decides what learners get. A video marked
"Replace this video", "Unavailable on YouTube" or "Unsuitable for children" is
taken out of the lesson for learners; when a replacement YouTube link is given,
learners see that video instead. The check is recorded under the signed-in
account, and the platform never claims a video is verified on its own.

## Which voice learners hear

Every listen button that speaks Bangla (lessons, word practice, the starting
level guide, and the alphabet, grammar, numbers, phrasebook, calendar, poems and
stories pages) plays the best sound it has, in this order
(`lib/voice-playback.ts`):

1. an **approved human recording** of that lesson part (dialogue, reading, any
   of the six words or two sentence patterns), served by `/api/audio`;
2. a **neural provider clip**, when `public/audio/voice-manifest.json` says the
   bundled clip was made by a neural provider such as Azure;
3. the **device's own Bangla voice** (bn-BD first, then bn-IN);
4. the **bundled eSpeak clip** in `public/audio`;
5. nothing: the page shows "No Bangla voice on this device". Bangla text is
   never handed to a voice for another language.

A small note says what is playing: "Recorded voice", "Device voice" or
"Computer voice: may mispronounce names". The dialogue is played without the
speakers' names. The pages without lesson clips (alphabet, grammar and the
other hubs) can only use the device voice.

## Human audio (optional upgrade)

Synthetic fallback audio already exists for every slot and is covered by tests.
To add real voices: **Lessons → Preview lesson → Human audio recordings**, upload
a recording with a speaker credit and recorded consent. It waits for review in
the Lessons list, where any teacher or administrator can play it; approving
needs consent and the reviewer's confirmation that they listened to the whole
recording, and records who approved it. Once approved, learners hear it on every
device ahead of any computer voice: the complete dialogue (Listen), the guided
reading and the word bank (Read), the sentence patterns (Speak) and the words in
word practice. "Stop using it" returns that part to the computer voice straight
away (lesson audio is never cached by browsers).

## A better Bangla computer voice (provider)

The bundled clips are made offline with eSpeak-NG, which misreads some names
(for example মায়া). `scripts/generate-voice-assets.cjs` can make the same clips
with a neural text-to-speech provider instead. Azure Speech is built in (its
bn-BD voices are closest to the learners' Bangla); nothing calls a provider
unless you run the command below, and the key is only used on the machine that
runs it, never by the app.

1. Ask Faysal which provider to use and for a key. For Azure you need a Speech
   resource key and its region (for example `southeastasia`).
2. Try one lesson first:
   ```bash
   AZURE_SPEECH_KEY=... AZURE_SPEECH_REGION=southeastasia \
     npm run audio:generate -- --provider azure --force --only lesson-hello-me
   ```
3. Make every clip again with the provider:
   ```bash
   AZURE_SPEECH_KEY=... AZURE_SPEECH_REGION=southeastasia \
     npm run audio:generate -- --provider azure --force
   ```
   The default voice is `bn-BD-NabanitaNeural`; choose another with
   `--voice bn-BD-PradeepNeural` (or `AZURE_SPEECH_VOICE`), and the English
   story voice with `--voice-en` (default `en-AU-NatashaNeural`). The files keep
   their names, and the manifest records the provider and voice of each one, so
   the app plays them ahead of the device voice.
4. Review the new clips with a native Bangla speaker before approving the
   change: listen to every dialogue and the names in it, and fix any that are
   still wrong (or record those parts as human audio). Then commit
   `public/audio`.

Without `--provider` the script uses eSpeak as before, and without `--force` it
only makes clips that are missing.

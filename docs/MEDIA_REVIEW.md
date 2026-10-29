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
   of the six words or two sentence patterns), served by `/api/audio`. A page
   that is already open asks again which parts have one each time a lesson
   opens (or, in word practice, a lesson's word comes up), so a newly approved
   recording plays without a reload;
2. a **neural provider clip**, when `public/audio/voice-manifest.json` says the
   bundled clip was made by a neural provider (ElevenLabs, or Azure);
3. the **device's own Bangla voice** (bn-BD first, then bn-IN);
4. the **bundled eSpeak clip**, fetched straight from `public/audio` so the
   "Computer voice" label is always true;
5. nothing: the page shows "No Bangla voice on this device". Bangla text is
   never handed to a voice for another language.

A small note says what is playing: "Recorded voice", "Neural computer voice
(ElevenLabs): may mispronounce some words" (the provider named in the manifest),
"Device voice" or "Computer voice: may mispronounce names", in English or
Bangla. No label says a computer clip was checked by a person. The dialogue is
played without the speakers' names. The pages without lesson clips (alphabet,
grammar and the other hubs) can only use the device voice.

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

## A better Bangla computer voice (ElevenLabs)

The bundled clips are made offline with eSpeak-NG, which misreads some names
(for example মায়া). The client chose **ElevenLabs** for clearer Bangla, and
`scripts/generate-voice-assets.cjs` can make the same 204 clips with its
Eleven v4 model, which lists Bengali (`bn`). Generation waits for the client's
API key: nothing calls ElevenLabs unless someone runs the commands below with a
key, and the key is used only on the computer that runs them, never by the app
or the browser. Only the fixed lesson, story and place texts in the repository
are sent; no learner names, accounts or other personal data.

1. **Account and key: the client.** The client should own the ElevenLabs
   account, its plan and billing, and the API key, so the audio can be remade
   after the student team hands over. Create a key for this job (limited to
   text to speech if the account offers that), pass it privately to whoever
   runs the generation, and revoke or rotate it afterwards. Never commit it or
   paste it into an issue, a chat or a log.
2. **Check the plan's licence.** Before generating, confirm that the plan's
   terms allow its audio in an app used by schools (some plans, such as a free
   one, may not allow commercial use or may require attribution) and keep a
   copy with the acceptance records. A full run is about 8,800 characters
   (step 4 prints the exact number); the plan should cover it with room to
   remake clips.
3. **Choose a voice and set the variables.** Pick a clear adult voice, ideally
   a native Bangla voice from the ElevenLabs Voice Library added to the
   account, and copy its voice id (letters and digits). The six English story
   and place clips use the same voice unless an English one is set. Set these
   only in the shell of the person who runs the generation, not in the app's
   `.env`, `app.env` or Compose settings (the app never reads them):
   ```bash
   read -rs ELEVENLABS_API_KEY && export ELEVENLABS_API_KEY   # paste; not shown or kept in history
   export ELEVENLABS_VOICE_ID_BN=<voice id>
   export ELEVENLABS_VOICE_ID_EN=<voice id>                   # optional
   ```
   (Alternatively keep them in a `.env.voice` file, which git ignores like
   every `.env*` file, and run
   `node --env-file=.env.voice scripts/generate-voice-assets.cjs ...` instead
   of `npm run audio:generate -- ...`.) The script never prints the key.
4. **Dry run.** Count what a full run would send, without calling anything
   (this works before the key exists):
   ```bash
   npm run audio:generate -- --provider elevenlabs --dry-run --force
   ```
5. **Samples first.** Make five clips into `voice-samples/` (ignored by git)
   and have a Bangla speaker compare them with the current clips of the same
   names in `public/audio`, in a browser or any audio player:
   ```bash
   npm run audio:generate -- --provider elevenlabs --samples
   ```
   They are `story-1-bn` (মায়া), `lesson-hello-me-dialogue` (মায়া and রাফি),
   `word-boat-example-bn`, `place-sundarbans-bn` and `story-1-en`. To compare
   another voice or the older model, give each try its own folder, for example
   `--voice <other id> --out voice-samples/voice-2` or
   `--model eleven_v3 --out voice-samples/v3`. Any other 3 to 5 clips can be
   tried with `--only story-1-bn,diagnostic-listen-1,hello-bn --out voice-samples/mine`.
6. **Full generation.** When the samples are approved, remake every clip:
   ```bash
   npm run audio:generate -- --provider elevenlabs --force
   ```
   Clips are made two at a time. When ElevenLabs is busy (429) or has a server
   error it waits as long as it asks (Retry-After) and tries again; a refused
   key or an invalid request stops the run at once. If a run stops part-way
   (for example when the plan's characters run out), add `--resume` to the same
   command: it makes only the clips not yet made with that voice and model, so
   none is paid for twice. Each clip
   keeps its name and `.ogg` form: ElevenLabs' Opus output is an Ogg Opus
   stream, every answer is checked for it, and a clip whose answer is anything
   else fails instead of being written (the app cannot play an MP3 in its
   place). `public/audio/voice-manifest.json` records `elevenlabs`, the voice id
   and the model for each clip, so learners hear these clips before the device
   voice, labelled "Neural computer voice (ElevenLabs): may mispronounce some
   words". Use `--only lesson-hello-me,story-` to remake some clips only.
   `--model eleven_v3` is the alternative; `eleven_multilingual_v2` does not
   speak Bangla and is refused for Bangla clips.
7. **Native-speaker review, then commit.** A native Bangla speaker listens to
   the regenerated clips, especially every dialogue and the names in it. Remake
   any wrong clip with `--only`, or record that part as human audio in Lessons.
   Then commit `public/audio` (the `.ogg` files and `voice-manifest.json`)
   together and deploy it as a normal release. No label claims this review; it
   is recorded in the acceptance notes.

### Azure (alternative)

Azure Speech is also built in (its bn-BD voices are close to the learners'
Bangla). It needs a Speech resource key and its region:

```bash
AZURE_SPEECH_KEY=... AZURE_SPEECH_REGION=southeastasia \
  npm run audio:generate -- --provider azure --force [--only lesson-hello-me]
```

The default voice is `bn-BD-NabanitaNeural`; choose another with
`--voice bn-BD-PradeepNeural` (or `AZURE_SPEECH_VOICE`), and the English story
voice with `--voice-en` (default `en-AU-NatashaNeural`). `--dry-run`,
`--samples` and `--resume` work the same way, and the same review applies
before committing `public/audio`.

Without `--provider` the script uses eSpeak as before, and without `--force` it
only makes clips that are missing.

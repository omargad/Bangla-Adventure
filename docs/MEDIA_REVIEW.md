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
4. the **bundled eSpeak clip**, asked for as the bundled clip so the
   "Computer voice" label is always true. A lesson part's bundled clip (steps 2
   and 4) comes through `/api/audio/<lesson>/<part>?v=bundled`, which checks the
   lesson is approved like its recordings; the files themselves
   (`/audio/lesson-*.ogg`) are not served. Other bundled clips come straight from
   `public/audio`;
5. nothing: the page shows "No Bangla voice on this device". Bangla text is
   never handed to a voice for another language.

A small note says what is playing: "Recorded voice", "Neural computer voice
(ElevenLabs, elevenlabs.io): may mispronounce some words" (the provider named in the
manifest; the elevenlabs.io credit is what ElevenLabs asks for on its free plan),
"Device voice" or "Computer voice: may mispronounce names", in English or
Bangla. No label says a computer clip was checked by a person. The dialogue is
played without the speakers' names. The pages without lesson clips (alphabet,
grammar and the other hubs) can only use the device voice.

## Human audio (optional upgrade)

Synthetic fallback audio already exists for every slot and is covered by tests.
To add real voices: **Lessons → Preview lesson → Human audio recordings**, upload
a recording with a speaker credit and recorded consent. It waits for review in
the Lessons list, where any teacher or administrator can play it. Only an
administrator may approve it; approval needs consent and confirmation that the administrator listened to the whole
recording, and records who approved it. Once approved, learners hear it on every
device ahead of any computer voice: the complete dialogue (Listen), the guided
reading and the word bank (Read), the sentence patterns (Speak) and the words in
word practice. "Stop using it" returns that part to the computer voice straight
away (lesson audio is never cached by browsers).

## A better Bangla computer voice (ElevenLabs)

The official JavaScript SDK is available through `npm run audio:elevenlabs`.
This operator-only command reads `ELEVENLABS_API_KEY` from the environment or a
private, git-ignored `.env.local`. It uses the same validated texts, filenames,
manifest, sample selection and resumable generation as the existing REST command.
The private local key file is excluded from Docker builds. Bundled clips play
without an API key; automatic narration of newly written content uses the
separate server environment configuration described below.

For the Bangladeshi narrator selected for the demo, use voice
`6fKdJFZHa5oCXNSVGieE` (Dr Mahmood — Calm & Telecasting Host, described by
ElevenLabs as a British Bangladeshi broadcaster). To generate only the 198
Bengali clips while retaining the six English recordings:

```bash
npm run audio:elevenlabs -- --voice 6fKdJFZHa5oCXNSVGieE --bangla-only --force --resume --out voice-samples/elevenlabs-demo
```

Review the generated files before replacing the corresponding `public/audio`
clips and merging their manifest entries. These are synthetic recordings, not
human-reviewed pronunciation. Alphabet, numbers and the other hub pages that
have no bundled clip still use the device's Bengali voice.

The original bundled clips used eSpeak-NG, which can misread names such as মায়া.
The 198 Bengali clips now use **ElevenLabs**, model `eleven_v4`, and the six
English clips retain their original eSpeak audio. All 198 generated Ogg Opus
files passed a full decode check on 5 November 2026; this verifies file integrity,
not pronunciation or native-speaker review. The manifest records the provider,
voice and model for each clip. Regenerating these bundled clips requires the
operator's API key; playing them makes no ElevenLabs request. The offline
generator sends only fixed lesson, story and place texts.

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
   in the shell of the person who runs offline generation. The `_BN` and `_EN`
   voice overrides belong to this script; runtime narration uses the separate
   server configuration below:
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
   another voice or the older model, give each try its own folder:
   ```bash
   npm run audio:generate -- --provider elevenlabs --samples --voice <other voice id> --out voice-samples/voice-2
   npm run audio:generate -- --provider elevenlabs --samples --model eleven_v3 --out voice-samples/v3
   ```
   To try any other 3 to 5 clips, name them with `--only` instead of
   `--samples` (the two cannot be used together):
   ```bash
   npm run audio:generate -- --provider elevenlabs --force --only story-1-bn,diagnostic-listen-1,hello-bn --out voice-samples/mine
   ```
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
   voice, labelled "Neural computer voice (ElevenLabs, elevenlabs.io): may
   mispronounce some words". The free plan is for non-commercial use and asks
   for this elevenlabs.io credit; the app and the safety page show it. To remake only some clips, name them (or the start of their names)
   with `--only`, for example
   `npm run audio:generate -- --provider elevenlabs --force --only lesson-hello-me,story-`.
   `--model eleven_v3` is the alternative; `eleven_multilingual_v2` does not
   speak Bangla and is refused for Bangla clips.
7. **Native-speaker review, then commit.** A native Bangla speaker listens to
   the regenerated clips, especially every dialogue and the names in it. Remake
   a wrong clip with `--force` and its name, for example:
   ```bash
   npm run audio:generate -- --provider elevenlabs --force --only lesson-hello-me-dialogue
   ```
   Without `--force` the clip that exists is kept and nothing is remade
   (`--resume` keeps it too, because it was made with the same voice and
   model). Or record that part as human audio in Lessons. Then commit
   `public/audio` (the `.ogg` files and `voice-manifest.json`) together and
   deploy it as a normal release. No label claims this review; it
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
voice with `--voice-en` (default `en-AU-NatashaNeural`). `--dry-run` (which,
as with ElevenLabs, needs neither the key nor the region), `--samples` and
`--resume` work the same way, and the same review applies before committing
`public/audio`.

Without `--provider` the script uses eSpeak as before, and without `--force` it
only makes clips that are missing.

## Automatic narration of teacher content

Approved topics have **Listen in Bangla** controls for their introduction,
sections and facts. Approved, open class activities have learner Listen controls
for the instructions and question prompts. Question options and answer keys are excluded, so audio
does not reveal answers or contradict a learner's shuffled option order.
Topic draft comparisons remain silent until the content is approved. Class
managers may preview their accessible activity instructions before approval;
that preview does not publish the activity. External class-source links are not
fetched or narrated.

The first Listen generates audio with the official ElevenLabs SDK and saves it
under `MEDIA_ROOT/generated-narration`. Subsequent listens reuse the saved clip.
Long passages are split without losing characters into parts of at most 1,500
Unicode characters. Each part is generated when playback reaches it. The key
includes the exact text, voice, model, language and audio settings: changed text
gets fresh audio automatically, without regenerating unchanged parts.

Set `ELEVENLABS_API_KEY` in the hosting service's private environment variables,
never in a `NEXT_PUBLIC_` variable or a committed file. Optional overrides are
`ELEVENLABS_VOICE_ID` and `ELEVENLABS_MODEL_ID`; the defaults are the demo's
Bangladeshi narrator and `eleven_v4`. New generation needs a valid key and available
provider credits. Revoking the key leaves saved clips playable but prevents new
clips from being made. Keep `MEDIA_ROOT` on the persistent application volume.

### Without a key: the device's own voice

The site runs without `ELEVENLABS_API_KEY` (the public demo does, and production
starts that way until the client supplies their key). Each Listen still asks
`POST /api/narration` first, with every access check above, so saved audio
still plays. For text with no saved audio the server answers 503 with the
English and Bangla message *"New narration is not configured. Saved audio is
still available."* and the stable field `"code": "narration-not-configured"`.
The control does not show that as an error. Instead:

- It reads the text with the device's own voice for the text's language
  (Web Speech API, the same voice choice as the lessons in
  `lib/voice-playback.ts`, waiting briefly for the browser to load its voices).
  Bangla text is read only by a Bangla voice (bn-BD first, then bn-IN), never by
  an English one. Long text is spoken in whole sentences. **Stop** cancels it,
  and starting another Listen stops it, so only one text plays at a time.
- When the device has no voice for that language, a calm note (a status, not an
  alert) says *"Audio isn't available for this text on this device yet. Read it
  on the screen instead."* in English or Bangla (informal for learners, polite
  for grown-ups). The button stays as it was, with no **Try again**. A device
  with no voices at all waits for them once per page (about 1.5 seconds), then
  answers at once until the browser reports new voices.
- When the device's voice fails, or has not started within 4 seconds (iPhone and
  iPad browsers can drop speech silently), a calm note says *"This device could
  not read the text aloud. Read it on the screen instead."* (or, when the
  device reports that the voice or language is not available, the note above).
  Each Listen first speaks a silent, empty utterance inside the tap itself, so
  that iPhone and iPad allow the device voice that starts after the server has
  answered.

The same applies to a teacher's or administrator's preview of a class activity
that is waiting for approval, sent back or closed, with or without a key: the
server makes no new audio for it and answers 409 with
`"code": "narration-saved-only"` when nothing was saved, and the control reads
the text (already on that reader's screen) with the device's voice instead of
showing an error.

The line under the button names the voice truthfully: *"Neural computer voice
(ElevenLabs, elevenlabs.io)"* only when the audio came from the server, *"This
device's voice"* when the device read it, and nothing once a note or an error
says nothing played. Before anything has played it names ElevenLabs only when
the server says new narration is configured (a usable key, voice and model);
without a key there is no line until something plays. A page learns that from
`GET /api/narration`, which needs the same sign-in as the pages, answers only
`{ "configured": true | false }` (never the key or any setting); that answer may
be cached privately for a minute, a refusal (401, 429, 503) never. Real errors
(no connection, signed out, content withdrawn, daily allowance used, a recording
that cannot play) still show their message as an alert with **Try again**. With
a key nothing changes: every Listen plays the ElevenLabs voice as before.

The default generation budget is 20,000 new Unicode characters per UTC day,
configured with `ELEVENLABS_DAILY_CHARACTER_LIMIT`. Each account may use at most its own
share of that each day, a quarter of it by default (5,000 characters), configured with
`ELEVENLABS_ACCOUNT_DAILY_CHARACTER_LIMIT`, so one account cannot use up narration for
everyone; after that the account hears saved audio only until the next UTC day. The
daily usage file records accounts only as hashes. Reservations are saved before
provider requests, including unsuccessful requests, to bound repeated failures.
Concurrent requests for the same clip share one generation. Only two provider
requests run at once; provider errors are sanitized before returning to users.

Every playback request checks the current session and access to the source,
including cache hits and again after generation. Students need active class enrollment
and an approved, open activity; parents need a linked, enrolled child and the same
activity approval. Staff previews require current management access. Topic audio
uses only the currently approved content. A hash of the displayed text must
match the server's current text, preventing an old page from playing new words.
Withdrawing a topic, rejecting an activity, or removing class access stops further
learner audio requests even when a saved clip already exists.

Only the selected canonical passage is sent to ElevenLabs. Account identifiers,
student submissions, marks and quiz answer keys are not sent. Teachers should
keep personal information out of text intended for narration. Generated audio
is labelled as an ElevenLabs computer voice and is not pronunciation approval;
text the device reads is labelled as the device's voice.

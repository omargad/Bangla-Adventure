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
  approved in Lessons (`/studio`).

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

## Human audio (optional upgrade)

Synthetic fallback audio already exists for every slot and is covered by tests.
To add real voices: **Lessons → Preview lesson → Human audio recordings**, upload
a recording with a speaker credit and recorded consent. It waits for review in
the Lessons list, where any teacher or administrator can play it; approving
needs consent and the reviewer's confirmation that they listened to the whole
recording, and records who approved it. Today learners hear an approved
recording for the complete dialogue and the guided reading on devices without
their own Bangla voice; word and sentence-pattern recordings are kept ready but
not yet played. The synthetic clip stays as the fallback.

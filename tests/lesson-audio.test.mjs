import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const { bundledLessonClip, privateAudioResponse } = await import("../lib/lesson-audio.ts");

const request = (headers = {}) => new Request("https://school.example/api/audio/hello-me/word-1", { headers });
const bytes = new Uint8Array([...Array(100).keys()]);

test("a bundled lesson clip is read from public/audio for the route to stream", async () => {
  const clip = await bundledLessonClip("hello-me", "word-1");
  assert.deepEqual(clip, readFileSync(new URL("../public/audio/lesson-hello-me-word-1.ogg", import.meta.url)));
  assert.equal(clip.subarray(0, 4).toString(), "OggS");
  assert.equal(await bundledLessonClip("hello-me", "word-9"), null, "an unknown part");
  assert.equal(await bundledLessonClip("no-such-lesson", "word-1"), null, "a missing file");
  assert.equal(await bundledLessonClip("../hello-me", "word-1"), null, "nothing outside public/audio");
  assert.equal(await bundledLessonClip("hello-me", "word-1/../../x"), null);
});

test("audio is answered privately, with its type and length, and never cached", async () => {
  const response = privateAudioResponse(request(), bytes, "audio/ogg");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "audio/ogg");
  assert.equal(response.headers.get("content-length"), "100");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  assert.equal(privateAudioResponse(request(), bytes, "text/html").headers.get("content-type"), "application/octet-stream", "a stored type that is not audio is not trusted");
});

test("one byte range is served when the browser asks for it", async () => {
  const first = privateAudioResponse(request({ range: "bytes=0-1" }), bytes, "audio/ogg");
  assert.equal(first.status, 206);
  assert.equal(first.headers.get("content-range"), "bytes 0-1/100");
  assert.equal(first.headers.get("content-length"), "2");
  assert.deepEqual([...new Uint8Array(await first.arrayBuffer())], [0, 1]);
  const rest = privateAudioResponse(request({ range: "bytes=90-" }), bytes, "audio/ogg");
  assert.equal(rest.headers.get("content-range"), "bytes 90-99/100");
  const last = privateAudioResponse(request({ range: "bytes=-5" }), bytes, "audio/ogg");
  assert.deepEqual([...new Uint8Array(await last.arrayBuffer())], [95, 96, 97, 98, 99]);
  const beyond = privateAudioResponse(request({ range: "bytes=50-500" }), bytes, "audio/ogg");
  assert.equal(beyond.headers.get("content-range"), "bytes 50-99/100");
  for (const range of ["bytes=100-", "bytes=5-2", "bytes=0-1,4-5", "items=0-1", "bytes=-"]) {
    const refused = privateAudioResponse(request({ range }), bytes, "audio/ogg");
    assert.equal(refused.status, 416, range);
    assert.equal(refused.headers.get("content-range"), "bytes */100", range);
  }
});

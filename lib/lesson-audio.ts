import { readFile } from "node:fs/promises";
import path from "node:path";
import { adultPasswordChangeRequired, getSignedInAdult, type Adult } from "./auth";
import { getSessionStudent, passwordChangeRequired } from "./student-auth";
import { LESSON_AUDIO_SLOT } from "./voice-playback";

/**
 * Who may hear lesson audio: a signed-in adult or student who has chosen their own password. Checked by
 * /api/audio itself, not only by proxy.ts. The adult is returned so staff can preview unapproved lessons.
 */
export async function lessonAudioListener(): Promise<{ adult: Adult | null } | Response> {
  const adult = await getSignedInAdult();
  if (adult) return adult.mustChangePassword ? adultPasswordChangeRequired() : { adult };
  const student = await getSessionStudent();
  if (!student) return Response.json({ error: "Sign in to listen to this lesson.", errorBn: "এই পাঠ শুনতে সাইন ইন করুন।" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  // A student still on a temporary password chooses their own first, as on every other learning API.
  if (student.mustChangePassword) return passwordChangeRequired();
  return { adult: null };
}

/**
 * The bundled clip for one part of a lesson from public/audio, or null when there is none. The file is read
 * here because proxy.ts refuses the static address: only /api/audio, after its approval check, plays it.
 */
export async function bundledLessonClip(lessonId: string, slot: string, root = path.join(process.cwd(), "public", "audio")): Promise<Buffer | null> {
  // Lesson ids are checked against the curriculum by the route; both parts stay plain names here too.
  if (!/^[a-z0-9-]{1,60}$/.test(lessonId) || !LESSON_AUDIO_SLOT.test(slot)) return null;
  try { return await readFile(path.join(root, `lesson-${lessonId}-${slot}.ogg`)); } catch { return null; }
}

const privateAudioHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes" };

/**
 * Audio bytes as a private response: the right type and length, never kept in a cache (an approval can be
 * withdrawn at any time), and one byte range when the browser asks for it (Safari asks before it plays).
 */
export function privateAudioResponse(request: Request, bytes: Uint8Array, contentType: string): Response {
  const type = contentType.startsWith("audio/") ? contentType : "application/octet-stream";
  const total = bytes.byteLength;
  const range = request.headers.get("range");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    let start = match?.[1] ? Number(match[1]) : NaN;
    let end = match?.[2] ? Number(match[2]) : total - 1;
    // "bytes=-500" asks for the last 500 bytes.
    if (match && !match[1] && match[2]) { start = Math.max(0, total - Number(match[2])); end = total - 1; }
    end = Math.min(end, total - 1);
    if (!match || !Number.isSafeInteger(start) || start > end || start >= total) {
      return new Response(null, { status: 416, headers: { ...privateAudioHeaders, "Content-Range": `bytes */${total}` } });
    }
    return new Response(new Uint8Array(bytes.subarray(start, end + 1)), {
      status: 206,
      headers: { ...privateAudioHeaders, "Content-Type": type, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${total}` },
    });
  }
  return new Response(new Uint8Array(bytes), { headers: { ...privateAudioHeaders, "Content-Type": type, "Content-Length": String(total) } });
}

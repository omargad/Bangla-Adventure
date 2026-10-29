import { getMediaObject } from "@/lib/storage";
import { getSessionAdult } from "@/lib/auth";
import { canTeach } from "@/lib/roles";
import { approvedRecording, isLessonApproved, isLessonId, lessonUnavailable } from "@/lib/lesson-approval";
import { LESSON_AUDIO_SLOT } from "@/lib/voice-playback";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ lessonId: string; slot: string }> };

/**
 * One part of a lesson as learners hear it: the newest approved human recording
 * (with recorded consent) when a teacher approved one, otherwise a redirect to
 * the bundled clip. A page that knows the recording asks for it with
 * ?v=<recording id>; once a teacher stops using that recording the answer is
 * 404, so the page moves on to the next voice instead of mislabelling the
 * bundled clip. Answers are never cached (proxy.ts marks every signed-in
 * response private, no-store), so a retired recording is not replayed.
 */
export async function GET(request: Request, context: RouteContext) {
  const { lessonId, slot } = await context.params;
  if (!isLessonId(lessonId) || !LESSON_AUDIO_SLOT.test(slot)) return Response.json({ error: "Audio not found." }, { status: 404 });
  // Learners only hear approved lessons; teachers and administrators preview any lesson.
  if (!(await isLessonApproved(lessonId)) && !canTeach(await getSessionAdult())) return lessonUnavailable();

  const requested = new URL(request.url).searchParams.get("v");
  const gone = () => Response.json({ error: "That recording is no longer in use." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  try {
    const asset = await approvedRecording(lessonId, slot);
    if (requested !== null && asset?.id !== requested) return gone();
    const body = asset ? await getMediaObject(asset.objectKey) : null;
    if (asset && body) {
      return new Response(new Uint8Array(body), {
        headers: {
          "Content-Type": asset.contentType.startsWith("audio/") ? asset.contentType : "application/octet-stream",
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (requested !== null) return gone();
  } catch {
    // Bundled synthetic audio is the resilient fallback while reviewed media is unavailable.
    if (requested !== null) return gone();
  }

  // A relative address keeps the browser on the host it asked (request.url can name the server's own host,
  // and the clip then loads without the learner's session cookie).
  return new Response(null, { status: 307, headers: { Location: `/audio/lesson-${lessonId}-${slot}.ogg`, "Cache-Control": "no-store" } });
}

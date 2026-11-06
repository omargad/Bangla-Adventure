import { getMediaObject } from "@/lib/storage";
import { canTeach } from "@/lib/roles";
import { approvedRecording, isLessonApproved, isLessonId, lessonUnavailable } from "@/lib/lesson-approval";
import { bundledLessonClip, lessonAudioListener, privateAudioResponse } from "@/lib/lesson-audio";
import { LESSON_AUDIO_SLOT } from "@/lib/voice-playback";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ lessonId: string; slot: string }> };

const notFound = () => Response.json({ error: "Audio not found.", errorBn: "অডিওটি পাওয়া যায়নি।" }, { status: 404, headers: { "Cache-Control": "no-store" } });

/**
 * One part of a lesson as learners hear it: the newest approved human recording
 * (with recorded consent) when an administrator approved one, otherwise the
 * bundled clip from public/audio, which is served only from here (proxy.ts
 * refuses its static address) so it follows the lesson's approval too.
 * A page that knows the recording asks for it with ?v=<recording id>; once an
 * administrator retires that recording the answer is 404, so the page moves on
 * to the next voice instead of mislabelling the bundled clip. ?v=bundled asks
 * for the bundled clip itself. Answers are never cached, so a retired recording
 * or a withdrawn lesson is not replayed.
 */
export async function GET(request: Request, context: RouteContext) {
  const { lessonId, slot } = await context.params;
  if (!isLessonId(lessonId) || !LESSON_AUDIO_SLOT.test(slot)) return notFound();
  const listener = await lessonAudioListener();
  if (listener instanceof Response) return listener;
  // Learners only hear approved lessons; teachers and administrators preview any lesson.
  if (!(await isLessonApproved(lessonId)) && !canTeach(listener.adult)) return lessonUnavailable();

  const requested = new URL(request.url).searchParams.get("v");
  const gone = () => Response.json({ error: "That recording is no longer in use.", errorBn: "এই রেকর্ডিংটি আর ব্যবহার করা হচ্ছে না।" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  if (requested !== "bundled") {
    try {
      const asset = await approvedRecording(lessonId, slot);
      if (requested !== null && asset?.id !== requested) return gone();
      const body = asset ? await getMediaObject(asset.objectKey) : null;
      if (asset && body) return privateAudioResponse(request, body, asset.contentType);
      if (requested !== null) return gone();
    } catch {
      // Bundled synthetic audio is the resilient fallback while reviewed media is unavailable.
      if (requested !== null) return gone();
    }
  }

  const clip = await bundledLessonClip(lessonId, slot);
  return clip ? privateAudioResponse(request, clip, "audio/ogg") : notFound();
}

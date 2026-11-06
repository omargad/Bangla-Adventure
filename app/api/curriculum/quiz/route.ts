import { getSessionAdult } from "@/lib/auth";
import { findApprovedTopic } from "@/lib/curriculum-catalog";
import { markTopicQuiz } from "@/lib/learner-topic";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Marks an approved topic's quiz for a grown-up (a parent or staff member) without
 * saving anything: GET /api/curriculum sends no answers, so the topic page asks here.
 * Students use POST /api/student/topic-progress, which also keeps their best score.
 * Only whether each pick was right comes back, never which option is.
 */
export async function POST(request: Request) {
  const adult = await getSessionAdult();
  if (!adult) return Response.json({ error: "Sign in as a grown-up to check this quiz.", errorBn: "এই কুইজ মিলিয়ে দেখতে বড়দের অ্যাকাউন্টে সাইন ইন করুন।" }, { status: 401 });
  const limit = checkRateLimit(`topic-quiz:${adult.id}`, 120, 10 * 60 * 1000);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);
  const body = await request.json().catch(() => null) as { topicId?: unknown; answers?: unknown } | null;
  try {
    const topic = await findApprovedTopic(body?.topicId);
    if (!topic) return Response.json({ error: "Choose a valid learning topic.", errorBn: "একটি সঠিক শেখার বিষয় বেছে নিন।" }, { status: 400 });
    const marks = markTopicQuiz(topic.quiz, body?.answers);
    if (!marks) return Response.json({ error: "Answer every quiz question first.", errorBn: "আগে কুইজের সব প্রশ্নের উত্তর দিন।" }, { status: 400 });
    return Response.json({ topicId: topic.id, quiz: marks });
  } catch {
    return Response.json({ error: "Topics are temporarily unavailable. Please retry.", errorBn: "বিষয়গুলো এখন পাওয়া যাচ্ছে না। আবার চেষ্টা করুন।" }, { status: 503 });
  }
}

import { getSessionAdult } from "@/lib/auth";
import { getSessionStudent, passwordChangeRequired } from "@/lib/student-auth";
import { getCatalog, listStaffTopics, topicProgressFor, topicPublishing, topicReferences } from "@/lib/curriculum-catalog";
import { canPublishContent, canTeach } from "@/lib/roles";
import { libraryOverrides } from "@/lib/library-catalog";
import { withoutQuizAnswers } from "@/lib/learner-topic";
export const dynamic = "force-dynamic";
/**
 * Learning topics for the signed-in reader. Everyone (students, parents and staff)
 * receives only approved topics; staff also get each topic's approval record and
 * how many topics are waiting for review, and whether their own topics publish at once
 * (publishing.onSave). ?summary=1 returns just the count.
 * Quiz answers are never sent, to staff either: quizzes are marked on the server
 * (POST /api/student/topic-progress, POST /api/curriculum/quiz), and the staff topic
 * routes keep the answers for previews.
 */
export async function GET(request: Request) {
  const session = await getSessionStudent();
  const adult = await getSessionAdult();
  if (!session && !adult) return Response.json({ error: "Sign in to view learning topics." }, { status: 401 });
  if (session?.mustChangePassword && !adult) return passwordChangeRequired();
  // A student still on a temporary password never has their progress read or recorded here.
  const student = session?.mustChangePassword ? null : session;
  try {
    const catalog = await getCatalog();
    if (new URL(request.url).searchParams.get("summary") === "1") return Response.json({ topicCount: catalog.length });
    const progress = student ? await topicProgressFor(student.id, catalog) : { readTopicIds: [], quizScores: {} };
    const staff = canTeach(adult);
    const overrides = await libraryOverrides();
    const review = staff ? new Map((await listStaffTopics()).map((topic) => [topic.id, topic])) : null;
    return Response.json({
      topics: catalog.map(({ version, baseline, approvedAt, ...topic }) => ({
        ...withoutQuizAnswers(topic), references: topicReferences(topic, overrides),
        ...(review ? { approval: { version, baseline, approvedAt, reviewerName: review.get(topic.id)?.approved?.reviewerName ?? null, publishedDirectly: review.get(topic.id)?.approved?.publishedDirectly ?? null, pendingVersions: review.get(topic.id)?.pendingVersions ?? [] } } : {}),
      })),
      ...progress, learnerId: student?.id ?? null, canRecordProgress: Boolean(student), canReview: canPublishContent(adult),
      ...(review ? { pendingCount: [...review.values()].filter((topic) => topic.pendingVersions.length > 0).length } : {}),
      ...(staff && adult ? { publishing: await topicPublishing(adult.id) } : {}),
    });
  } catch { return Response.json({ error: "Learning topics are temporarily unavailable. Please retry." }, { status: 503 }); }
}

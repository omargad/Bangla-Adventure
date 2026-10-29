import { approvedRecordings, learnerLessonView } from "@/lib/lesson-approval";
import AdventureApp from "./AdventureApp";

export const dynamic = "force-dynamic";

/**
 * Learners only get lessons a teacher or administrator has approved, so the
 * approved list (and any video a teacher took down, and the approved human
 * recordings) is read on the server for every visit. A ?module= link opens its
 * lesson only while it is approved.
 */
export default async function AdventurePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ approvedIds, videos }, query] = await Promise.all([learnerLessonView(), searchParams]);
  const requested = typeof query.module === "string" ? query.module : null;
  const initialModuleId = requested && approvedIds.includes(requested) ? requested : null;
  return <AdventureApp approvedLessonIds={approvedIds} videos={videos} recordings={await approvedRecordings(approvedIds)} initialModuleId={initialModuleId} moduleUnavailable={Boolean(requested) && !initialModuleId} />;
}

import type { Metadata } from "next";
import { approvedLessonIds, approvedRecordings } from "@/lib/lesson-approval";
import PracticeHub from "./PracticeHub";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Word practice | Bangla Adventures",
  description:
    "Review the curriculum's vocabulary with gentle spaced repetition: words you know come back later, words you're learning come back sooner. Saved only on this device.",
};

/** Practice words come only from lessons a teacher has approved for learners, with any approved word recordings. */
export default async function PracticePage() {
  const approvedIds = await approvedLessonIds();
  return <PracticeHub approvedLessonIds={approvedIds} recordings={await approvedRecordings(approvedIds)} />;
}

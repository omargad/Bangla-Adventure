import type { Metadata } from "next";
import { approvedLessonIds } from "@/lib/lesson-approval";
import PracticeHub from "./PracticeHub";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Word practice | Bangla Adventures",
  description:
    "Review the curriculum's vocabulary with gentle spaced repetition: words you know come back later, words you're learning come back sooner. Saved only on this device.",
};

/** Practice words come only from lessons a teacher has approved for learners. */
export default async function PracticePage() {
  return <PracticeHub approvedLessonIds={await approvedLessonIds()} />;
}

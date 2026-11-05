import type { Lesson } from "../curriculum";
import type { LessonExtension, QuickCheck } from "../learning-content";

/** Bangla learner-facing copy. Answer indices keep the canonical English ordering. */
export type LessonBanglaCopy = {
  lesson: Pick<Lesson, "summary" | "canDo" | "objectives" | "teaching" | "practice" | "familyMission" | "quiz"> & {
    culture: Pick<Lesson["culture"], "title" | "body">;
  };
  extension: {
    listening: { focus: string; check: QuickCheck };
    reading: { title: string; check: QuickCheck };
    speaking: LessonExtension["speaking"];
    writing: Pick<LessonExtension["writing"], "mission" | "stretch">;
    watch: LessonExtension["watch"];
  };
};

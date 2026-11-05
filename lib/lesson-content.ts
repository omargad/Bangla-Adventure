import { createHash } from "node:crypto";
import { lessons, type Lesson } from "../app/curriculum";
import { lessonExtensions, type LessonExtension } from "../app/learning-content";
import { lessonBanglaCopies, lessonSupportModels, type LessonSupportModel } from "../app/lesson-locales";
import type { LessonBanglaCopy } from "../app/lesson-locales/types";

/** Every learner-facing field belongs to the reviewed revision, including translations. */
export type LessonSnapshot = {
  lesson: Lesson;
  extension: LessonExtension;
  banglaCopy: LessonBanglaCopy | null;
  supportModel: LessonSupportModel | null;
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

export function contentFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

/** Used only to stage a candidate; learner rendering must use a stored approved snapshot. */
export function shippedLessonSnapshots(): LessonSnapshot[] {
  return lessons.map((lesson) => ({ lesson, extension: lessonExtensions[lesson.id], banglaCopy: lessonBanglaCopies[lesson.id] ?? null, supportModel: lessonSupportModels[lesson.id] ?? null }));
}

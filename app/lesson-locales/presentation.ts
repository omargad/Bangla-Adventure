import type { Lesson } from "../curriculum";
import type { LessonExtension, QuickCheck } from "../learning-content";
import type { LessonBanglaCopy } from "./types";

export type LessonLanguage = "en" | "bn";

/** The language of the actual content, including an older approved English-only snapshot. */
export function lessonTextLanguage(language: LessonLanguage, copy: LessonBanglaCopy | null): LessonLanguage {
  return language === "bn" && copy ? "bn" : "en";
}

function localizeCheck(canonical: QuickCheck, copy: QuickCheck): QuickCheck {
  return { ...copy, answer: canonical.answer };
}

/** Overlay presentation text only. Canonical ordering, answers and audio-bearing fields stay stable. */
export function localizeLesson(lesson: Lesson, language: LessonLanguage, copy: LessonBanglaCopy | null): Lesson {
  if (language === "en" || !copy) return lesson;
  return {
    ...lesson,
    ...copy.lesson,
    culture: { ...lesson.culture, ...copy.lesson.culture },
    quiz: lesson.quiz.map((question, index) => ({
      ...question,
      ...copy.lesson.quiz[index],
      answer: question.answer,
    })),
  };
}

/** Approved copy is passed explicitly: never look up current candidate translations here. */
export function localizeLessonExtension(extension: LessonExtension, language: LessonLanguage, copy: LessonBanglaCopy | null): LessonExtension {
  if (language === "en" || !copy) return extension;
  return {
    ...extension,
    listening: {
      focus: copy.extension.listening.focus,
      check: localizeCheck(extension.listening.check, copy.extension.listening.check),
    },
    reading: {
      ...extension.reading,
      title: copy.extension.reading.title,
      check: localizeCheck(extension.reading.check, copy.extension.reading.check),
    },
    speaking: { ...copy.extension.speaking },
    writing: { ...extension.writing, ...copy.extension.writing },
    watch: { ...copy.extension.watch },
  };
}

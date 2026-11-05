import { lessons, type VocabularyItem } from "../curriculum";
import { basicLessonBangla } from "./basic";
import { advancedLessonBangla } from "./advanced";
import type { LessonBanglaCopy } from "./types";

export type { LessonBanglaCopy } from "./types";

/** Current candidate copy. Learners must receive the copy in their approved snapshot. */
export const lessonBanglaCopies: Readonly<Record<string, LessonBanglaCopy>> = {
  ...basicLessonBangla,
  ...advancedLessonBangla,
};

export type LessonSupportModel = {
  title: { en: string; bn: string };
  note: { en: string; bn: string };
  groups: Array<{
    title: { en: string; bn: string };
    items: Array<VocabularyItem & { value?: number }>;
  }>;
};

/** Written reference only: the six canonical recorded vocabulary slots are unchanged. */
export const lessonSupportModels: Readonly<Record<string, LessonSupportModel>> = {
  "numbers-colours": {
    title: { en: "Numbers 1–10 and four colours", bn: "১–১০ পর্যন্ত সংখ্যা আর চারটি রং" },
    note: {
      en: "Written reference with pronunciation guides. Practise with a grown-up. This list has no extra audio; use the lesson’s word-bank listening buttons for recorded examples.",
      bn: "উচ্চারণের সহায়তাসহ লিখিত তালিকা। বড় কারও সঙ্গে অনুশীলন করো। এই তালিকার জন্য বাড়তি অডিও নেই; রেকর্ড করা উদাহরণ শুনতে পাঠের শব্দভান্ডারের শোনার বোতাম ব্যবহার করো।",
    },
    groups: [
      {
        title: { en: "Count from one to ten", bn: "এক থেকে দশ গুনি" },
        items: [
          { value: 1, bn: "এক", transliteration: "ek", en: "one" },
          { value: 2, bn: "দুই", transliteration: "dui", en: "two" },
          { value: 3, bn: "তিন", transliteration: "tin", en: "three" },
          { value: 4, bn: "চার", transliteration: "char", en: "four" },
          { value: 5, bn: "পাঁচ", transliteration: "panch", en: "five" },
          { value: 6, bn: "ছয়", transliteration: "chhoy", en: "six" },
          { value: 7, bn: "সাত", transliteration: "shat", en: "seven" },
          { value: 8, bn: "আট", transliteration: "at", en: "eight" },
          { value: 9, bn: "নয়", transliteration: "noy", en: "nine" },
          { value: 10, bn: "দশ", transliteration: "dosh", en: "ten" },
        ],
      },
      {
        title: { en: "Name four colours", bn: "চারটি রঙের নাম বলি" },
        items: [
          { bn: "লাল", transliteration: "lal", en: "red" },
          { bn: "নীল", transliteration: "nil", en: "blue" },
          { bn: "সবুজ", transliteration: "shobuj", en: "green" },
          { bn: "হলুদ", transliteration: "holud", en: "yellow" },
        ],
      },
    ],
  },
};

const baselineIds = new Set(lessons.map(({ id }) => id));

/** Staff/candidate snapshot construction only; missing baseline translations are a build error. */
export function getLessonBanglaCopy(lessonId: string): LessonBanglaCopy | null {
  const copy = lessonBanglaCopies[lessonId];
  if (!copy && baselineIds.has(lessonId)) throw new Error(`Missing Bangla lesson copy: ${lessonId}`);
  return copy ?? null;
}

export { lessonTextLanguage, localizeLesson, localizeLessonExtension } from "./presentation";
export type { LessonLanguage } from "./presentation";

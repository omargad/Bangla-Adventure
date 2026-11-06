import { localNumber, type Language } from "./local-format";

/**
 * Counted words in the class workspaces, as [English, Bangla]: English takes the singular for one
 * ("1 question", "2 questions"); Bangla counts with টি (things) or জন (people) and has no plural.
 */

type Counted = { one: string; many: string; bn: string; people?: boolean };
const WORDS = {
  question: { one: "question", many: "questions", bn: "প্রশ্ন" },
  student: { one: "student", many: "students", bn: "শিক্ষার্থী", people: true },
  activity: { one: "activity", many: "activities", bn: "কার্যক্রম" },
  submission: { one: "submission", many: "submissions", bn: "জমা" },
} satisfies Record<string, Counted>;

export type CountedWord = keyof typeof WORDS;

export function countLabel(count: number, word: CountedWord): [string, string] {
  const entry: Counted = WORDS[word];
  return [`${count} ${count === 1 ? entry.one : entry.many}`, `${localNumber(count, "bn")}${entry.people ? " জন" : "টি"} ${entry.bn}`];
}

/** countLabel in one language. */
export const countText = (count: number, word: CountedWord, language: Language) => countLabel(count, word)[language === "bn" ? 1 : 0];

/**
 * The note beside a gradebook that leaves out activities students cannot see yet (waiting for an
 * administrator's approval, or sent back for changes); null when none were left out.
 */
export function unpublishedNote(count: number): [string, string] | null {
  if (count <= 0) return null;
  return [
    count === 1
      ? "1 activity is not published yet (waiting for approval or changes requested). Students cannot see it, so it is not shown here or counted in Done."
      : `${count} activities are not published yet (waiting for approval or changes requested). Students cannot see them, so they are not shown here or counted in Done.`,
    `${localNumber(count, "bn")}টি কার্যক্রম এখনো প্রকাশিত হয়নি (অনুমোদনের অপেক্ষায় বা সংশোধন চাওয়া হয়েছে)। শিক্ষার্থীরা এগুলো দেখতে পায় না, তাই এখানে দেখানো বা ‘সম্পন্ন’-এ গোনা হয়নি।`,
  ];
}

/** After a class is deleted: the message on My classes. */
export function classDeletedMessage(name: string): [string, string] {
  return [`${name} was deleted, with its activities and submissions.`, `${name} ক্লাসটি তার কার্যক্রম ও জমাসহ মুছে ফেলা হয়েছে।`];
}

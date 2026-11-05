export type PresentedQuizOption = { text: string; originalIndex: number };

/**
 * Vary where authored options appear without changing their stored indexes.
 * The same learner/activity gets the same order after a render or refresh;
 * consecutive questions rotate it so a quiz authored with every answer first
 * does not teach learners to always choose the first visible option.
 * This is presentation only: the server still grades the original indexes.
 */
export function presentQuizOptions(options: readonly string[], learnerActivityKey: string, questionIndex: number): PresentedQuizOption[] {
  if (!options.length) return [];
  let hash = 2166136261;
  for (const character of learnerActivityKey) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  const offset = ((hash % options.length) + questionIndex) % options.length;
  return options.map((_, displayIndex) => {
    const originalIndex = (displayIndex + offset) % options.length;
    return { text: options[originalIndex], originalIndex };
  });
}

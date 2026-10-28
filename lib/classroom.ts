import { randomInt } from "node:crypto";

/**
 * Pure helpers for the classroom feature (join codes and teacher-authored
 * quiz validation). Database access stays in the API routes.
 */

export { csvCell } from "./csv";

// Same unambiguous alphabet as recovery codes: no 0/O, 1/I/L.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const JOIN_CODE_LENGTH = 6;

export function generateJoinCode(): string {
  let code = "";
  for (let i = 0; i < JOIN_CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

export function normalizeJoinCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, JOIN_CODE_LENGTH);
}

export function isValidJoinCode(code: string): boolean {
  return code.length === JOIN_CODE_LENGTH && [...code].every((char) => CODE_ALPHABET.includes(char));
}

export type QuizQuestion = {
  prompt: string;
  options: string[];
  answer: number;
};

export const MAX_QUESTIONS = 20;
export const MAX_OPTIONS = 6;

/**
 * Validates and sanitises teacher-submitted quiz questions.
 * Returns the cleaned questions, or an error string describing the problem.
 */
export function validateQuizQuestions(input: unknown): { questions: QuizQuestion[] } | { error: string } {
  if (!Array.isArray(input)) return { error: "Questions must be a list." };
  if (input.length === 0) return { error: "Add at least one question." };
  if (input.length > MAX_QUESTIONS) return { error: `Keep it to ${MAX_QUESTIONS} questions or fewer.` };

  const questions: QuizQuestion[] = [];
  for (const [index, raw] of input.entries()) {
    const label = `Question ${index + 1}`;
    if (typeof raw !== "object" || raw === null) return { error: `${label} is not valid.` };
    const item = raw as { prompt?: unknown; options?: unknown; answer?: unknown };
    const prompt = typeof item.prompt === "string" ? item.prompt.trim() : "";
    if (!prompt || prompt.length > 300) return { error: `${label} needs a prompt of 1–300 characters.` };
    if (!Array.isArray(item.options)) return { error: `${label} needs answer options.` };
    if (item.options.length < 2 || item.options.length > MAX_OPTIONS || !item.options.every((option) => typeof option === "string" && option.trim().length > 0 && option.trim().length <= 200)) return { error: `${label} needs 2–6 non-empty options, each up to 200 characters.` };
    const options = item.options
      .filter((option): option is string => typeof option === "string")
      .map((option) => option.trim().slice(0, 200))
      .filter(Boolean)
      .slice(0, MAX_OPTIONS);
    if (options.length < 2) return { error: `${label} needs at least two options.` };
    if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) return { error: `${label} needs distinct answer options.` };
    const answer = typeof item.answer === "number" && Number.isInteger(item.answer) ? item.answer : -1;
    if (answer < 0 || answer >= options.length) return { error: `${label} needs a correct answer.` };
    questions.push({ prompt, options, answer });
  }
  return { questions };
}

/** Whole-number percentage of a score; 0 when there were no questions. */
export function scorePercent(score: number, total: number): number {
  return total > 0 ? Math.round((score / total) * 100) : 0;
}

/** Grades submitted answer indexes against the stored questions. */
export function gradeAnswers(questions: QuizQuestion[], answers: unknown): { score: number; total: number; picked: number[] } {
  const picked = Array.isArray(answers)
    ? questions.map((_, index) => {
        const value = (answers as unknown[])[index];
        return typeof value === "number" && Number.isInteger(value) ? value : -1;
      })
    : questions.map(() => -1);
  const score = questions.reduce((sum, question, index) => sum + (picked[index] === question.answer ? 1 : 0), 0);
  return { score, total: questions.length, picked };
}

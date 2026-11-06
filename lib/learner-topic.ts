// Topics as learners and other readers receive them: without the quiz answers.
// Topic quizzes are marked on the server (POST /api/student/topic-progress for a
// student, POST /api/curriculum/quiz for a grown-up), which answers only whether each
// pick was right, so the correct options never reach a reader's browser. Staff
// previews read whole versions through the staff-only topic routes.
import type { Topic, TopicQuizQuestion } from "../app/topics-content";
import { gradeTopicQuiz } from "./topic-model";

export type LearnerQuizQuestion = Omit<TopicQuizQuestion, "answer">;
/** A topic quiz question as a reader sees it. Only a staff preview of a version still has its answer. */
export type ReaderQuizQuestion = LearnerQuizQuestion & { answer?: number };
export type LearnerTopic = Omit<Topic, "quiz"> & { quiz: ReaderQuizQuestion[] };

/** The topic with every quiz answer left out. */
export function withoutQuizAnswers<T extends { quiz: TopicQuizQuestion[] }>(topic: T): Omit<T, "quiz"> & { quiz: LearnerQuizQuestion[] } {
  return { ...topic, quiz: topic.quiz.map(({ question, options }) => ({ question, options })) };
}

/**
 * How many tries at one topic's quiz can raise a student's saved best score in a day. Every try says which
 * picks were right, so with unlimited scored tries a student could find each answer by trying the options in
 * turn and the teacher would see that score. Later tries are still marked, as practice, but change nothing.
 */
export const SCORED_QUIZ_TRIES_PER_DAY = 3;

/** A marked topic quiz: the score and, for each question, whether the pick was right (never which option is). */
export type TopicQuizMarks = { score: number; total: number; correct: boolean[] };

/** Marks a topic quiz; null unless every question has an answer that is one of its options. */
export function markTopicQuiz(quiz: TopicQuizQuestion[], answers: unknown): TopicQuizMarks | null {
  const result = gradeTopicQuiz(quiz, answers);
  if (!result) return null;
  return { ...result, correct: quiz.map((question, index) => (answers as number[])[index] === question.answer) };
}

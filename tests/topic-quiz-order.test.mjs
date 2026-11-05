import assert from "node:assert/strict";
import test from "node:test";
import { presentQuizOptions } from "../lib/quiz-option-order.ts";
import { gradeTopicQuiz } from "../lib/topic-model.ts";
import { topics } from "../app/topics-content.ts";

const pair = (en, bn) => ({ en, bn });
const fixtureQuiz = Array.from({ length: 3 }, (_, question) => ({
  question: pair(`Question ${question + 1}`, `প্রশ্ন ${question + 1}`),
  options: [pair(`Correct ${question}`, `সঠিক ${question}`), pair(`Other ${question}`, `অন্য ${question}`), pair(`Third ${question}`, `তৃতীয় ${question}`)],
  answer: 0,
}));

test("choosing the first visible option throughout an authored-first topic no longer earns full marks", () => {
  for (const topicId of ["national-symbols", "rivers-everyday-life", "new-teacher-topic"]) {
    const answers = fixtureQuiz.map((question, index) => presentQuizOptions(question.options, `topic:${topicId}`, index)[0].originalIndex);
    assert.deepEqual(gradeTopicQuiz(fixtureQuiz, answers), { score: 1, total: 3 });
  }
});

test("bilingual presentation retains canonical correct and incorrect indexes for server grading", () => {
  for (const topic of topics) {
    const correct = [], wrong = [];
    for (const [index, question] of topic.quiz.entries()) {
      const presented = presentQuizOptions(question.options, `topic:${topic.id}`, index);
      assert.deepEqual(presented.map((option) => option.originalIndex).sort((a, b) => a - b), question.options.map((_, i) => i));
      const selected = presented.find((option) => option.originalIndex === question.answer);
      assert.equal(selected.text, question.options[question.answer], "both language fields remain on the same authored option");
      correct.push(selected.originalIndex);
      wrong.push(presented.find((option) => option.originalIndex !== question.answer).originalIndex);
    }
    assert.deepEqual(gradeTopicQuiz(topic.quiz, correct), { score: topic.quiz.length, total: topic.quiz.length });
    assert.deepEqual(gradeTopicQuiz(topic.quiz, wrong), { score: 0, total: topic.quiz.length });
  }
});

test("a topic attempt stays stable across language views, and retry changes presentation without changing answer identity", () => {
  const options = fixtureQuiz[0].options;
  const first = presentQuizOptions(options, "topic:practice", 0);
  assert.deepEqual(first, presentQuizOptions(options, "topic:practice", 0), "rerender keeps the current attempt");
  const english = first.map((option) => option.text.en);
  const bangla = presentQuizOptions(options, "topic:practice", 0).map((option) => option.text.bn);
  for (const [index, option] of first.entries()) {
    assert.equal(english[index], options[option.originalIndex].en);
    assert.equal(bangla[index], options[option.originalIndex].bn);
  }
  const retry = presentQuizOptions(options, "topic:practice", 1);
  assert.notDeepEqual(retry.map((option) => option.originalIndex), first.map((option) => option.originalIndex));
  assert.deepEqual(retry.map((option) => option.originalIndex).sort(), first.map((option) => option.originalIndex).sort(), "retry changes no authored answer indexes");
  assert.deepEqual(options, fixtureQuiz[0].options, "presentation never mutates the source quiz");
});

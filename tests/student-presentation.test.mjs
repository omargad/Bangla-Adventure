import assert from "node:assert/strict";
import test from "node:test";
import { presentQuizOptions } from "../lib/quiz-option-order.ts";
import { studentPageTitle, isStudentPageTitle } from "../lib/student-page-title.ts";
import { gradeAnswers } from "../lib/classroom.ts";

test("presented choices preserve canonical grading and never mutate authored questions", () => {
  for (let length = 2; length <= 6; length += 1) {
    const options = Object.freeze(Array.from({ length }, (_, index) => `Choice ${index}`));
    const question = { prompt: "Choose the named answer", options, answer: length - 1 };
    const presented = presentQuizOptions(options, "learner:activity", 3);
    assert.deepEqual([...presented.map(({ originalIndex }) => originalIndex)].sort(), Array.from({ length }, (_, index) => index));
    const picked = presented.find((option) => option.text === options[question.answer]).originalIndex;
    assert.equal(gradeAnswers([question], [picked]).score, 1);
    const wrong = presented.find((option) => option.text !== options[question.answer]).originalIndex;
    assert.equal(gradeAnswers([question], [wrong]).score, 0);
    assert.deepEqual(presented, presentQuizOptions(options, "learner:activity", 3), "rerender, refresh and language changes retain the order");
    assert.deepEqual(options, Array.from({ length }, (_, index) => `Choice ${index}`));
    assert.ok(presented.every((option) => !Object.hasOwn(option, "answer")), "presentation carries no answer key");
  }
});

test("first-authored answers occupy varied positions across a quiz", () => {
  for (const seed of ["camel:symbols", "maya:rivers", "nadia:new-year"]) {
    const positions = Array.from({ length: 3 }, (_, question) => presentQuizOptions(["Correct", "Distractor"], seed, question).findIndex((option) => option.originalIndex === 0));
    assert.equal(new Set(positions).size, 2, "not always the first or last displayed choice");
  }
  assert.deepEqual(presentQuizOptions([], "empty", 0), []);
});

test("student titles follow authentication, section and language", () => {
  assert.equal(studentPageTitle(false)[0], "Student login | Bangla Adventures");
  assert.equal(studentPageTitle(false, "results")[0], "Student login | Bangla Adventures");
  assert.equal(studentPageTitle(false, "learning", "sign-up")[0], "Create student account | Bangla Adventures");
  assert.equal(studentPageTitle(true)[0], "My Learning | Bangla Adventures");
  assert.equal(studentPageTitle(true, "activities")[0], "My activities | Bangla Adventures");
  assert.equal(studentPageTitle(true, "results")[0], "My results | Bangla Adventures");
  assert.equal(studentPageTitle(true, "results")[1], "আমার ফলাফল | Bangla Adventures");
  for (const section of ["unknown", "sign-in", "toString", "__proto__"]) assert.deepEqual(studentPageTitle(true, section), studentPageTitle(true, "learning"));
  for (const section of ["learning", "activities", "results"]) for (const title of studentPageTitle(true, section)) assert.ok(isStudentPageTitle(title));
  assert.equal(isStudentPageTitle("Lessons | Bangla Adventures"), false, "destination metadata is not overwritten");
});

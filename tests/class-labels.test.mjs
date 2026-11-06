import assert from "node:assert/strict";
import test from "node:test";

const { classDeletedMessage, countLabel, countText, unpublishedNote } = await import("../lib/class-labels.ts");

test("one question, student, activity or submission is singular in English; Bangla counts with টি or জন", () => {
  assert.deepEqual(countLabel(1, "question"), ["1 question", "১টি প্রশ্ন"]);
  assert.deepEqual(countLabel(3, "question"), ["3 questions", "৩টি প্রশ্ন"]);
  assert.deepEqual(countLabel(0, "question"), ["0 questions", "০টি প্রশ্ন"]);
  assert.deepEqual(countLabel(1, "student"), ["1 student", "১ জন শিক্ষার্থী"]);
  assert.deepEqual(countLabel(12, "student"), ["12 students", "১২ জন শিক্ষার্থী"]);
  assert.deepEqual(countLabel(1, "activity"), ["1 activity", "১টি কার্যক্রম"]);
  assert.deepEqual(countLabel(2, "submission"), ["2 submissions", "২টি জমা"]);
  assert.equal(countText(1, "question", "en"), "1 question");
  assert.equal(countText(1, "question", "bn"), "১টি প্রশ্ন");
});

test("the gradebook names how many unpublished activities it leaves out, and says nothing when there are none", () => {
  assert.equal(unpublishedNote(0), null);
  const [one, oneBn] = unpublishedNote(1);
  assert.match(one, /^1 activity is not published yet .*Students cannot see it, so it is not shown here or counted in Done\.$/);
  assert.match(oneBn, /^১টি কার্যক্রম এখনো প্রকাশিত হয়নি/);
  assert.match(unpublishedNote(2)[0], /^2 activities are not published yet .*cannot see them/);
});

test("deleting a class says so by name", () => {
  assert.deepEqual(classDeletedMessage("Sunday Level 2"), ["Sunday Level 2 was deleted, with its activities and submissions.", "Sunday Level 2 ক্লাসটি তার কার্যক্রম ও জমাসহ মুছে ফেলা হয়েছে।"]);
});

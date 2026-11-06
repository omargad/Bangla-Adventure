import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { publishShippedFixtures } from "./helpers/publish-shipped-fixture.mjs";

const dir = mkdtempSync(path.join(os.tmpdir(), "bangla-learner-topic-"));
process.env.DATABASE_PATH = path.join(dir, "learner-topic.db");
const { getDb } = await import("../db/index.ts");
const { adults, students } = await import("../db/schema.ts");
const { withoutQuizAnswers, markTopicQuiz } = await import("../lib/learner-topic.ts");
const { getCatalog, recordTopicProgress } = await import("../lib/curriculum-catalog.ts");
const db = await getDb();
after(() => rmSync(dir, { recursive: true, force: true }));
db.insert(adults).values({ id: "admin", email: "admin@example.com", displayName: "Admin", role: "admin", passwordHash: "test-only" }).run();
db.insert(students).values({ id: "maya", username: "maya", displayName: "Maya", passwordHash: "test-only" }).run();

test("learner topics carry no quiz answers, and marking says only whether each pick was right", async () => {
  await publishShippedFixtures("admin", { lessons: false });
  const [topic] = await getCatalog();
  const learner = withoutQuizAnswers(topic);
  assert.ok(learner.quiz.length > 0);
  assert.equal(JSON.stringify(learner.quiz).includes('"answer"'), false);
  assert.deepEqual(learner.quiz.map((question) => question.options), topic.quiz.map((question) => question.options), "options keep their authored order");
  assert.equal(topic.quiz[0].answer !== undefined, true, "the stored topic is unchanged");
  const right = topic.quiz.map((question) => question.answer);
  const wrong = topic.quiz.map((question) => (question.answer + 1) % question.options.length);
  assert.deepEqual(markTopicQuiz(topic.quiz, right), { score: topic.quiz.length, total: topic.quiz.length, correct: topic.quiz.map(() => true) });
  assert.deepEqual(markTopicQuiz(topic.quiz, wrong).correct, topic.quiz.map(() => false));
  assert.equal(markTopicQuiz(topic.quiz, [0]), null);

  const saved = await recordTopicProgress("maya", topic.id, wrong);
  assert.deepEqual(saved.quiz, { score: 0, total: topic.quiz.length, best: 0, correct: topic.quiz.map(() => false), saved: true });
  assert.equal(JSON.stringify(saved).includes('"answer"'), false);
});

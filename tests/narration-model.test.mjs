import assert from "node:assert/strict";
import test from "node:test";
import { splitNarration, topicNarrationText, activityNarrationText, detectNarrationLanguage } from "../lib/narration-model.ts";

test("long Bengali text is split losslessly within the provider budget", () => {
  const text = "বাংলাদেশের নদী। 🌊 আমরা একসঙ্গে শিখি। ".repeat(300);
  const parts = splitNarration(text);
  assert.ok(parts.length > 1);
  assert.equal(parts.join(""), text);
  assert.ok(parts.every(part => Array.from(part).length <= 1500));
  assert.equal(splitNarration("🌊".repeat(4000)).join(""), "🌊".repeat(4000));
  assert.deepEqual(splitNarration(""), []);
});

test("topic narration selects only the requested visible text and language", () => {
  const topic = { title: { en: "River", bn: "নদী" }, tagline: { en: "Learn", bn: "শিখি" }, sections: [{ heading: { en: "Water", bn: "পানি" }, body: { en: "Flows", bn: "বয়ে যায়" } }], funFacts: [{ en: "Fact", bn: "তথ্য" }] };
  assert.equal(topicNarrationText(topic, "intro", "bn"), "নদী. শিখি");
  assert.equal(topicNarrationText(topic, "section:0", "bn"), "পানি. বয়ে যায়");
  assert.equal(topicNarrationText(topic, "fact:0", "en"), "Fact");
  for (const slot of ["answer:0", "section:01", "section:-1", "section:99", "fact:9"]) assert.equal(topicNarrationText(topic, slot, "bn"), null);
});

test("activity narration never reveals the answer key or changes option order", () => {
  const activity = { title: "Quiz", instructions: "Read first", questionsJson: JSON.stringify([{ prompt: "What is a river?", options: ["Secret correct", "Other"], answer: 0 }]) };
  assert.equal(activityNarrationText(activity, "instructions"), "Quiz. Read first");
  assert.equal(activityNarrationText(activity, "question:0"), "What is a river?");
  assert.equal(activityNarrationText(activity, "answer:0"), null);
  assert.equal(activityNarrationText(activity, "option:0"), null);
  assert.equal(activityNarrationText({ ...activity, questionsJson: "broken" }, "question:0"), null);
  assert.equal(detectNarrationLanguage("Hello বাংলা"), "bn");
  assert.equal(detectNarrationLanguage("Hello"), "en");
});

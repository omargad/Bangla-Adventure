import assert from "node:assert/strict";
import test from "node:test";

import { topics } from "../app/topics-content.ts";
import { stories } from "../app/stories-content.ts";
import { libraryBooks } from "../app/library-content.ts";

const topic = (id) => {
  const value = topics.find((entry) => entry.id === id);
  assert.ok(value, `missing stable topic ${id}`);
  return value;
};

// Focused regression checks for corrected claims, not a native-language or
// editorial approval. Source checks recorded in the content review pack include
// UNESCO list/321 and days/mother-language, the World Bank's 2022 Bangladesh
// climate report, FAO's date-palm sap case study and Banglapedia's Nazrul entry.
test("Ekushey distinguishes state-language recognition from speaking a language", () => {
  const value = topic("amar-ekushey");
  assert.match(value.sections[0].body.en, /state language alongside Urdu/);
  assert.match(value.sections[0].body.bn, /উর্দুর পাশাপাশি রাষ্ট্রভাষা/);
  const answer = value.quiz[0].options[value.quiz[0].answer];
  assert.match(answer.en, /recognised as a state language/);
  assert.match(answer.bn, /রাষ্ট্রভাষার স্বীকৃতি/);
  assert.match(value.sections[1].body.en, /1999/);
  assert.match(value.sections[1].body.en, /observance began in 2000/);
  assert.match(value.sections[1].body.bn, /২০০০ সাল থেকে/);
});

test("date-palm sap is processed into gur rather than collected as finished jaggery", () => {
  const fact = topic("nobanno-and-pitha").funFacts[0];
  assert.match(fact.en, /sap is collected.*then processed into khejur gur/);
  assert.match(fact.en, /sap and the finished gur are different/);
  assert.match(fact.bn, /রস সংগ্রহ.*রস প্রক্রিয়াজাত করে খেজুরের গুড় তৈরি/);
  assert.doesNotMatch(fact.en, /jaggery\) is collected/);
});

test("cyclone progress is a bounded historical account and retains continuing risk", () => {
  const body = topic("climate-and-disasters").sections[1].body;
  assert.match(body.en, /World Bank reported in 2022.*since 1970/);
  assert.match(body.en, /does not mean every decade is safer/);
  assert.match(body.en, /storms and floods/);
  assert.doesNotMatch(body.en, /Fewer lives are lost every decade/);
  assert.match(body.bn, /বিশ্বব্যাংক ২০২২.*১৯৭০/);
  assert.doesNotMatch(body.bn, /প্রতি দশকে প্রাণহানি কমছে/);
});

test("Bagerhat's listed property is distinguished from its Sixty Dome Mosque", () => {
  const fact = topic("ancient-bengal").funFacts[2];
  assert.match(fact.en, /Mosque is part of the Historic Mosque City of Bagerhat/);
  assert.match(fact.bn, /মসজিদ.*শহরের অংশ/);
  assert.doesNotMatch(fact.en, /Mosque.*is a third UNESCO/);
});

test("folk-tale policy and quiz agree with the explicitly retold story library", () => {
  const retellings = stories.filter((entry) => entry.kind.en.includes("retold"));
  assert.equal(retellings.length, 2);
  const value = topic("folk-tales");
  assert.match(value.sections[1].body.en, /labels its adapted folk tales as retellings/);
  assert.doesNotMatch(value.sections[1].body.en, /platform never rewrites/);
  const question = value.quiz[2];
  assert.match(question.question.en, /retelling/);
  assert.equal(question.answer, 0, "stored answer-index compatibility is preserved");
  assert.match(question.options[question.answer].en, /Clearly labelled as a retelling/);
  assert.match(question.options[question.answer].bn, /পুনর্কথন বলে স্পষ্ট/);
});

test("corrected bilingual facts avoid unsupported anecdotes and global superlatives", () => {
  const nazrul = topic("kazi-nazrul-islam").funFacts[1];
  assert.match(nazrul.en, /childhood nickname was Dukhu Mia/);
  assert.match(nazrul.bn, /ডাকনাম ছিল দুখু মিয়া/);
  assert.doesNotMatch(nazrul.en, /flute|magic/);
  const tagore = topic("rabindranath-tagore").funFacts[2];
  assert.match(tagore.en, /national anthems of Bangladesh and India/);
  assert.doesNotMatch(tagore.en, /world first|only person/);
  assert.doesNotMatch(tagore.bn, /পৃথিবীতে.*আর নেই/);
  for (const id of ["pohela-boishakh", "crafts-of-bengal"]) {
    const text = topic(id).sections.map((entry) => entry.body.bn).join(" ");
    assert.match(text, /অমূর্ত/);
    assert.doesNotMatch(text, /অপরিমেয়/);
  }
});

test("New Year example remains useful after the 2026 calendar year", () => {
  const fact = topic("pohela-boishakh").funFacts[2];
  assert.match(fact.en, /Bengali calendar.*Gregorian calendar/);
  assert.doesNotMatch(fact.en, /2026|1433/);
  assert.doesNotMatch(fact.bn, /২০২৬|১৪৩৩/);
});

test("unverified textbook mappings retain their confirmation requirement", () => {
  for (const id of ["literature-secondary", "arts-crafts", "ethnic-culture"]) {
    assert.equal(libraryBooks.find((book) => book.id === id)?.status, "confirm", id);
  }
});

test("existing topic identifiers and canonical answer indices remain compatible", () => {
  for (const id of [
    "amar-ekushey", "liberation-1971", "ancient-bengal", "national-symbols", "british-rule",
    "pohela-boishakh", "festivals-of-many-faiths", "nobanno-and-pitha", "rivers-everyday-life",
    "climate-and-disasters", "rabindranath-tagore", "kazi-nazrul-islam", "folk-tales",
    "crafts-of-bengal", "ethnic-communities",
  ]) {
    assert.deepEqual(topic(id).quiz.map((question) => question.answer), [0, 0, 0], id);
  }
});

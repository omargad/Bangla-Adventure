import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { lessons, levelBands } = await import("../app/curriculum.ts");
const { lessonExtensions } = await import("../app/learning-content.ts");
const { lessonBanglaCopies, lessonSupportModels, getLessonBanglaCopy, localizeLesson, localizeLessonExtension, lessonTextLanguage } = await import("../app/lesson-locales/index.ts");
const { default: LessonExperience, LessonWrittenSupport } = await import("../app/components/LessonExperience.tsx");

function strings(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}
const renderedText = (html) => html.replace(/<[^>]*>/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

const snapshot = (lesson, copy = getLessonBanglaCopy(lesson.id)) => ({
  lesson, extension: lessonExtensions[lesson.id], banglaCopy: copy, supportModel: lessonSupportModels[lesson.id] ?? null,
});
function props(lesson, copy = getLessonBanglaCopy(lesson.id)) {
  return {
    snapshot: snapshot(lesson, copy), video: null, preview: true,
    level: levelBands.find(({ id }) => id === lesson.level), language: "bn", completed: [],
    soundEnabled: false, isSpeaking: false, onSpeak() {}, onStopAudio() {}, onAward() {}, onCue() {}, onClose() {},
  };
}

test("all 18 baseline lessons have complete Bangla presentation text", () => {
  assert.deepEqual(Object.keys(lessonBanglaCopies).sort(), lessons.map(({ id }) => id).sort());
  for (const lesson of lessons) {
    const copy = getLessonBanglaCopy(lesson.id);
    assert.ok(copy, lesson.id);
    for (const text of strings(copy)) {
      assert.ok(text.trim(), `${lesson.id}: empty localized text`);
      assert.match(text, /[\u0980-\u09ff]/, `${lesson.id}: a learner-facing translation is still English: ${text}`);
    }
    assert.equal(copy.lesson.objectives.length, lesson.objectives.length, lesson.id);
    assert.equal(copy.lesson.teaching.length, lesson.teaching.length, lesson.id);
    assert.equal(copy.lesson.practice.length, lesson.practice.length, lesson.id);
    assert.equal(copy.extension.speaking.success.length, lessonExtensions[lesson.id].speaking.success.length, lesson.id);
  }
});

test("Bangla question order and canonical grading remain equivalent in every lesson", () => {
  for (const lesson of lessons) {
    const copy = getLessonBanglaCopy(lesson.id), extension = lessonExtensions[lesson.id];
    assert.equal(copy.lesson.quiz.length, lesson.quiz.length, lesson.id);
    for (let i = 0; i < lesson.quiz.length; i++) {
      assert.equal(copy.lesson.quiz[i].options.length, lesson.quiz[i].options.length, lesson.id);
      assert.equal(copy.lesson.quiz[i].answer, lesson.quiz[i].answer, lesson.id);
    }
    for (const skill of ["listening", "reading"]) {
      assert.equal(copy.extension[skill].check.options.length, extension[skill].check.options.length, `${lesson.id} ${skill}`);
      assert.equal(copy.extension[skill].check.answer, extension[skill].check.answer, `${lesson.id} ${skill}`);
    }
  }
});

test("localizing presentation cannot alter IDs, narration scripts, audio slots or canonical answers", () => {
  const before = JSON.stringify({ lessons, lessonExtensions });
  for (const lesson of lessons) {
    const copy = getLessonBanglaCopy(lesson.id), canonical = lessonExtensions[lesson.id];
    const localized = localizeLesson(lesson, "bn", copy), extension = localizeLessonExtension(canonical, "bn", copy);
    assert.equal(localized.id, lesson.id);
    assert.equal(localized.level, lesson.level);
    assert.equal(localized.vocabulary, lesson.vocabulary);
    assert.equal(localized.patterns, lesson.patterns);
    assert.equal(localized.vocabulary.length, 6);
    assert.deepEqual(localized.quiz.map(({ answer }) => answer), lesson.quiz.map(({ answer }) => answer));
    assert.equal(extension.dialogue, canonical.dialogue);
    for (const name of ["bn", "en"]) assert.equal(extension.reading[name], canonical.reading[name]);
    for (const name of ["modelBn", "modelEn", "starters"]) assert.equal(extension.writing[name], canonical.writing[name]);
    assert.equal(localizeLesson(lesson, "en", copy), lesson);
    assert.equal(localizeLessonExtension(canonical, "en", copy), canonical);
  }
  assert.equal(JSON.stringify({ lessons, lessonExtensions }), before, "canonical sources were mutated");
});

test("the adapter renders the explicitly approved copy instead of a newer global candidate", () => {
  const lesson = lessons[0], approved = structuredClone(getLessonBanglaCopy(lesson.id));
  approved.lesson.summary = "এটি অনুমোদিত পুরোনো সংস্করণের সারাংশ।";
  approved.extension.listening.focus = "এই অনুমোদিত নির্দেশটি মন দিয়ে শোনো।";
  approved.lesson.quiz[0].answer = (lesson.quiz[0].answer + 1) % lesson.quiz[0].options.length;
  assert.equal(localizeLesson(lesson, "bn", approved).summary, approved.lesson.summary);
  assert.equal(localizeLessonExtension(lessonExtensions[lesson.id], "bn", approved).listening.focus, approved.extension.listening.focus);
  assert.equal(localizeLesson(lesson, "bn", approved).quiz[0].answer, lesson.quiz[0].answer, "presentation copy cannot change grading");
  const html = renderToStaticMarkup(createElement(LessonExperience, props(lesson, approved)));
  assert.ok(html.includes(approved.lesson.summary));
  assert.ok(!html.includes(getLessonBanglaCopy(lesson.id).lesson.summary));
});

test("a historical English-only approved snapshot cannot borrow the current unapproved Bangla copy", () => {
  const lesson = lessons[0];
  const html = renderToStaticMarkup(createElement(LessonExperience, props(lesson, null)));
  assert.ok(html.includes("এই সংস্করণের বাংলা অনুবাদের অনুমোদন বাকি।"));
  assert.ok(!html.includes(getLessonBanglaCopy(lesson.id).lesson.summary));
  assert.ok(!html.includes(lesson.summary));
  assert.equal(lessonTextLanguage("bn", null), "en");
});

test("every current Bangla overview renders its localized summary and family guidance", () => {
  for (const lesson of lessons) {
    const copy = getLessonBanglaCopy(lesson.id);
    const html = renderToStaticMarkup(createElement(LessonExperience, props(lesson)));
    const text = renderedText(html);
    assert.ok(text.includes(copy.lesson.summary), lesson.id);
    assert.ok(text.includes(copy.lesson.familyMission), lesson.id);
    assert.match(html, /class="lesson-shell expanded-lesson-shell" lang="bn"/);
    assert.ok(!html.includes(lesson.summary), `${lesson.id}: English summary leaked into the Bangla view`);
  }
});

test("missing baseline copy is an explicit error; unknown custom IDs have no invented translation", () => {
  const id = lessons[0].id, saved = lessonBanglaCopies[id];
  try {
    delete lessonBanglaCopies[id];
    assert.throws(() => getLessonBanglaCopy(id), /Missing Bangla lesson copy/);
  } finally { lessonBanglaCopies[id] = saved; }
  assert.equal(getLessonBanglaCopy("custom-not-a-baseline"), null);
});

test("numbers and colours have written support for 1–10 and yellow without extra audio controls", () => {
  const model = lessonSupportModels["numbers-colours"];
  assert.deepEqual(model.groups[0].items.map(({ value }) => value), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(model.groups[1].items.map(({ en }) => en), ["red", "blue", "green", "yellow"]);
  const html = renderToStaticMarkup(createElement(LessonWrittenSupport, { model, language: "bn", showEnglish: true }));
  assert.equal((html.match(/<dt>/g) ?? []).length, 14);
  assert.ok(html.includes("হলুদ") && html.includes("দশ"));
  assert.doesNotMatch(html, /<button|<audio|src=|data-clip/);
  assert.equal(lessons.find(({ id }) => id === "numbers-colours").vocabulary.length, 6);
});

test("the two contradictory viewing durations use adult-preview guidance in both languages", () => {
  for (const id of ["sundarbans-voices", "language-movement"]) {
    assert.match(lessonExtensions[id].watch.segment, /grown-up.*previewing/);
    assert.doesNotMatch(lessonExtensions[id].watch.segment, /\d+:\d+/);
    assert.doesNotMatch(getLessonBanglaCopy(id).extension.watch.segment, /[০-৯\d]+:[০-৯\d]+/);
  }
});

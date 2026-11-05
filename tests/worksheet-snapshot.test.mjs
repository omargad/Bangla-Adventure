import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import WorksheetSheet from "../app/worksheets/WorksheetSheet.tsx";
import { LanguageProvider } from "../lib/use-language.ts";
import { shippedLessonSnapshots } from "../lib/lesson-content.ts";

const render = (snapshot, language = "bn") => renderToStaticMarkup(createElement(LanguageProvider, { initialLanguage: language }, createElement(WorksheetSheet, { snapshot })));

test("worksheets use the supplied approved copy and canonical answer positions", () => {
  const snapshot = structuredClone(shippedLessonSnapshots()[0]);
  snapshot.banglaCopy.lesson.familyMission = "অনুমোদিত পরিবারের কাজের নমুনা।";
  const html = render(snapshot);
  assert.ok(html.includes(snapshot.banglaCopy.lesson.familyMission));
  assert.ok(html.includes(snapshot.banglaCopy.extension.writing.mission));
  assert.ok(html.includes(snapshot.banglaCopy.lesson.quiz[0].question));
  assert.ok(!html.includes(snapshot.lesson.familyMission));
  assert.match(html, /উত্তরসূচি/);
  assert.match(html, /<article class="worksheet-sheet" lang="bn"/);
});

test("a legacy approved worksheet cannot borrow a pending Bangla translation", () => {
  const snapshot = structuredClone(shippedLessonSnapshots()[0]);
  const candidate = snapshot.banglaCopy;
  snapshot.banglaCopy = null;
  const html = render(snapshot);
  assert.match(html, /বাংলা সহায়ক নির্দেশনা এখনো পর্যালোচনার অপেক্ষায়/);
  assert.ok(!html.includes(candidate.extension.writing.mission));
  assert.ok(!html.includes(snapshot.lesson.familyMission));
  assert.ok(render(snapshot, "en").includes(snapshot.lesson.familyMission));
});

test("number worksheets include all ten written models without inventing audio controls", () => {
  const snapshot = shippedLessonSnapshots().find(({ lesson }) => lesson.id === "numbers-colours");
  const html = render(snapshot);
  assert.ok(html.includes("দশ") && html.includes("হলুদ"));
  assert.ok(!html.includes("<audio") && !html.includes("/api/audio/"));
});
